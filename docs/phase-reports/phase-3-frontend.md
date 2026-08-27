# Phase 3 report — frontend

**Status: core complete; the entry flow's two service calls are seams**
(packet → Phase 4, devnet tx → Phase 5), surfaced honestly in the UI as
"entry service not configured" rather than mocked green.

## What exists

- **Battle flow (3.4)** — the phase's load-bearing piece. Pure allocation
  model + pure seven-screen machine; the pentagon radar renders on top. The
  roadmap gate runs as fast-check properties (10k drag sequences → sum is
  always exactly 100; timeout always locks the displayed integers). R9's
  lock-current rule lives in the machine where a component cannot override
  it; the module headers carry the two things that must be refused in review
  (chips/presets; randomise-on-timeout).
- **Pages (3.1/3.2/3.5/3.7/3.9)** — play, pools, pool (countdown, prize
  table, §8.6 statement above the enter control), results (R10
  paid-automatically + escrow copy), profile (R15), rules skeleton (R4's
  eight sections, TODO_COPY bodies). Every string routes through
  `app/src/copy/` for the Phase 6 audit.
- **Verify (3.6, R13)** — fully in-browser: the same scoring engine the
  crank runs (imported source-identical, R20), over the published bundle +
  an on-chain record (fetched from the read API's `/verify-record` or
  pasted). Six tampering specs prove each check turns red for its own
  failure. Wallet-free by construction.
- **Entry pipeline (3.3)** — `submitEntry`: CSPRNG salt → canonical payload
  → sealed box → ciphertext BEFORE money → packet → register. The crank
  opens what the client seals (round-trip spec). The client invariant throws
  before anything malformed can leave.
- **Share card (3.8, R16)** — `/card/[pool]/[player]` OG image; no reward
  attached (any reward is a §8.4 question).
- **Read API** — `backend/indexer/src/read-api.ts`, read-only by
  construction, serving the derived tables; `/verify-record` deliberately
  assembles from the RAW ledger instead.

## Judgement calls

1. **"Decrypt in-browser" implemented as hash verification.** The on-chain
   `battles_hash` is a binding commitment to `battles ‖ salt`; checking it
   against the published plaintext proves exactly what re-decrypting would,
   with less machinery in the page. The revealed secret is still checked
   against its committed hash. If counsel or the founder wants literal
   re-decryption in the UI (ciphertexts would then need publishing), it is
   additive, not structural.
2. **Fixture data seam.** Without `NEXT_PUBLIC_INDEXER_URL` the pages render
   a watermarked fixture pool (`id: FIXTURE`) — design and tests work on a
   fresh checkout; nothing pretends to be live.
3. **Age gate in localStorage** (3.1): per-browser self-attestation before
   any pool renders; the real territory gate is the Phase 4 packet service —
   the client gate is UX, the packet is enforcement.
4. **Device hash zeroed until Phase 4** wires the Privy fingerprint (R19)
   into the sealed payload — PHASE-3-REVIEW in play-client.tsx.

## Deferred / open

- Class-reveal animation wiring (3.3): the carried reveal machine
  (`src/reveal/`, 114 specs, confirmed-before-reveal at the type level) is
  intact; connecting it to the live `register` confirmation happens with the
  devnet wiring in Phase 5.
- Gate 3 (a stranger completes a session unaided) requires the deployed
  devnet URL — Phase 5.
- The tab labels and all TODO_COPY strings await the founder (Phase 6).
