# LiftLog — personal iPhone workout tracker

Security review revision of LiftLog v4. **Google authentication and synchronization are disabled pending least-privilege authentication and data-integrity testing.** Offline logging and local backups remain available. This revision is proposed through a pull request; it does not publish the app.

## Features

- One-tap set completion and individual-set recall, including ramp-up weights and reps
- Exercise-specific increments in pounds and kilograms, with exact manual entry
- Custom exercises, saved routines, recommendations, full history and progress
- Offline local saving, an IndexedDB mirror, JSON backup/restore and CSV export
- Routine import and workout summary sharing for ChatGPT

The intended Google integration is two-way synchronization with a private Sheet, including routine edits made through ChatGPT's separately authorized connection. The legacy implementation is retained for review but blocked from authenticating or making requests. See [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for findings and release gates, and [AGENTS.md](AGENTS.md) for the development contract. Do not enable it by simply changing the flag.

## Local development and checks

No build step or runtime dependencies are required. Use Node 22 or later:

```sh
npm run check
npm test
python -m http.server 8000
```

Open `http://localhost:8000/`. For the optional Chromium smoke test, install Python Playwright and Chromium, then run `python scripts/browser-smoke.py`. The script uses `/usr/bin/chromium`, serves a temporary localhost site, and tests synthetic data only. It covers touch-sized logging, reload, offline operation, backup round-trip and local recovery. It does not establish physical iPhone Safari reliability.

## Data safety

The primary key remains `liftlog.personal.v1`; updates must preserve it. IndexedDB is a second copy on the same device, not an independent backup. Export JSON to Files regularly and before updates, restores or changing phones. CSV is for inspection and cannot restore the complete app.

Restore validates before replacing state, preserves the previous raw database at `liftlog.personal.v1.beforeRestore`, and removes old cloud baselines and pending deletions. Failure to save either the recovery copy or replacement aborts restore. Restore replaces rather than merges local history. The recovery slot is overwritten on the next restore and removed by explicit reset.

Unreadable saved data opens a recovery screen instead of overwriting history. Download the raw data before restoring a known-good backup. Startup waits for the IndexedDB recovery check before accepting workout edits when the primary copy is missing. Erasing local data requires two confirmations and does not delete the private Sheet.

## Future deployment

The permanent intended address is `https://aha121coex.github.io/liftlog/`. Keep the same origin, path, manifest identity and storage keys across upgrades; do not reinstall or clear Safari data to update. Changes must be reviewed in a PR before any publishing step. This review does not enable Pages, modify hosting configuration or merge to main.

For future OAuth setup, use a public web client ID with exact authorized origins, short-lived tokens in memory, and a tested file-specific authorization grant. Never publish client secrets, tokens, workout backups or Sheet data. The existing `spreadsheets` scope is too broad for the intended least-privilege design. A hard-coded Sheet ID does not narrow its grant.
