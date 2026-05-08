# TestEvo-Bench — project site

**Live site:** <https://www.testevo-bench.com/>

Static site for **TestEvo-Bench**, a live benchmark of co-evolving test
and production code pairs mined from real open-source Java projects.

This repository holds only the public-facing project page and the JSON data
chunks it loads. The benchmark source code, data collection pipeline, and
evaluation harness live in a separate (private) research repository.

## Contents

```
index.html          hero, abstract, dataset overview, explorer, leaderboard
static/             style.css, explorer.js, leaderboard.js
data/
  index.json        per-repo task manifest (compact, used for time-filtering)
  repos/*.json      per-repo rev-pair detail (lazy-loaded when a row is expanded)
  leaderboard.json  seeded leaderboard entries
.nojekyll           disables Jekyll so paths starting with _ are served
```

## Run locally

```
python3 -m http.server 8000
# open http://localhost:8000
```

No build step — edit the files directly.

## Regenerating `data/`

The JSON chunks are produced by a script in the research repo:

```
python3 scripts/build_website_data.py --tasks-dir _work/tasks --out-dir website/data
```

Then copy `website/data/` back into this repo and commit.

## Deploying

This site is served via GitHub Pages from the `main` branch, root directory.
`.nojekyll` is present so the `data/` directory is not mangled.

## Submitting to the leaderboard

See the "How to submit" section on the site itself.