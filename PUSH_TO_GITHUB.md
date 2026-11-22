# Pushing DataVista to a new GitHub repository

The repository is initialised, committed and verified in `/home/user/datavista`.
105 files tracked, working tree clean, no secrets, no `node_modules`, no database
files. All that remains is authentication, which only you can supply.

---

## Option 1 — HTTPS with a personal access token (fastest)

1. Create an empty repo on GitHub (**no** README, `.gitignore` or licence —
   this history already exists):

   <https://github.com/new> → name it e.g. `datavista-analytics` → **Create repository**

2. From the workspace, run:

```bash
cd /home/user/datavista

git remote add origin https://github.com/<YOUR_USERNAME>/datavista-analytics.git

# Use a fine-grained PAT with "Contents: read and write" for this repo
git push -u origin main
```

When prompted:

- **Username**: your GitHub username
- **Password**: the personal access token (not your account password)

Create a token at <https://github.com/settings/tokens> → *Generate new token
(fine-grained)* → select the new repository → *Contents: Read and write*.

To avoid the prompt entirely for one command:

```bash
git push -u origin main \
  https://<YOUR_USERNAME>:<YOUR_TOKEN>@github.com/<YOUR_USERNAME>/datavista-analytics.git
```

> If your shell history is recorded, prefer the prompt or a credential helper —
> a token in the URL ends up in `~/.git/config` and shell logs.

---

## Option 2 — SSH key

```bash
# 1. Generate a key dedicated to this machine (no passphrase, or you'll be prompted)
ssh-keygen -t ed25519 -C "datavista-workspace" -f ~/.ssh/id_ed25519 -N ""

# 2. Print the public key and add it to GitHub
#    https://github.com/settings/keys → New SSH key
cat ~/.ssh/id_ed25519.pub

# 3. Verify the connection, then push
ssh -T git@github.com
cd /home/user/datavista
git remote add origin git@github.com:<YOUR_USERNAME>/datavista-analytics.git
git push -u origin main
```

---

## Option 3 — GitHub CLI (creates the repo and pushes in one step)

```bash
# Install gh if needed, then authenticate (choose HTTPS + browser or paste a token)
gh auth login

cd /home/user/datavista
gh repo create datavista-analytics --private --source=. --remote=origin --push
```

Swap `--private` for `--public` if you want it visible. `gh repo create` makes
the remote, sets `origin` and pushes the existing `main` branch.

---

## Option 4 — Push from your own machine (bundle transfer)

If you would rather not handle credentials in this sandbox, the whole history is
packaged in **`/home/user/datavista-repo.bundle`** (253 KB, verified complete).
Download it, then locally:

```bash
git clone datavista-repo.bundle datavista-analytics
cd datavista-analytics
git remote set-url origin https://github.com/<YOUR_USERNAME>/datavista-analytics.git
git push -u origin main
```

---

## What gets pushed

```
105 files · 1 commit · main branch
├── apps/api/             Express API + 70 tests
├── apps/web/             React SPA + 22 tests
├── services/analytics/   FastAPI service + 53 tests
├── tests/e2e/            3 Playwright journeys
├── docs/                 architecture, API, security, testing, traceability
├── infra/nginx.conf
├── Dockerfile.{api,analytics,web} · docker-compose.yml
├── .github/workflows/ci.yml
└── README.md · BUILD_SUMMARY.md
```

Deliberately **not** pushed (already in `.gitignore`):

| Excluded | Why |
|---|---|
| `node_modules/` | reinstalled via `npm ci` |
| `apps/api/.data/` | local PGlite database and uploaded files |
| `apps/web/dist/` | build output, produced by CI |
| `.env` | no real `.env` exists; only `.env.example` is committed |
| `__pycache__/`, `.pytest_cache/`, `test-results/` | generated |

## After the first push

1. **Set the commit identity to yourself** — the existing commit is authored as
   `DataVista Builder <builder@datavista.local>`. To re-author it:

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
git commit --amend --reset-author --no-edit
git push --force-with-lease origin main
```

2. **Add repository secrets** for CI if you deploy from GitHub Actions:
   `JWT_SECRET`, `ANALYTICS_SERVICE_TOKEN`, `POSTGRES_PASSWORD`.
3. **Confirm the CI workflow runs** (`.github/workflows/ci.yml` runs all three
   suites plus the three Docker builds on every push).
4. Keep `AUTO_SEED=false` in any real environment so the demo accounts are never
   created in production.

## If the push is rejected

| Message | Cause | Fix |
|---|---|---|
| `remote: Repository not found` | Wrong URL, or token lacks access to this repo | Check the owner/repo spelling; confirm the token is scoped to it |
| `Updates were rejected because the remote contains work…` | You created the repo *with* a README | `git pull --rebase origin main` then push, or recreate the repo empty |
| `Authentication failed` | Used an account password instead of a PAT | Create a fine-grained token with Contents: read/write |
| `Permission denied (publickey)` | SSH key not added to GitHub | Re-run `ssh -T git@github.com` and add the key at github.com/settings/keys |
