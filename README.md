# Oakville Election Night

Results and 360 analysis of the Oakville 2026 municipal election, with a Ward 7 deep dive. Built for iPhone.

**App:** https://mg4trading.github.io/oakville-election/
On iPhone: open in Safari, tap Share, then **Add to Home Screen**.

## How it updates
- `.github/workflows/update.yml` runs every 6 hours (and whenever you tap **Run workflow** under the Actions tab).
- `scripts/update.mjs` reads:
  - **Results:** the Town of Oakville results data file (`2026results/data/arearesults.json`).
  - **News:** Google News searches, Oakville News, Inside Halton, CHCH, Reddit r/oakville, and YouTube channels (CHCH, CP24, CBC, YourTV).
- It writes `data/results.json`. Analysis text lives in `data/analysis.json`; 2022 baselines in `data/baseline2022.json`.

## If the automatic count misses a race
Edit `data/manual.json` in the GitHub app: copy the `_w7-reg` example, remove the underscore from the key, enter the numbers and commit. Manual numbers win over the automatic count.

## If the Town's results page has a new address tonight
Settings > Secrets and variables > Actions > Variables > add `RESULTS_URL` with the page address, then run the workflow.

## Changing races or candidates
Edit `data/races.json`.
