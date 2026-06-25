#!/usr/bin/env python3
"""Blink login — authorize the wall (run ONCE; re-run if the session expires).

Two ways to run:

  1. Interactive terminal (a real TTY):
       npm run blink-login
     Prompts for email, password, then the 2FA code.

  2. Headless / driven through Claude (no TTY): put credentials in .env as
       GARDENER_BLINK_USERNAME=...   GARDENER_BLINK_PASSWORD=...
     run the script; when Blink sends the 2FA code, drop it into
       data/blink/2fa_code.txt
     and the script (which is polling that file) completes the login.

On success the Blink session token is saved to data/blink/creds.json (chmod 600,
gitignored) and the polling daemon takes over. Nothing here prints secrets.
"""
import asyncio
import datetime
import getpass
import os
import sys
import time

from aiohttp import ClientSession
from blinkpy.blinkpy import Blink
from blinkpy.auth import Auth, BlinkTwoFARequiredError

import blink_common as bc

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))
CODE_FILE = os.path.join(bc.BLINK_DIR, "2fa_code.txt")


def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _from_env(key):
    """Look up a value in the process env, then in the repo .env file."""
    v = os.environ.get(key)
    if v:
        return v.strip()
    envf = os.path.join(_ROOT, ".env")
    if os.path.exists(envf):
        for line in open(envf):
            line = line.strip()
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def get_credentials(interactive):
    user = _from_env("GARDENER_BLINK_USERNAME")
    pw = _from_env("GARDENER_BLINK_PASSWORD")
    if not user:
        if not interactive:
            print("No GARDENER_BLINK_USERNAME set — add it to .env or run in a terminal.")
            return None, None
        user = input("Blink email: ").strip()
    if not pw:
        if not interactive:
            print("No GARDENER_BLINK_PASSWORD set — add it to .env or run in a terminal.")
            return None, None
        pw = getpass.getpass("Blink password: ")
    return user, pw


def get_2fa_code(interactive):
    if interactive:
        return input("Enter the 2FA code Blink just sent: ").strip()
    # Headless: poll a file the human (or Claude) writes the code into.
    try:
        os.remove(CODE_FILE)
    except OSError:
        pass
    bc.write_status({"state": "needs-2fa",
                     "message": f"Blink sent a code — write it to {CODE_FILE}",
                     "updatedAt": _now()})
    print(f"\nBlink sent a verification code. Waiting for it in:\n  {CODE_FILE}\n"
          "(write the code into that file). Waiting up to 5 minutes…", flush=True)
    for _ in range(150):
        if os.path.exists(CODE_FILE):
            code = open(CODE_FILE).read().strip()
            if code:
                try:
                    os.remove(CODE_FILE)
                except OSError:
                    pass
                return code
        time.sleep(2)
    return ""


async def main() -> int:
    interactive = sys.stdin.isatty()
    print("\n=== Blink login for The Gardener ===\n")
    username, password = get_credentials(interactive)
    if not username or not password:
        return 1

    session = ClientSession()
    try:
        blink = Blink(session=session)
        blink.auth = Auth({"username": username, "password": password},
                          no_prompt=True, session=session)
        try:
            await blink.start()
        except BlinkTwoFARequiredError:
            code = get_2fa_code(interactive)
            if not code:
                print("\nNo 2FA code received — re-run to try again.")
                return 1
            if not await blink.send_2fa_code(code):
                print("\n2FA verification failed — double-check the code and re-run.")
                return 1

        await blink.refresh()
        cams = list(blink.cameras.keys())
        print(f"\nConnected. Cameras: {', '.join(cams) if cams else '(none found)'}")

        bc.save_creds(blink.auth.login_attributes)
        bc.write_status({"state": "ok", "camera": None, "motionAt": None,
                         "message": "logged in — waiting for motion", "updatedAt": _now()})
        print(f"Saved session → {bc.CREDS}\nDone — the Blink daemon will now poll for motion.\n")
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"\nLogin failed: {e}")
        return 1
    finally:
        await session.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
