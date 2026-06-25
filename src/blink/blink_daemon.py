#!/usr/bin/env python3
"""Blink polling daemon — runs unattended after blink_login.py has saved a session.

Every POLL seconds it refreshes the account, finds the most recent motion clip,
and writes the latest snapshot (latest.jpg) + metadata (latest.json) that the wall
server serves to the Blink widget. Resilient: a transient Blink/network hiccup
keeps the last good image; an expired session flips state to "needs-login" so the
widget tells the human to re-run the login script (instead of crash-looping).
"""
import asyncio
import datetime
import os
import shutil
import subprocess
import sys

from aiohttp import ClientSession
from blinkpy.blinkpy import Blink
from blinkpy.auth import Auth, BlinkTwoFARequiredError

import blink_common as bc

POLL = int(os.environ.get("GARDENER_BLINK_POLL", "60"))  # seconds between refreshes
# Actively request a fresh still each poll (Blink won't refresh its thumbnail on
# its own without motion). Costs a little battery; set GARDENER_BLINK_SNAP=0 to
# only update on motion. SNAP_WAIT = seconds to let the camera upload the new shot.
SNAP = os.environ.get("GARDENER_BLINK_SNAP", "1") != "0"
SNAP_WAIT = int(os.environ.get("GARDENER_BLINK_SNAP_WAIT", "4"))
_HAS_FFMPEG = shutil.which("ffmpeg") is not None


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def log(msg):
    print(f"[{now_iso()}] [blink] {msg}", flush=True)


def _atomic_jpg(src_tmp):
    os.replace(src_tmp, bc.LATEST_JPG)


async def _snapshot_from_clip(camera, tmp_dir):
    """Best: download the newest motion clip and extract a frame (the actual motion
    moment). Returns True on success."""
    if not _HAS_FFMPEG:
        return False
    clip_mp4 = os.path.join(tmp_dir, "clip.mp4")
    frame = bc.LATEST_JPG + ".tmp"
    try:
        await camera.video_to_file(clip_mp4)
        if not os.path.exists(clip_mp4) or os.path.getsize(clip_mp4) < 1024:
            return False
        # grab a frame ~1s in (skips the dark first frame); scale down for the wall
        r = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-ss", "1", "-i", clip_mp4,
             "-frames:v", "1", "-vf", "scale=640:-1", frame],
            timeout=30,
        )
        if r.returncode == 0 and os.path.exists(frame) and os.path.getsize(frame) > 512:
            _atomic_jpg(frame)
            return True
    except Exception as e:  # noqa: BLE001
        log(f"clip-frame failed ({e}); falling back to thumbnail")
    finally:
        for p in (clip_mp4,):
            try:
                os.remove(p)
            except OSError:
                pass
    return False


async def _snapshot_from_thumbnail(camera):
    """Fallback: save the camera's current thumbnail (Blink updates it on motion)."""
    tmp = bc.LATEST_JPG + ".tmp"
    try:
        await camera.image_to_file(tmp)
        if os.path.exists(tmp) and os.path.getsize(tmp) > 512:
            _atomic_jpg(tmp)
            return True
    except Exception as e:  # noqa: BLE001
        log(f"thumbnail save failed: {e}")
    return False


