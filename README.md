# LiftLog v4 — Personal iPhone workout tracker

**Status:** Complete working PWA package with Google Sheets sync implementation. Tested with a simulated Google API. The *real* Google sign-in and upload need a one-time setup; we have not verified iPhone OAuth or published this revision yet.

## Features

- One-tap completion of a set with per-set recall of the exact last weight and repetitions
- Adjustable weight increments per exercise, plus any custom typed weight
- Suggested routines from your full gym or travel gym, customizable routines and custom exercises
- Local first: works offline, records sets without waiting for cloud services
- Local secondary IndexedDB copy, downloadable JSON backup and CSV export
- Authenticated Google Sheets synchronization of completed workouts, individual sets, exercises and routines
- Pulls edits made to your private Google Sheet (including edits made by ChatGPT)
- Detects a simultaneous phone-vs-Sheet edit and asks which to keep rather than silently overwriting a workout
- Automatic online sync while signed in; short-lived Google authorization must be renewed periodically
- Same GitHub Pages URL and iPhone Home Screen icon across future releases

## Your private Google Sheet

https://docs.google.com/spreadsheets/d/1kqksEeg9CO4UCigEWgbBK0WldeoLzp_5Vw4TPKYHWtU/edit

The Google Sheet belongs to `aha121coex@gmail.com` and is currently restricted. The Sheet ID appearing in this public source code is *not* an access credential. No password, access token, API key or client secret is present in this repository.

## Step 1 — Upload the files to GitHub (once)

Repository: https://github.com/aha121coex/liftlog

On the iPhone, save and uncompress this ZIP in Files. Open the repository in Safari and use **Add file → Upload files**. Select the individual files **inside** the unzipped folder, not the ZIP and not the containing folder. Commit to `main`. Preserve these filenames in the repo root:

- `index.html`
- `app.js`
- `sync.js`
- `styles.css`
- `sw.js`
- `manifest.webmanifest`
- `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`
- `README.md`
- `.nojekyll` (optional; iOS may hide dotfiles)

Don't upload workout backups or OAuth tokens to your public repository.

## Step 2 — Enable GitHub Pages (once)

From repository **Settings → Pages**, set:
- Build and deployment source: **Deploy from a branch**
- Branch: **main**
- Folder: **/ (root)**
- Save.

When publishing completes, the address is:

https://aha121coex.github.io/liftlog/

That URL will be stable across upgrades. We have not claimed the site is live yet.

## Step 3 — Create your free OAuth web client (once)

This is needed because GitHub Pages is public but the Google Sheet must remain private. Google itself authenticates access; LiftLog never sees your Google password.

Sign in as `aha121coex@gmail.com` and open https://console.cloud.google.com/ .

1. Create a project, e.g. **LiftLog**.
2. From **APIs & Services → Library**, enable **Google Sheets API**.
3. From **Google Auth Platform → Branding**, configure the consent screen with app name **LiftLog**. Choose **External** audience for a consumer Gmail account (Internal only works for Workspace organizations). In **Audience**, add `aha121coex@gmail.com` as a **test user**. Include Sheets access in **Data Access** if prompted.
4. In **Google Auth Platform → Clients**, choose **Create Client → Web application**.
5. Under **Authorized JavaScript origins**, add exactly `https://aha121coex.github.io` — **no `/liftlog` path**. No redirect URL is needed for the Google Identity Services token popup.
6. Copy the **Client ID**, which ends in `.apps.googleusercontent.com`. It is a public identifier, **not** a secret. Never paste a client secret into the app or GitHub.

Google's official documentation:
https://developers.google.com/identity/oauth2/web/guides/use-token-model
https://developers.google.com/workspace/sheets/api/quickstart/js

## Step 4 — Connect inside LiftLog

In Safari, open the LiftLog website. Tap **More → Google Sheets · two-way sync**.

1. Paste the OAuth web **Client ID**.
2. Tap **Connect Google** and select `aha121coex@gmail.com`.
3. Approve Google Sheets access.
4. Check for **Synced ✓**. If you see a Google authorization error, check that the OAuth client has the correct authorized origin and the shared Gmail address is listed as a test user.
5. Try adding a sample session and confirm that a matching new row appears in the **Workouts** and **Sets** tabs. Delete this test session afterward if desired.

Once it works in Safari, use **Share → Add to Home Screen**. If the Google popup is blocked in standalone iPhone mode, open the page in Safari while we troubleshoot; all lifting and offline local storage continue working.

## Sync behavior and limitations

- Local set logging never depends on network or sign-in. The sync *only* uploads completed workouts; unfinished workouts remain on the iPhone.
- When the app has a valid Google access token, sync runs after local changes, on reconnect/foreground, and periodically while open. OAuth tokens expire, so this is **not** a perpetual background service; reconnect from More when asked.
- The app compares the local copy and the Google copy against their last-synced signatures. If both changed, it displays a conflict that you must resolve. A conflict does not silently discard either edit.
- Don't rearrange spreadsheet columns, erase stable ID columns, physically delete rows, or sort only part of a table. You may edit the weight/reps, routine/exercise values, and notes. Use the `deleted` column rather than removing a cloud workout or set row.
- When designing new routine set weights in Google Sheets, `Routine Items` includes `set_plan_json` for per-set progression. Edit it along with `target_weight` and `target_reps` as needed.
- Use **Export complete backup** periodically. The cloud database does not replace a separate backup.
- This has been browser-tested with a simulated Google API, not yet deployed and verified with real Google OAuth on an iPhone.

## Updating LiftLog

Replace only the **app source files** in this same repository. GitHub Pages publishes an updated version at the same URL. The service worker uses a versioned cache and network-first update strategy to refresh app code without changing or erasing your locally stored workouts. Export a JSON backup before major upgrades.
