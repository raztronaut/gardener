"""Shared helpers for the Gardener Blink integration.

The wall is a no-build Node app, but Blink has no keyless HTTP API — the only sane
client is the Python `blinkpy` library. So this tiny Python sidecar handles auth +
polling and writes plain files the Node server already knows how to serve:

  <data>/blink/creds.json   saved Blink session (token etc.) — chmod 600, gitignored
  <data>/blink/latest.jpg   most-recent motion snapshot
  <data>/blink/latest.json  metadata: { state, camera, motionAt, updatedAt, ... }

Nothing here ever prints secrets.
"""
import json
import os
import stat

# data/blink lives at <repo>/data/blink (mirrors paths.BLINK in config.mjs); allow
# an override so this matches GARDENER_DATA if the Node side uses a custom data dir.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))
DATA = os.environ.get("GARDENER_DATA") or os.path.join(_ROOT, "data")
BLINK_DIR = os.path.join(DATA, "blink")
CREDS = os.path.join(BLINK_DIR, "creds.json")
LATEST_JPG = os.path.join(BLINK_DIR, "latest.jpg")
LATEST_JSON = os.path.join(BLINK_DIR, "latest.json")


def ensure_dir():
    os.makedirs(BLINK_DIR, exist_ok=True)


def save_creds(data: dict):
    """Persist the Blink session, owner-readable only (it holds an auth token)."""
    ensure_dir()
    tmp = CREDS + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)  # 600
    os.replace(tmp, CREDS)


def load_creds():
    if not os.path.exists(CREDS):
        return None
    with open(CREDS) as f:
        return json.load(f)


def write_status(obj: dict):
    """Atomically update latest.json (the widget reads this)."""
    ensure_dir()
    tmp = LATEST_JSON + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f)
    os.replace(tmp, LATEST_JSON)


def write_status_field(**fields):
    """Merge fields into the existing status (keeps last-good values)."""
    cur = {}
    if os.path.exists(LATEST_JSON):
        try:
            with open(LATEST_JSON) as f:
                cur = json.load(f)
        except Exception:
            cur = {}
    cur.update(fields)
    write_status(cur)
