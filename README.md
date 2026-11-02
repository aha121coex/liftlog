# LiftLog — personal iPhone workout tracker

LiftLog 4.3 — a local-only workout tracker. **No Google account, OAuth client or cloud sync is required.** Workouts save on your iPhone; sharing and backups happen when you choose.

## Features

- One-tap set completion and individual-set recall, including ramp-up weights and reps
- Exercise-specific increments in pounds and kilograms, with exact manual entry
- Custom exercises, saved routines, recommendations, full history and progress
- Offline local saving, an IndexedDB mirror, JSON backup/restore and CSV export
- Routine import and workout summary sharing for ChatGPT

## Cardio and Apple Fitness

Use the **Cardio** tab for walks, dog walks, jogs, treadmill, stairs, bike, elliptical or rowing. Start a cardio session, or add an activity to your current lifting workout. **Log a separate / completed session** records an already-finished activity without replacing an unfinished lift. Cardio-only sessions never advance A/B/C. Existing bike/stair entries appear in Cardio without being copied or counted twice.

Log duration, optional distance and effort (1–10), plus any machine/monitor readings you have. Route/machine details can include speed, incline, level, floors and average heart rate. No watch is required, and missing readings stay blank. New entries recall the previous duration but do not automatically copy old actual distance, heart rate or effort.

Six-week logged-minute totals show activity volume. Name the same route or machine in two workouts to compare repeat sessions; treadmill comparisons also require speed and incline, and stairs require a level. Different machines, entered settings, measurement sources and with-lifting contexts remain separate. Pace can be viewed in min/km or min/mi. The charts are performance comparisons, not invented VO₂ max estimates or a fitness diagnosis.

Apple Fitness remains your phone's step tracker. LiftLog does not read Fitness or Health automatically. Optionally enter the daily step total shown in Fitness; changing the same date replaces that total, and walks are never added to it again. Cardio measurements and step records are included in complete JSON backups and shared snapshots. Workout CSV exports include cardio measurements; ChatGPT summaries include recent step totals.

Automatic HealthKit access would require an authorized native iPhone component; the current Home Screen web app cannot do that. A future wearable is optional. No cloud synchronization, OpenAI API key or subscription is required.

## Choose where to start

Tap the workout name on Today to choose A, B or C. You can start mid-rotation without logging yesterday's workout. Your choice is saved if you close the app before starting. Finish B and the next suggestion becomes C; finish C and it returns to A. Use suggestion switches back to the automatic choice.

Suggestions follow the latest recorded routine for your current equipment. Blank/custom workouts and edits to old sessions do not advance the rotation. Full-gym and travel-gym rotations are independent. You can also tap the active workout title or Change routine on Today; switching to a different workout requires confirmation before replacing unfinished sets.

## Share with ChatGPT

In **More → Work with ChatGPT → Share backup**, choose ChatGPT if your iPhone offers it in the share sheet. Otherwise save the JSON file to Files and attach it to your chat. The file includes your full history, custom exercises, routines, settings and current workout. Sharing does not modify the database or grant ongoing access. You can also share a short summary. Import a suggested routine using **Import a routine**; completed workouts remain unchanged.

ChatGPT cannot directly open your iPhone database. It can analyze the snapshot you attach and return a routine in LiftLog's import format. For example: “Review my workout history and return a revised routine as LiftLog routine JSON, without changing my recorded workouts.” The existing routine importer matches exercise names in your library.

Legacy Google sync and its experimental replacement core remain disabled and outside current scope. See [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for the historical review and [AGENTS.md](AGENTS.md) for current requirements.

## Local development and checks

No runtime dependencies are required. Use Node 22 or later and Python 3. After changing shipped app files, regenerate the verified release hashes:

```sh
python3 scripts/prepare-shell.py
npm run check
npm test
python -m http.server 8000
```

Open `http://localhost:8000/`. For the optional browser smoke test, install Python Playwright and Chromium, run `npm run build`, then `python scripts/browser-smoke.py`. Use `python scripts/upgrade-smoke.py` to test the v4 upgrade against synthetic history. The smoke script also accepts `--url` for testing a published release in an isolated profile. The script uses `/usr/bin/chromium`, serves a temporary localhost site, and tests synthetic data only. It covers touch-sized logging, reload, offline operation, backup round-trip and local recovery. It does not establish physical iPhone Safari reliability.

## Data safety

The primary key remains `liftlog.personal.v1`; updates must preserve it. IndexedDB is a second copy on the same device, not an independent backup. Export JSON to Files regularly and before updates, restores or changing phones. CSV is for inspection and cannot restore the complete app.

Restore validates before replacing state, preserves the previous raw database at `liftlog.personal.v1.beforeRestore`, and removes old cloud baselines and pending deletions. Failure to save either the recovery copy or replacement aborts restore. Restore replaces rather than merges local history. Use **Download data from before last restore** to recover the preserved raw database. The recovery slot is overwritten on the next restore and removed by explicit reset.

Unreadable saved data opens a recovery screen instead of overwriting history. Download the raw data before restoring a known-good backup. Startup waits for the IndexedDB recovery check before accepting workout edits when the primary copy is missing. Erasing local data requires two confirmations. No remote data is changed.

## Installation and updates

The permanent address is `https://aha121coex.github.io/liftlog/`. Keep the same origin, path, manifest identity and storage keys across upgrades; do not reinstall or clear Safari data to update. Source changes are reviewed in a PR. The publishing workflow tests and builds an explicit allowlist of public app files, then deploys it through GitHub Pages. Personal workouts and backups are never part of the published artifact. Run `npm run build` to inspect the artifact in `dist/`.

Only one LiftLog window can edit at a time. If the app reports another open window, close it and tap Try again. This requires a modern Safari version with Web Locks support. Before the first upgrade from v4, export a backup and close all old LiftLog tabs/windows, since old versions do not participate in the lock. Future updates install a verified complete shell and activate after the previous windows close, preserving saved history.
