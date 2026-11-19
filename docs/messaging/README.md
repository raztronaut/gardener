# Resident messaging setup

GardenOS sends full summaries, selected articles and itineraries, and dictated notes directly through a free Photon shared iMessage project. Residents use their phone's Messages app. They do not need a GardenOS or Photon account.

## Manage residents on the wall

Type **`/residents`** in GardenOS, or say **“Hey Garden, manage residents.”** `/users`, `/people` and `/recipients` open the same page.

1. Enter the resident's name and phone number, then choose **Add resident**. US numbers can be entered with or without `+1`; other countries require their country code.
2. The page shows that resident's assigned GardenOS sender. From the phone number you added, the resident sends **Hi Garden** to that sender using Messages.
3. Choose **Refresh activation**. **Ready to receive** means Photon has recorded their opt-in. **Needs activation** means that first text is still needed. An unavailable check is shown as unknown, not ready.

Adding a resident does not send an invitation or test message. Sender numbers may differ between residents because the free plan uses shared lines.

**Edit** changes a display name or optional voice nicknames, such as a common speech-recognition spelling. Names and nicknames must be unique. To replace a phone number, remove that resident and add them with the new number; the new phone activates separately.

**Remove** asks for confirmation on the wall, removes the Photon phone registration, and removes the resident from the Send to picker and voice recipient list. Already sent messages remain on the recipient's phone. A failed provider removal leaves the saved resident in place and shows an error, so removal can be retried.

This address book controls messaging only. It does not add or delete Roots profiles, Google accounts, or task assignments. The management page is available only through the local GardenOS wall, never through the public Roots tunnel.

## Send something

Open a readable item, select **Send to…**, and choose a resident. The picker also has **Write a note instead**.

Voice examples:

- “Send the daily news summary to Razi.”
- “Send this to Gui.”
- “Send a note to Max saying hello.”

“This” means the selected edition, article, itinerary, or readable panel. An empty wall refuses to send. Notes preserve the dictated message's case and punctuation. Content arrives directly in Messages; original article or directions links may accompany it, but house-tunnel links are not required to read it.

The wall distinguishes sending, accepted, sent, delivered, failed, and uncertain outcomes. If delivery is uncertain, check the phone before sending again. GardenOS never automatically retries an uncertain send.

## Initial owner setup on a new installation

The current machine is already connected. These steps are for recovery or another installation.

1. Install the app's backend dependencies with `npm install` in the GardenOS checkout.
2. Install Photon's operator CLI: `npm install --global @photon-ai/cli@2.2.0`.
3. Run `photon login --no-browser` and approve the printed URL/code in the owner's browser. Do not paste API keys into chat.
4. Create a separate free project: `photon projects create --name GardenOS --platforms imessage --json`. Save the returned project ID; do not upgrade or add billing.
5. Run `node tools/setup-messaging.mjs --project PROJECT_ID`. The helper captures the existing project secret privately, verifies the free plan and absence of billing, and writes the local configuration. It preserves existing residents and refuses to replace a different configured project. If the CLI is outside PATH, set `PHOTON_CLI` to its absolute executable path for this command.
6. Restart `gardener-backend.service` only if new backend source/dependencies were installed. Opening `/residents` reads configuration dynamically; ordinary add/edit/remove operations require no service restart or kiosk reload.

Private state is under gitignored `data/messages/`. `config.json` contains the project credential and recipients and must remain mode `0600` inside an owner-only directory. Back it up privately. Never publish it, copy it into the frontend, or include it in screenshots or support logs.

## Cost and operational limits

GardenOS verifies the free tier and absence of a subscription or billing customer before provisioning recipients or sending. It uses only the shared iMessage route and has no billing, upgrade, automatic-reminder, or paid-fallback path. Photon enforces the free plan's recipient limits; reaching a limit is an error, not an upgrade.

The backend loads the messaging SDK only for an explicit send and closes the client afterwards. Activation checks happen when the Residents page opens or Refresh activation is selected; there is no background roster polling.

For the current Photon service, use `chats.create([phone], {message, clientMessageId})`, including for existing conversations. The ordinary MessageService send route has returned “Target not allowed” for correctly opted-in recipients. Only a delivery receipt establishes confirmed delivery.

Local APIs are `GET /api/messages/residents`, `POST /api/messages/residents/save`, and `POST /api/messages/residents/remove`. Existing sending APIs remain under `/api/messages/`. No `/api/messages/*` route belongs in the public tunnel allowlist.

Checks: `node --test tools/messages.test.mjs tools/residents.test.mjs tools/messaging-setup.test.mjs`; browser checks use external Playwright and intercept mutations and sends. Do not add fictional people to the live Photon account for testing.
