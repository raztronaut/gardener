#!/usr/bin/env python3
"""Blink Live View daemon — ALWAYS-ON, self-healing real-time video.

Runs as its own service. It logs in once, then loops forever:
  1. open a Blink Live View (immis protocol via blinkpy's BlinkLiveStream),
     which serves the demuxed MPEG-TS on a localhost TCP port;
  2. run ffmpeg to decode that and continuously overwrite ONE jpg (tmpfs) with
     the latest frame;
  3. when the session ends (Blink caps each at a few minutes, or the link
     hiccups), tear it down and immediately open a fresh one — a new session
     re-negotiates a keyframe, so the feed adapts to scene/lighting/codec
     changes instead of freezing.

The wall server just serves that jpg at /api/blink/live.jpg. ONE process owns the
whole pipeline, so there's no cross-process restart thrash / overlapping sessions.
"""
import asyncio
import logging
import os
import shutil
import signal
import ssl
import sys
import time

WARMUP_LIMIT = 28   # seconds to allow for the first frame before declaring failure
STALE_LIMIT = 12    # seconds without a new frame = stalled → restart the session

from aiohttp import ClientSession
from blinkpy.blinkpy import Blink
from blinkpy.auth import Auth, BlinkTwoFARequiredError
from blinkpy.livestream import BlinkLiveStream

import blink_common as bc

_LOG = logging.getLogger("blink_live")
_STOP = asyncio.Event()


# ---- FIX a blinkpy bug that makes Live View "work then break" -----------------
# BlinkLiveStream.recv() reads payloads with reader.read(n), but asyncio's read(n)
# returns UP TO n bytes — a payload spanning multiple TCP segments gets a short
# read, is judged "Insufficient data", and breaks the loop, aborting the stream
# after ~15s. readexactly(n) waits for the whole payload. We monkeypatch so
# blinkpy stays stock (the venv can be reinstalled freely).
async def _recv_fixed(self):
    try:
        while not self.target_reader.at_eof():
            try:
                header = await self.target_reader.readexactly(9)
            except (asyncio.IncompleteReadError, ConnectionError):
                break
            msgtype = header[0]
            payload_length = int.from_bytes(header[5:9], byteorder="big")
            if payload_length <= 0:
                continue
            try:
                data = await self.target_reader.readexactly(payload_length)
            except (asyncio.IncompleteReadError, ConnectionError):
                break
            if msgtype != 0x00 or not data or data[0] != 0x47:
                continue  # only MPEG-TS video packets
            for writer in list(self.clients):
                if not writer.is_closing():
                    try:
                        writer.write(data)
                        await writer.drain()
                    except Exception:  # noqa: BLE001 — drop a dead client
                        pass
            await asyncio.sleep(0)
    except ssl.SSLError as e:
        if e.reason != "APPLICATION_DATA_AFTER_CLOSE_NOTIFY":
            _LOG.debug("ssl: %s", e)
    except Exception as e:  # noqa: BLE001
        _LOG.debug("recv: %s", e)
    finally:
        try:
            self.target_writer.close()
        except Exception:  # noqa: BLE001
            pass


BlinkLiveStream.recv = _recv_fixed

_FFMPEG = shutil.which("ffmpeg") or "/usr/bin/ffmpeg"  # absolute → robust under systemd
FFMPEG_ARGS = [
    _FFMPEG, "-loglevel", "error", "-fflags", "nobuffer",
    "-analyzeduration", "2000000", "-probesize", "1500000",
    "-f", "mpegts",
]
FFMPEG_OUT = ["-an", "-r", "8", "-q:v", "6", "-update", "1", "-f", "image2", bc.LIVE_FRAME]


def log(msg):
    line = f"[{time.strftime('%Y-%m-%dT%H:%M:%S')}] [blink-live] {msg}"
    print(line, flush=True)
    try:
        with open(os.path.join(bc.BLINK_DIR, "live.log"), "a") as f:
            f.write(line + "\n")
    except OSError:
        pass


