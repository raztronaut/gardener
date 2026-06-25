#!/usr/bin/env python3
"""Interactive Blink login — run ONCE to authorize the wall.

    data/blink/venv/bin/python src/blink/blink_login.py

Prompts for your Blink email + password, triggers Blink's 2-factor code (sent to
your email/SMS), asks you to type it in, then saves the session token to
data/blink/creds.json so the polling daemon can run unattended afterwards.

Re-run it any time the saved session expires.
"""
import asyncio
import getpass
import sys

from aiohttp import ClientSession
from blinkpy.blinkpy import Blink
from blinkpy.auth import Auth, BlinkTwoFARequiredError

import blink_common as bc


async def main() -> int:
    print("\n=== Blink login for The Gardener ===\n")
    username = input("Blink email: ").strip()
    password = getpass.getpass("Blink password: ")
    if not username or not password:
        print("email and password are required.")
        return 1

    session = ClientSession()
    try:
        blink = Blink(session=session)
        auth = Auth(
            {"username": username, "password": password},
            no_prompt=True,  # we drive the 2FA prompt ourselves
            session=session,
        )
        blink.auth = auth

        # A new device almost always needs a 2FA code: start() raises, then
        # send_2fa_code() completes the OAuth login + full setup.
        try:
            await blink.start()
        except BlinkTwoFARequiredError:
            print("\nBlink sent a verification code to your email / phone.")
            code = input("Enter the 2FA code: ").strip()
            ok = await blink.send_2fa_code(code)
            if not ok:
                print("\n2FA verification failed — double-check the code and re-run.")
                return 1

        # Confirm we can actually see cameras before declaring success.
        await blink.refresh()
        cams = list(blink.cameras.keys())
        if not cams:
            print("\nLogged in, but no cameras were found on this account.")
        else:
            print(f"\nConnected. Cameras: {', '.join(cams)}")

        bc.save_creds(blink.auth.login_attributes)
        print(f"\nSaved session → {bc.CREDS}")
        bc.write_status({"state": "ok", "camera": None, "motionAt": None,
                         "message": "logged in — waiting for motion", "updatedAt": _now()})
        print("Done. The Blink daemon can now poll for motion.\n")
        return 0
    except Exception as e:  # noqa: BLE001 — surface a friendly message
        print(f"\nLogin failed: {e}")
        return 1
    finally:
        await session.close()


def _now():
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
