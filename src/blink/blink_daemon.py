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
import json
import os
import shutil
import subprocess
import sys

from aiohttp import ClientSession
from blinkpy.blinkpy import Blink
from blinkpy.auth import Auth, BlinkTwoFARequiredError

import blink_common as bc

POLL = int(os.environ.get("GARDENER_BLINK_POLL", "10"))  # seconds between refreshes (live-ish still)
# Actively request a fresh still each poll (Blink won't refresh its thumbnail on
# its own without motion). Costs a little battery; set GARDENER_BLINK_SNAP=0 to
# only update on motion. SNAP_WAIT = seconds to let the camera upload the new shot.
SNAP = os.environ.get("GARDENER_BLINK_SNAP", "1") != "0"
SNAP_WAIT = int(os.environ.get("GARDENER_BLINK_SNAP_WAIT", "3"))
_HAS_FFMPEG = shutil.which("ffmpeg") is not None


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def log(msg):
    print(f"[{now_iso()}] [blink] {msg}", flush=True)


def _atomic_jpg(src_tmp):
    os.replace(src_tmp, bc.LATEST_JPG)


MAX_CLIPS = int(os.environ.get("GARDENER_BLINK_KEEP", "60"))  # motion clips to retain


def _safe_stamp(s):
    """A filesystem-safe stamp from a clip's created_at / id."""
    return "".join(c if (c.isalnum() or c in "-_") else "-" for c in str(s))[:48]


def _load_motion_index():
    try:
        with open(bc.MOTION_INDEX) as f:
            return json.load(f)
    except Exception:
        return []


def _save_motion_index(idx):
    tmp = bc.MOTION_INDEX + ".tmp"
    with open(tmp, "w") as f:
        json.dump(idx, f)
    os.replace(tmp, bc.MOTION_INDEX)


def _prune_motion(idx):
    """Keep only the newest MAX_CLIPS events; delete the rest off disk."""
    idx.sort(key=lambda e: e.get("ts", ""), reverse=True)
    for old in idx[MAX_CLIPS:]:
        for k in ("file", "thumb"):
            p = old.get(k)
            if p:
                try:
                    os.remove(os.path.join(bc.MOTION_DIR, os.path.basename(p)))
                except OSError:
                    pass
    return idx[:MAX_CLIPS]


async def _archive_clip(camera, clip_meta):
    """Download a motion clip, SAVE it to the motion archive (mp4 + jpg frame),
    update the index, and refresh latest.jpg with the motion frame. Returns True
    if the displayed frame was updated."""
    stamp = _safe_stamp(clip_meta.get("created_at") or clip_meta.get("id") or "clip")
    mp4 = os.path.join(bc.MOTION_DIR, f"{stamp}.mp4")
    thumb = os.path.join(bc.MOTION_DIR, f"{stamp}.jpg")
    frame_tmp = bc.LATEST_JPG + ".tmp"
    got_frame = False
    try:
        await camera.video_to_file(mp4)
        if not os.path.exists(mp4) or os.path.getsize(mp4) < 1024:
            return False
        # Extract a representative frame (~1s in) for the wall + the event thumbnail.
        if _HAS_FFMPEG:
            r = subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-ss", "1", "-i", mp4,
                 "-frames:v", "1", "-vf", "scale=640:-1", frame_tmp],
                timeout=30,
            )
            if r.returncode == 0 and os.path.exists(frame_tmp) and os.path.getsize(frame_tmp) > 512:
                shutil.copyfile(frame_tmp, thumb)
                _atomic_jpg(frame_tmp)  # show the motion frame on the wall
                got_frame = True
        # Record the event in the index (newest first) and prune old clips.
        idx = _load_motion_index()
        if not any(e.get("id") == clip_meta.get("id") for e in idx):
            idx.append({
                "id": clip_meta.get("id"),
                "ts": clip_meta.get("created_at"),
                "camera": clip_meta.get("device_name"),
                "file": os.path.basename(mp4),
                "thumb": os.path.basename(thumb) if got_frame else None,
                "savedAt": now_iso(),
            })
        _save_motion_index(_prune_motion(idx))
        log(f"saved motion clip {os.path.basename(mp4)} ({os.path.getsize(mp4)} bytes)")
        return got_frame
    except Exception as e:  # noqa: BLE001
        log(f"archive clip failed: {e}")
        try:
            os.remove(frame_tmp)
        except OSError:
            pass
        return False


async def _archive_motion_snapshot(blink, camera, cam_name):
    """Motion was detected but no clip is available (Mini without a plan): snap a
    fresh frame NOW and save it to the motion archive as a still event."""
    try:
        await camera.snap_picture()
        await asyncio.sleep(SNAP_WAIT)
        await blink.refresh(force=True)
    except Exception as e:  # noqa: BLE001
        log(f"motion snap failed: {e}")
    ts = now_iso()
    thumb = os.path.join(bc.MOTION_DIR, f"{_safe_stamp(ts)}-motion.jpg")
    tmp = bc.LATEST_JPG + ".tmp"
    try:
        await camera.image_to_file(tmp)
        if not (os.path.exists(tmp) and os.path.getsize(tmp) > 512):
            return False
        shutil.copyfile(tmp, thumb)
        _atomic_jpg(tmp)  # show the motion frame on the wall
        idx = _load_motion_index()
        idx.append({"id": f"motion-{ts}", "ts": ts, "camera": cam_name,
                    "file": None, "thumb": os.path.basename(thumb), "kind": "snapshot",
                    "savedAt": ts})
        _save_motion_index(_prune_motion(idx))
        log(f"saved motion snapshot {os.path.basename(thumb)}")
        return True
    except Exception as e:  # noqa: BLE001
        log(f"motion snapshot save failed: {e}")
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
    motion_now = bool(camera.attributes.get("motion_detected"))

    # 1) A NEW motion CLIP (needs a Blink plan / local storage) → archive it + frame.
    got = False
    if clip_id is not None and clip_id != state.get("last_clip_id"):
        got = await _archive_clip(camera, newest)
        state["last_clip_id"] = clip_id  # mark seen even if frame extract failed
        motion_at = motion_at or now_iso()

    # 2) MOTION DETECTED with no retrievable clip (e.g. a Mini without a subscription):
    #    on the rising edge, snap a fresh frame and SAVE it as a motion snapshot so
    #    motion is still captured. Rising-edge so a sustained event saves once.
    motion_prev = state.get("motion_prev", {})
    if motion_now and not motion_prev.get(cam_name) and not got:
        if await _archive_motion_snapshot(blink, camera, cam_name):
            got = True
            motion_at = now_iso()
    motion_prev[cam_name] = motion_now
    state["motion_prev"] = motion_prev

    # 3) Otherwise keep the still LIVE: request a fresh snapshot each poll.
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
        motion=motion_now,
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
