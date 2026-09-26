# Creating the public submission repository — step by step

PRIVATE. Kept on the `archive/internal-docs` branch so it is not published.

The idea: the public repository gets **today's files only, in one fresh commit**. None of the
private repository's history, branches or pull requests come across — that history carries your
email, the legal documents and the internal notes.

## Before you start (in the private repository)

1. **Merge the cleanup PR** (#190) on GitHub. One check, the battle-test lane's "boundary" job, fails
   by design because the PR touches `battle-test/` and other folders together. Merge over it.
2. **Delete the three internal folders** still on `main`. Everything in them is preserved on this
   archive branch. On your computer, in the repository folder:

   ```bash
   git checkout main && git pull
   git rm -r docs/counsel-brief docs/archive docs/phase-reports
   git commit -m "Remove internal folders before the public release"
   git push
   ```

3. **Decide on the old screenshots** in `docs/design/uplift-2026-09-16/` (taken before the battle
   board). Keep them or `git rm -r` them the same way.

## Make the fresh repository

4. On GitHub: **New repository** → name it (e.g. `blotto-cup`) → **Private** for now → do **not** add
   a README, licence or .gitignore (the files already exist).
5. On your computer, export `main` **without history**. `git archive` copies only tracked files, so
   no local `.env`, key file or `node_modules` can slip in:

   ```bash
   cd ~                                    # or wherever you keep projects
   mkdir blotto-cup && cd blotto-cup
   git -C ~/path/to/blotto archive main | tar -x   # use your private repo's real path
   ```

6. **Remove the workflows that belong to your deployment.** They need your secrets and would fail
   on a schedule in the new repository:

   ```bash
   rm .github/workflows/backend-status.yml .github/workflows/backend-watch.yml \
      .github/workflows/deploy-backend.yml .github/workflows/deployed-drift.yml \
      .github/workflows/indexer-backfill.yml
   ```

   Kept, because they need no secrets: `ci-fast`, `on-chain`, `rehearsal`, `security-sweep`,
   `skill-evidence`, `app-test-signer`, `app-lighthouse`, `stop-the-line`.

7. **Commit as a no-reply identity**, so your personal email is not in the public history. Your
   GitHub no-reply address is under GitHub → Settings → Emails ("…@users.noreply.github.com"):

   ```bash
   git init -b main
   git config user.name "Blotto Cup"
   git config user.email "<your-id>+<your-username>@users.noreply.github.com"
   git add -A
   git commit -m "Blotto Cup: initial public release"
   ```

## Check before it goes anywhere

8. Run these in the new folder. Every one must come back clean:

   ```bash
   ./scripts/check-language.sh
   ls docs/counsel-brief docs/archive docs/phase-reports 2>/dev/null && echo "STOP: internal folders present"
   git ls-files | grep -iE '\.env$|keypair|\.pem$|id\.json' && echo "STOP: secret-shaped file"
   grep -rIl -iE 'tom@|tomtblock|founder.s wallet|FZCO|Delaware' --exclude-dir=node_modules . && echo "STOP: review these files"
   ```

   Expected, and fine if the new repository sits under your own GitHub account: your GitHub
   handle in `battle-test/registry/*.freeze.json` (it records who merged each frozen prediction and
   cannot be edited without breaking its fingerprint). Anything else found: stop and check it.

   Optional but recommended: run `gitleaks detect --no-git --source . --config .gitleaks.toml`.
   The only expected hits are the eight `sealing_pubkey` values in `battle-test/evidence/*/pool.json`
   (public keys, published by design).

## Publish

9. Push to the new repository:

   ```bash
   git remote add origin https://github.com/<you>/blotto-cup.git
   git push -u origin main
   ```

10. On GitHub, in the new repository's **Settings**:
    - **Security → Private vulnerability reporting → Enable.** `SECURITY.md` tells people to use it.
    - **General → Automatically delete head branches → On.**
    - Add a description and topics (e.g. `solana`, `anchor`, `colonel-blotto`, `nextjs`).
11. Open the **Actions** tab and let `ci-fast` run once on `main`; it should go green.
12. When you are happy, **Settings → General → Change visibility → Public**, then share the link.

## Afterwards

- Keep the private repository. It is the only place the full history and this archive branch live.
- Future work happens in the private repository; copy releases across the same way (steps 5–9),
  or make the public one the working repository from then on and stop using the private one.
