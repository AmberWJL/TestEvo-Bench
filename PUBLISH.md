# How to publish this site to GitHub Pages

All of the files you need are already here in `livetestevolbench-site/`:

```
index.html          README.md
static/             PUBLISH.md         (this file)
data/               .gitignore
.nojekyll
```

## Step 1 — initialize a clean git repo

There is a partial `.git/` directory in this folder from the Cowork session
sandbox, which you won't be able to push as-is. Wipe it and start fresh:

```bash
cd livetestevolbench-site
rm -rf .git
git init -b main
git add -A
git commit -m "Initial site: LiveTestEvolBench"
```

## Step 2a — publish via GitHub CLI (fastest)

```bash
gh repo create livetestevolbench --public --source=. --remote=origin --push
gh api -X POST repos/:owner/livetestevolbench/pages \
  -f "source[branch]=main" -f "source[path]=/"
```

The second command turns on GitHub Pages from the `main` branch root. The
site will be live at `https://<your-username>.github.io/livetestevolbench/`
in 30–60 seconds. Check the deploy status with:

```bash
gh api repos/:owner/livetestevolbench/pages
```

## Step 2b — publish via the GitHub web UI

1. Go to <https://github.com/new>, create a **public** repository named
   `livetestevolbench`. **Do not** initialize it with README / .gitignore /
   license — this repo already has those.
2. Copy the SSH or HTTPS URL from the "Quick setup" page.
3. Push:

   ```bash
   git remote add origin git@github.com:<your-username>/livetestevolbench.git
   git push -u origin main
   ```

4. In the repo on GitHub, go to **Settings → Pages**.
5. Under *Source*, pick **Deploy from a branch**.
6. Set branch = `main`, folder = `/ (root)`, click **Save**.
7. Wait ~60 seconds. The site appears at
   `https://<your-username>.github.io/livetestevolbench/`.

## After it's live

- Edit `index.html` and the files under `static/` directly; push to `main`
  and GitHub Pages redeploys automatically.
- To refresh the dataset, regenerate `data/` with
  `scripts/build_website_data.py` in the research repo, copy the new files
  into `data/`, and push.
- Update the five hero pill links (`Paper`, `arXiv`, `Code`, `Dataset`,
  `BibTeX`) in `index.html` once you have real URLs.

## Custom domain (optional)

To use e.g. `livetestevolbench.org`:

1. Add a `CNAME` file at the repo root containing `livetestevolbench.org`.
2. In your DNS provider, CNAME `livetestevolbench.org` → `<your-username>.github.io`.
3. In Settings → Pages, set the custom domain to the same value and enable
   HTTPS once the certificate is issued.

## Why the sandbox `.git/` is unusable

The Cowork shell ran `git init` + `git commit` here, but the workspace mount
doesn't permit unlinking transient `.git/*.lock` files that git leaves behind
between operations. So the staged repo has a usable initial commit but a
stuck `.git/index.lock` / `.git/HEAD.lock`, which blocks any follow-up
operation (including `git push`). Wiping `.git` and re-initing on your own
machine is the fastest path forward — your working tree (`index.html`,
`static/`, `data/`, …) is fine.
