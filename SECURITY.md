# Security policy

Blotto Cup runs on Solana **devnet only**. It holds no real money, and a mainnet launch is gated
on legal review and the road-to-mainnet checklist (`docs/ROADMAP.md`). Reports are still welcome and taken seriously: devnet is
where problems should be found.

## Scope

| In scope | Where |
|---|---|
| The on-chain program (prize vaults, treasury, entries, escrow, passes) | `programs/blotto_cup/`, `crates/` |
| The backend services (entry service, indexer and read API, settlement daemon, review service) and their shared libraries (sealing, scoring, screening) | `backend/` |
| The web app, including sealing in the browser and the verify page | `app/` |
| CI gates that protect the invariants above | `scripts/`, `.github/workflows/` |

Out of scope: third-party services and vendors the project relies on, findings that need a
compromised operator machine or a stolen private key, and volumetric denial of service.

## How to report

Use **GitHub private vulnerability reporting** on this repository: open the **Security** tab and
choose **Report a vulnerability**. This creates a private security advisory that only the
maintainers can see. Please do not open a public issue or PR for a security problem.

Please include:

- the component and the file, instruction or endpoint involved;
- what an attacker can do, and what they need first (keys, roles, timing);
- steps to reproduce, ideally against a local validator or the LiteSVM suite
  (`tests/litesvm/`);
- the commit you tested against;
- any fix you suggest.

We will acknowledge the report, keep you informed while we work on it, and credit you in the
advisory if you want to be credited.

## Rules of engagement

- Test against a local validator or your own devnet deployment where you can. If you must touch
  the shared devnet deployment, use only your own wallets and entries.
- Do not interfere with other users' entries, funds or accounts. That includes devnet SOL held
  for other players.
- Do not run denial of service, load or spam tests against the hosted services.
- Do not try to reach or read other players' sealed allocations beyond what is needed to show
  the problem. Stop and report as soon as you have shown it.
- Do not use social engineering or target the operator's staff or infrastructure providers.

## Background

- [`docs/security/SECURITY-REVIEW.md`](docs/security/SECURITY-REVIEW.md): the threat model,
  the on-chain invariants and how they are tested, and a summary of past review findings and
  open items.
- [`docs/compliance/SAFEGUARDS.md`](docs/compliance/SAFEGUARDS.md): the player-facing
  safeguards (eligibility, screening, review and appeals).