async def poll_once(blink, state):
    await blink.refresh(force=True)

    # Newest motion clip across all cameras = the motion event we want to show.
    # Look back a week (not just since the last refresh) so we always find the most
    # recent clip even when nothing moved in the last poll interval.
    newest = None
    try:
        since = (datetime.datetime.now() - datetime.timedelta(days=7)).strftime("%Y/%m/%d %H:%M:%S")
        meta = await blink.get_videos_metadata(since=since, stop=2)
        clips = [v for v in (meta or []) if not v.get("deleted")]
        clips.sort(key=lambda v: v.get("created_at", ""), reverse=True)
        newest = clips[0] if clips else None
    except Exception as e:  # noqa: BLE001
        log(f"video metadata fetch failed: {e}")

    cam_name = (newest or {}).get("device_name")
    camera = blink.cameras.get(cam_name) if cam_name else None
    if camera is None and blink.cameras:
        # no clip list — fall back to whichever camera currently reports motion,
        # else the first camera (so we still show a live thumbnail).
        camera = next((c for c in blink.cameras.values()
                       if c.attributes.get("motion_detected")), None) \
            or next(iter(blink.cameras.values()))
        cam_name = camera.name

    if camera is None:
        bc.write_status_field(state="ok", message="no cameras on this account",
                              updatedAt=now_iso())
        return

    motion_at = (newest or {}).get("created_at")
    clip_id = (newest or {}).get("id")

    # 1) A NEW motion clip → show that motion frame (the actual event).
    got = False
    if clip_id is not None and clip_id != state.get("last_clip_id"):
        got = await _snapshot_from_clip(camera, bc.BLINK_DIR)
        if got:
            state["last_clip_id"] = clip_id

    # 2) No new clip → actively request a FRESH still. Blink only refreshes its
    #    thumbnail on motion or an explicit snapshot, so without this the same old
    #    frame is re-saved forever. snap_picture() tells the camera to take a new
    #    photo; give it a moment to upload, refresh, then download the thumbnail.
    if not got:
        if SNAP:
            try:
                await camera.snap_picture()
                await asyncio.sleep(SNAP_WAIT)
                await blink.refresh(force=True)
            except Exception as e:  # noqa: BLE001
                log(f"snap_picture failed: {e}")
        await _snapshot_from_thumbnail(camera)

    bc.write_status_field(
        state="ok",
        camera=cam_name,
        motionAt=motion_at,
        motion=bool(camera.attributes.get("motion_detected")),
        temperature=camera.attributes.get("temperature"),
        battery=camera.attributes.get("battery"),
        message=None,
        updatedAt=now_iso(),
    )


async def main() -> int:
    creds = bc.load_creds()
    if not creds:
        bc.write_status({"state": "needs-login",
                         "message": "run src/blink/blink_login.py to connect Blink",
                         "updatedAt": now_iso()})
        log("no saved session — run blink_login.py first. Idling.")
        # Idle-wait so the service stays up; the widget shows the needs-login state.
        while not bc.load_creds():
            await asyncio.sleep(15)
        creds = bc.load_creds()

    session = ClientSession()
    state = {"last_clip_id": None}
    try:
        blink = Blink(session=session)
        blink.auth = Auth(creds, no_prompt=True, session=session)
        try:
            await blink.start()
        except BlinkTwoFARequiredError:
            bc.write_status({"state": "needs-login",
                             "message": "session expired — re-run blink_login.py",
                             "updatedAt": now_iso()})
            log("saved session needs 2FA again — re-run blink_login.py.")
            return 2
        if not blink.available:
            bc.write_status({"state": "needs-login",
                             "message": "couldn't restore session — re-run blink_login.py",
                             "updatedAt": now_iso()})
            log("start() did not come up available — re-run blink_login.py.")
            return 2
        log(f"connected; cameras: {', '.join(blink.cameras) or '(none)'}")

        fails = 0
        while True:
            try:
                await poll_once(blink, state)
                fails = 0
            except Exception as e:  # noqa: BLE001
                fails += 1
                log(f"poll error ({fails}): {e}")
                bc.write_status_field(state="ok", message=None, updatedAt=now_iso())
                if fails >= 5:
                    log("too many failures — restarting session")
                    return 3  # let systemd restart us with a fresh session
            await asyncio.sleep(POLL)
    except Exception as e:  # noqa: BLE001
        log(f"startup failed: {e}")
        bc.write_status_field(state="needs-login",
                              message="couldn't connect — re-run blink_login.py",
                              updatedAt=now_iso())
        return 1
    finally:
        await session.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
