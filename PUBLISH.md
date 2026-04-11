# Publishing notes

The site is published at
**https://github.com/AmberWJL/Live-TestEvo-Bench** and served via GitHub
Pages from the `main` branch root. `.nojekyll` is present so paths under
`data/` are not mangled.

## Day-to-day updates

```bash
cd livetestevolbench-site
# edit index.html, static/*, data/*
git add -A
git commit -m "…"
git push
```

GitHub Pages redeploys automatically on push to `main`; the site is live
again in ~30–60 seconds.

## Refreshing the dataset

Regenerate the JSON chunks in the research repo and copy them in:

```bash
python3 scripts/build_website_data.py \
    --tasks-dir _work/tasks --out-dir website/data
cp -r website/data/* livetestevolbench-site/data/
cd livetestevolbench-site && git add data && git commit -m "Refresh data"
git push
```

## Pages URL

`https://amberwjl.github.io/Live-TestEvo-Bench/`

To enable Pages the first time (web UI): **Settings → Pages → Source:
Deploy from a branch → Branch: `main` / `(root)` → Save**.

Via gh CLI:

```bash
gh api -X POST repos/AmberWJL/Live-TestEvo-Bench/pages \
  -f "source[branch]=main" -f "source[path]=/"
gh api repos/AmberWJL/Live-TestEvo-Bench/pages   # check status
```

## Custom domain (optional)

1. Add a `CNAME` file at the repo root containing the domain.
2. In your DNS provider, CNAME that domain → `amberwjl.github.io`.
3. In **Settings → Pages**, set the custom domain and enable HTTPS once
   the certificate is issued.

## Pending placeholders in `index.html`

- Author / affiliation lines
- BibTeX entry
- The five hero pill links (Paper, arXiv, Code, Dataset, BibTeX)
