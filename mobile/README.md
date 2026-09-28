# `mobile/` — the Android shell for the Solana dApp Store

This folder holds the **Android package** that opens the deployed Blotto Cup site inside Solana
Mobile's WebView shell. It contains no copy of the product: every screen, rule and number a player
meets comes from the site the shell opens, so the site and the app are always the same build
(decision `D-E18`).

**Everything about building, signing, testing and publishing it is in one place:
[`docs/guide/MOBILE.md`](../docs/guide/MOBILE.md).** This file only says what is here.

| Path | What it is |
|---|---|
| `webshell.env.example` | The two environment variable names the build reads (key passwords). Names only |
| `.gitignore` | Refuses the signing key, its passwords, and build output |
| `blotto-cup/` | The generated Android project, once `webshell init` has been run (see the manual §3). Not present until then |

The signing key is **never** in this folder or anywhere in the repository. Nothing in `mobile/`
is built by CI; the standing-rules and language gates still read every committed file here.
