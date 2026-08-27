# Step report — the review HTTP service (`step/c10-review-service`, C10)

**Status: delivered.** Item C10 of the 2026-08-27 master build prompt (D-C).
The admin review page's POSTs now have a server behind them; every decision
is wallet-signed by a configured reviewer, applied through the settlement
seam, and appended to a re-verifiable log; and the rules tab carries the
plain-language review-process summary as the detection section's appendix.

**Stacks on C9** (`step/c9-tx-wiring`).

## What was built

- **The service** (`backend/detection/src/server.ts`):
  `POST /decisions` (204 / 400 / 401 / 502) and `GET /decisions?pool=`
  (the pool's log — deliberately open: the log holds no secrets and its
  whole point is re-checkability). Routing is a pure function over parsed
  bodies, the entry server's pattern, so the suite runs without sockets.
  Apply-then-log ordering: a refused chain action answers 502 and logs
  NOTHING — the log never claims an action that did not happen.
- **Squads-member login as per-decision wallet signatures**
  (`auth.ts` + `review-message.ts`): there is no session — each POST
  carries the reviewer's Ed25519 signature over the canonical decision
  message (pool, player, action, criterion, timestamp), verified against
  the wallet key, which must appear in the founder-owned member list
  `config/reviewers.json` (ships EMPTY — fail-closed until the founder
  lists the real multisig members). A five-minute freshness window stops
  replays; inside the window the chain's own idempotence is the backstop.
  One uniform 401 covers unknown signer, forged signature and stale alike.
- **THE LOG FORMAT** (documented on `Decision` in `review.ts`, mirrored by
  migration `0006_review_decisions.sql`): `{ pool, player, action,
  criterion, decidedBy, decidedAt, signature }` — every row self-verifying:
  `signature` is checkable against `decidedBy` over the canonical message
  rebuilt from the row's own fields. `PgDecisionLog` is append-only by
  construction (no update, no delete; a reversal is a new row).
- **The chain seam completed**: `SettlementChain` gains `clearFlag`,
  `releaseEscrow`, `forfeitEscrow` (the review levers, settlement-signed);
  `FakeChain` mirrors them (escrow conservation, `NoEscrow` guards) and
  `Web3Chain` gets the hand-encoded builders against `flags.rs` /
  `escrow.rs` account orders. `reviewActionsFromChain` bridges the review
  page's pool ADDRESSES to the seam's pool IDS.
- **The admin page signs** (`review-client.tsx`): decisions require a
  signed-in wallet with message signing, a cited criterion, and the page
  renders the pool's decision log beneath the flagged table. The canonical
  message is imported from the same module the server verifies —
  byte-for-byte parity by construction, the attestation pattern.
- **The rules-tab appendix**: the detection section keeps its
  founder/counsel criteria placeholder and gains the mechanical
  review-process summary (`COPY.rules.reviewProcess`) as a filled appendix
  — flag before pay, escrow held by the program, multisig-member review,
  the signed public log, release-or-forfeit as the only two exits.

## Judgement calls

1. **"Squads-member login" is signature-verified membership against
   `config/reviewers.json`, not a live Squads account read.** The config
   mirrors the vault's membership and is founder-owned like the territory
   schedule; a live on-chain membership read is a vendor-adjacent upgrade
   that can land with the C11 adapters without changing the auth contract.
   The per-decision signature (rather than a login session) also makes
   every log row independently verifiable — a stronger property than the
   session the prompt literally asked for.
2. **`release_escrow` is built for the launch configuration** (KYC switch
   OFF, D-B4). With the switch ON and a share above the threshold, the
   program demands a KYC packet in the same transaction; that variant
   lands with the switch's activation and is noted in the builder.
3. **The GET endpoint is unauthenticated** — the log is publishable by
   design (it is the accountability mechanism), and it carries nothing a
   player could not already see on-chain plus the cited criterion.

## Tests

`backend/detection` 19 mocha (13 new): registry parsing (committed config
is EMPTY; malformations refused); genuine/forged/tampered/stale/non-member
signatures with real tweetnacl keys; the route contract (apply-then-log,
uniform 401 with nothing applied or logged, 400 shapes, 502 logs nothing,
GET/405/404); the address→id action bridge. App 173 vitest (rules appendix
asserted filled, criteria placeholder still the only TODO on the tab);
reveal 20, packet 37, rehearsal 7; typecheck/lint/build and all three
gates clean.

## For the founder

- `config/reviewers.json` is yours: list the wallet public keys of the
  people allowed to decide reviews (the same people who hold the Squads
  vault). It ships empty, so NOBODY can decide until you fill it. One key
  per line, then redeploy the review service.
- The review page needs `NEXT_PUBLIC_REVIEW_API_URL` set where the app
  deploys, and the service itself runs with database access (migration
  0006) and the settlement signer (via the C11/C12 wiring).
