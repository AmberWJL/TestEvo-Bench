# LiveTestEvolBench — project site

**Live site:** <https://amberwjl.github.io/Live-TestEvo-Bench/>

Static site for **LiveTestEvolBench**, a live benchmark of co-evolving test
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

## Cloning only the `data/` folder

If you just want the benchmark data and not the website, use a sparse
checkout so git downloads only `data/`:

```bash
git clone --depth 1 --filter=blob:none --sparse \
    https://github.com/AmberWJL/Live-TestEvo-Bench.git
cd Live-TestEvo-Bench
git sparse-checkout set data
```

After this, the working tree contains only `data/` (plus top-level files
like `README.md`). To add or remove folders later:

```bash
git sparse-checkout set data static   # include more
git sparse-checkout disable            # go back to a full checkout
```

One-liner if you only want the files without a working git repo:

```bash
# macOS/Linux — download a tarball of just data/
curl -L https://github.com/AmberWJL/Live-TestEvo-Bench/archive/refs/heads/main.tar.gz \
  | tar -xz --strip-components=1 Live-TestEvo-Bench-main/data
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

## Citation

```bibtex
@inproceedings{livetestevolbench2026,
  title     = {LiveTestEvolBench: A Live Benchmark of Co-Evolving Test and Production Code Pairs},
  author    = {Author One and Author Two and Author Three},
  booktitle = {Proceedings of the 2026 Conference on ...},
  year      = {2026},
  url       = {https://amberwjl.github.io/Live-TestEvo-Bench/}
}
```