async def run_session(blink, cam):
    """Open one Live View session + ffmpeg; return when it ends."""
    stream = await cam.init_livestream()
    server = await stream.start(host="127.0.0.1", port=0)  # OS-assigned port
    port = stream.socket.getsockname()[1]
    feed = asyncio.create_task(stream.feed())
    await asyncio.sleep(1.0)  # let auth + first packets begin
    ff = await asyncio.create_subprocess_exec(
        *FFMPEG_ARGS, "-i", f"tcp://127.0.0.1:{port}", *FFMPEG_OUT,
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
    )
    log(f"session up (port {port}, ffmpeg pid {ff.pid})")
    ff_wait = asyncio.create_task(ff.wait())
    stop_wait = asyncio.create_task(_STOP.wait())
    # WATCHDOG: the Blink stream can stall WITHOUT closing (no data, no EOF), so
    # readexactly() blocks forever and ffmpeg keeps running but writes no frames —
    # the "stuck, never recovers" failure. Watch the output frame's freshness and
    # end the session if it doesn't appear (warmup) or stops advancing (stall), so
    # the main loop re-opens a fresh session.
    produced = {"frame": False}
    async def watchdog():
        start = time.time()
        while True:
            await asyncio.sleep(4)
            try:
                age = time.time() - os.path.getmtime(bc.LIVE_FRAME)
                if age < STALE_LIMIT:
                    produced["frame"] = True
                    continue             # fresh frame → healthy
            except OSError:
                age = None               # no frame file yet
            elapsed = time.time() - start
            if not produced["frame"] and elapsed < WARMUP_LIMIT:
                continue                 # still warming up (first frame not in yet)
            log(f"watchdog: no fresh frame (age={age}, elapsed={elapsed:.0f}s) — restarting")
            return
    wd = asyncio.create_task(watchdog())
    try:
        await asyncio.wait({feed, ff_wait, stop_wait, wd}, return_when=asyncio.FIRST_COMPLETED)
        return produced["frame"]
    finally:
        wd.cancel()
        try:
            ff.kill()
        except ProcessLookupError:
            pass
        stream.stop()
        try:
            await asyncio.wait_for(feed, timeout=6)
        except Exception:  # noqa: BLE001
            feed.cancel()
        try:
            server.close()
            await server.wait_closed()
        except Exception:  # noqa: BLE001
            pass
        for t in (ff_wait, stop_wait):
            t.cancel()


async def main() -> int:
    creds = bc.load_creds()
    if not creds:
        log("no creds — run blink_login.py first")
        return 1
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _STOP.set)
        except NotImplementedError:
            pass

    session = ClientSession()
    backoff = 2
    try:
        blink = Blink(session=session)
        blink.auth = Auth(creds, no_prompt=True, session=session)
        try:
            await blink.start()
        except BlinkTwoFARequiredError:
            log("session expired — re-run blink_login.py")
            return 2
        cam = next(iter(blink.cameras.values()), None)
        if cam is None:
            log("no cameras")
            return 1
        log(f"connected to {cam.name}; maintaining live view")

        while not _STOP.is_set():
            try:
                produced = await run_session(blink, cam)
                if produced:
                    backoff = 2          # healthy session → reopen quickly
                else:
                    # No frame at all = Blink likely throttling live. Back off so we
                    # don't hammer it (which prolongs the throttle); the wall falls
                    # back to snapshots meanwhile.
                    backoff = min(max(backoff * 2, 15), 90)
                    log(f"no frames (throttled?) — backing off {backoff}s")
            except Exception as e:  # noqa: BLE001
                backoff = min(max(backoff * 2, 15), 90)
                log(f"session error: {e}; retry in {backoff}s")
            if _STOP.is_set():
                break
            await asyncio.sleep(2 if backoff == 2 else backoff)
        return 0
    finally:
        await session.close()


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        sys.exit(0)
