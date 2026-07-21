# SukiDesk Cloud Sync Setup (Google Sheets backend)

This connects `app.html` to a Google Sheet you own, so your data survives
browser resets and multiple devices (owner phone + shop tablet) can share
the same Queue/Clients/Dashboard. Takes about 10 minutes, no coding needed
beyond copy-paste.

## 1. Create the Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new
   blank spreadsheet.
2. Name it something like **"SukiDesk — Hype District Plaridel Data"**.
3. You don't need to create tabs by hand — the script creates
   `Staff`, `Clients`, `Bookings`, `Transactions`, and `Services` tabs
   automatically the first time it runs.

## 2. Add the script

1. In the Sheet, go to **Extensions > Apps Script**.
2. Delete anything in the default `Code.gs` editor.
3. Paste in the entire contents of [`Code.gs`](Code.gs) from this folder.
4. Click the **Save** icon (or Ctrl+S).

## 3. Set your secret token

This stops random people from reading/writing your shop's data if they
ever guess your Web App URL.

1. In the Apps Script editor, click the gear icon **Project Settings** on
   the left sidebar.
2. Scroll to **Script Properties** > **Add script property**.
3. Property name: `SUKIDESK_SECRET`
4. Value: make up a long random password (e.g. `hd-plaridel-9f2ab71c`).
   Save it somewhere — you'll paste the same value into the app's
   Settings tab.
5. Click **Save script properties**.

## 4. Deploy as a Web App

1. Back in the Apps Script editor, click **Deploy > New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Fill in:
   - **Description:** SukiDesk API
   - **Execute as:** Me (your own account)
   - **Who has access:** Anyone
     (This just means anyone *with the URL* can hit the endpoint — the
     secret token from step 3 is what actually protects your data. Don't
     use "Anyone" without setting a secret.)
4. Click **Deploy**.
5. Google will ask you to authorize the script — click through the
   "Google hasn't verified this app" warning (it's your own script) and
   allow access.
6. Copy the **Web app URL** it gives you — looks like
   `https://script.google.com/macros/s/AKfycb.../exec`.

## 5. Connect the app

1. Open `app.html`, log in as Owner.
2. Go to the **Settings** tab.
3. Paste the Web App URL and the secret token from step 3.
4. Click **Save Settings**, then **Push to Cloud Now** to send your
   current local data up to the Sheet for the first time.
5. On any other device, open `app.html`, go to Settings, enter the same
   URL + token, save, then **Pull from Cloud Now** to load the shared data.

After that, the app auto-pulls the latest data on every login and
auto-pushes a few seconds after anything changes — you shouldn't need to
press the buttons again day-to-day. They're there for manually forcing a
sync if you're troubleshooting (e.g. "this tablet looks out of date").

## 6. Connect online reservations (optional)

The website's booking webhook (`api/stripe-webhook.js`, a separate Vercel
project) can push each paid online reservation straight into this same
Sheet's `Bookings` tab — full name, phone, and email included, which never
get written to the public GitHub repo. To wire it up:

1. In that Vercel project's dashboard → Settings → Environment Variables,
   add `SUKIDESK_WEBAPP_URL` (the same Web App URL from step 4 above) and
   `SUKIDESK_SECRET` (the same secret value from step 3 — must match
   exactly).
2. Redeploy the Vercel project so it picks up the new variables.

Once set, any completed online booking shows up in the app's
**Reservations** tab after the next Pull from Cloud (or the next login).
If these two variables aren't set, the webhook just skips this step
silently — the reservation itself (written to the public repo, first name
+ last-4 phone only) is unaffected either way.

## Notes / limits

- **One writer at a time.** If two devices save changes within the same
  few seconds, the last one to sync wins and can overwrite the other's
  edit. Fine for a single walk-in-first front desk; if you ever run two
  checkout stations simultaneously, ask about upgrading this to per-record
  sync instead of whole-sheet overwrite.
- **Redeploying the script:** if you edit `Code.gs` later, use
  **Deploy > Manage deployments > Edit (pencil icon) > New version** —
  editing the code alone does not update the live Web App URL.
- You can open the Sheet directly any time to eyeball or manually fix
  data — the app will pick up your edits on its next pull.
