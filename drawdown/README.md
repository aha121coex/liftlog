# Drawdown Monitor

An iPhone Home Screen watchlist for reviewing pullbacks in stocks, ETFs, Bitcoin and broad market indexes. Open the published app in Safari, use **Share → Add to Home Screen**, then tap **Add**. No Mac, App Store account or new market-data account is needed.

The app shows a rolling 365-day drawdown, drawdown from the highest reading in available history, 30- and 90-day returns, and the gain needed to regain the one-year peak. Change the review threshold in Settings or sort by drawdown. A review flag is a historical comparison, not a valuation or purchase recommendation; the same percentage can represent different risks across assets.

## Data and freshness

GitHub Actions requests a new public market snapshot hourly, including weekends for Bitcoin. Scheduled execution is best effort and can be delayed or skipped. Refresh loads the most recently published snapshot; it does not request an on-demand quote. The publication time and each actual quote time are separate. Market closures and upstream delays can make quote times older than the snapshot. Failed updates retain the preceding valid observation and explicitly mark it cached; missing data is never invented.

The initial provider is Yahoo Finance's unofficial chart service. The transport is isolated in `market.js` so it can be replaced. Daily history is requested explicitly and checked for daily granularity and coverage. Stocks and crypto use daily highs for peak comparisons, with disclosed close-price fallbacks. ETFs use dividend-adjusted closing highs and normalize the comparison price to that same scale. Missing adjusted days are excluded when adjusted history exists; entirely absent adjusted history uses a labelled close-only basis. Return comparisons use closes. All periods end at the actual quote timestamp. Daily highs and closing highs are distinct comparisons. Historical data and adjustments can be revised by the provider.

GitHub can disable scheduled workflows in inactive public repositories after 60 days. If the app warns that snapshots are old, check the **Publish apps** workflow in the repository's Actions tab and re-enable it if needed. A manual workflow run fetches and publishes a new snapshot.

## Local development

Use Node 22+ and Python 3. No runtime packages or API keys are required.

```sh
npm test
npm run check
python3 scripts/build-static.py --output /tmp/drawdown-preview
node scripts/update-data.mjs --output /tmp/drawdown-preview/data/monitor.json
python3 -m http.server 8000 --directory /tmp/drawdown-preview
```

The updater uses a previous local or published snapshot for per-symbol recovery. Public deployment contains only the allowlisted app shell and a public market-data JSON file. Transport source, tests and tools are not shipped to the browser.

The app uses only `drawdown.monitor.settings.v1` and `drawdown.monitor.readings.v1` in localStorage, and caches prefixed `drawdown-monitor-shell-`. It never changes LiftLog's storage or offline caches. Both apps share a GitHub Pages origin, so only trusted code should be hosted there. The monitor has its own manifest identity and worker scope under `/liftlog/drawdown/`.

Browser and automated checks do not establish physical iPhone reliability. The final installation check is opening the published URL in Safari, adding it to the Home Screen and reopening the icon.

## Manage the watchlist

Choose a period and a sort order on either list. Periods are rolling 30, 183, 365 and 1,826 days, ending at the quote timestamp. Each decline compares the quote with the highest available observation in that window. Shorter histories are flagged. Company and fund names determine A–Z order. The Nasdaq Composite and S&P 500 are displayed in index points.

Use **Add a ticker** to enter a USD stock, ETF, crypto pair or index symbol. Continue to GitHub and submit the prefilled public issue as the repository owner. The next scheduled update reads open owner-created requests and adds matching symbols, up to 50 total. Close a request to remove the custom symbol. Unknown or unavailable symbols display a data error.
