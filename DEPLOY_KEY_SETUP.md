# Push to GitHub — deploy key handoff

Repo: `git@github.com:Moha569-A/datavista.git`

## Status (verified)

| Check | Result |
|---|---|
| `origin` remote set | ✅ `git@github.com:Moha569-A/datavista.git` |
| `github.com:22` reachable | ✅ handshake completes |
| SSH authentication | ❌ `Permission denied (publickey)` — no key registered on the account yet |
| Repo exists | ❌ `https://github.com/Moha569-A/datavista` → **404** (either not created, or private) |
| Working tree | ✅ clean, 2 commits, 106 files |

Two things must be true before a push can succeed: **the repo must exist**, and **a key we hold must be authorised**.

---

## Step 1 — Create the empty repository

<https://github.com/new>

- Name: `datavista`
- Owner: `Moha569-A`
- **Do not** add a README, `.gitignore`, or licence (the history already has all three — an initialised repo causes a non-fast-forward rejection)

---

## Step 2 — Authorise the generated key

A keypair was created **inside this sandbox**; only its public half was printed, the private half never left `~/.ssh/id_ed25519`. Authorise it in **one** of two ways.

### Option A — Deploy key (scoped to this one repo, cleaner)

Repo → **Settings → Deploy keys → Add deploy key**

- Title: `arena-sandbox`
- Key: paste the public key below
- **Allow write access: ☑ must be ticked** (a read-only deploy key pushes nowhere)

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICp+XMivXZWv/+e4kYvK1bVi4jiCyDng9q9j5qvxfEdK datavista-push-arena
```

Revoke later: same page → Delete. Deploy keys cannot touch any other repo.

### Option B — Account SSH key (works for all your repos)

<https://github.com/settings/ssh/new> → paste the same key → Add SSH key.

---

## Step 3 — Tell me it's done

I will then run:

```bash
cd /home/user/datavista
ssh -T git@github.com                      # expect: "Hi Moha569-A/... You've successfully authenticated"
git push -u origin main                    # expect: new branch main -> 2 commits
```

`.github/workflows/ci.yml` is in the history. Pushing a workflow file over **SSH with a deploy key is allowed** (the `workflow` scope restriction only applies to OAuth/fine-grained tokens), so no extra permission is needed here.

---

## If you'd rather push it yourself

The bundle holds the complete history in one file — download `/home/user/datavista-repo.bundle`, then locally:

```bash
git clone datavista-repo.bundle datavista
cd datavista
git remote set-url origin git@github.com:Moha569-A/datavista.git
git push -u origin main
```

This uses **your own** SSH key and needs nothing from me.

---

## Note on what was sent

The message contained the clone URL `git@github.com:Moha569-A/datavista.git` — that is a repository address, not a secret or a key. GitHub SSH URLs are identical for everyone and are safe to share; access is decided entirely by which keys are authorised. No credential of yours was transmitted or stored.
