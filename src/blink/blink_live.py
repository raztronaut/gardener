#!/usr/bin/env python3
"""Blink Live View session — on-demand real-time video bridge.

Started by the wall server while someone is watching the camera fullscreen. It
opens a Blink Live View (the proprietary "immis" protocol, implemented by
blinkpy's BlinkLiveStream), which exposes a local TCP server streaming raw
MPEG-TS. The server's ffmpeg then connects to that port and transcodes to MJPEG
for the browser.

  python src/blink/blink_live.py <port>

Prints "READY <port>" once the local TS server is up, then runs until the stream
ends (ffmpeg/last client disconnects) or it receives SIGTERM — at which point it
tears the Blink session down cleanly (so we don't leave a live session dangling).
"""
import asyncio
import signal
import sys

from aiohttp import ClientSession
from blinkpy.blinkpy import Blink
from blinkpy.auth import Auth

import blink_common as bc

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8791


async def main() -> int:
    creds = bc.load_creds()
    if not creds:
        print("NO-CREDS", flush=True)
        return 1
    session = ClientSession()
    stream = None
    feed_task = None
    try:
        blink = Blink(session=session)
        blink.auth = Auth(creds, no_prompt=True, session=session)
        await blink.start()
        cam = next(iter(blink.cameras.values()), None)
        if cam is None:
            print("NO-CAMERA", flush=True)
            return 1

        stream = await cam.init_livestream()
        await stream.start(host="127.0.0.1", port=PORT)
        print(f"READY {PORT}", flush=True)

        feed_task = asyncio.create_task(stream.feed())  # auth + pump TS + keepalive
        loop = asyncio.get_running_loop()
        stop_ev = asyncio.Event()
        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                loop.add_signal_handler(sig, stop_ev.set)
            except NotImplementedError:
                pass

        stop_task = asyncio.create_task(stop_ev.wait())
        await asyncio.wait({feed_task, stop_task}, return_when=asyncio.FIRST_COMPLETED)
        return 0
    finally:
        # Tear down the Blink session cleanly; let feed()'s poll() send command_done
        # BEFORE we close the aiohttp session (closing early aborts that request).
        try:
            if stream is not None:
                stream.stop()
            if feed_task is not None:
                await asyncio.wait_for(feed_task, timeout=6)
        except Exception:
            if feed_task is not None:
                feed_task.cancel()
        await session.close()


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        sys.exit(0)
