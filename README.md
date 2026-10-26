# Oakville Election Night

Live results and news for the Oakville 2026 municipal election, built for iPhone.

**App:** https://mg4trading.github.io/oakville-election/
On iPhone: open in Safari, tap Share, then **Add to Home Screen**.

## How it updates
- `.github/workflows/update.yml` runs every hour (and whenever you tap **Run workflow** under the Actions tab).
- `scripts/update.mjs` reads:
  - **Results:** Town of Oakville election site, with Poliwave as a backup.
  - **News:** Google News searches, Oakville News, Inside Halton, CHCH, Reddit r/oakville, and YouTube channels (CHCH, CP24, CBC, YourTV).
- It writes `data/results.json` and `data/news.json`; the page reads those files and refreshes itself every 5 minutes.

## If the automatic count misses a race
Edit `data/manual.json` in the GitHub app: copy the `_w7-reg` example, remove the underscore from the key, enter the numbers and commit. Manual numbers win over the automatic count.

## If the Town's results page has a new address tonight
Settings > Secrets and variables > Actions > Variables > add `RESULTS_URL` with the page address, then run the workflow.

## Changing races or candidates
Edit `data/races.json`.
