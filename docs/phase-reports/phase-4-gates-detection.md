# Phase 4 report — gates and detection

**Status: complete offline.** The on-chain half of 4.1 was built Phase-1-early
(recorded in the Phase 1 report); this phase delivered the issuing service,
the detection pipeline wired into the crank, the review surface, and the 4.5
acceptance tests against the compiled program.

## What exists

- **4.1 — entry packet.** On-chain verification has been real since Phase 1
  (`entry_packet.rs`); the §13 acceptance cases (omission, wrong pool, stale,
  forged signer) run in the LiteSVM gates suite. This phase added the ISSUER:
  `@blotto/packet` encodes the 83-byte packet (pinned to its own Python
  layout oracle, `fixtures/gen_vectors.py`), signs through the
  `PacketSigner` seam (Turnkey in production — R21; a local signer for
  dev/tests), and builds the exact Ed25519-instruction bytes the on-chain
  parser expects.
- **4.2 — packet service.** `issuePacket` runs geo, VPN/proxy, sanctions and
  age-attestation checks through vendor seams (the vendor of record is
  contracted in Phase 6 — R2 requires the founder to name it) and returns a
  signed packet or ONE generic rejection: every failure cause — including an
  upstream vendor outage — serialises to the identical body, and all checks
  run even after one fails so timing doesn't leak either. Territory
  allowlist per R2: GB / IE / DE, as config. HTTP face: `POST /packet` and
  `POST /ciphertexts` (the sealed-entry store endpoint, ciphertext-only).
- **4.3 — detection.** Five signals over revealed data (entropy, timing
  profile, duplicate/near-duplicate sets, device/IP correlation,
  population-relative score), all logged (shadow mode is the launch
  default). Hard block strictly per R11: exact 35-byte duplicates and
  same-device multi-entry; everything else needs TWO independent signals and
  goes to review (TECH-ARCH §9's thin-sample rule). The full-escrow tier
  keys off the on-chain `detection_hard_block` switch. Every threshold is
  marked as an architect PROPOSAL inline, tunable from shadow-mode data.
  **Wired into the crank**: detection runs between scoring and payment, and
  the roadmap's gate case — two colluding wallets in a scripted test pool —
  flags both before `pay_prizes`, escrows their shares, pays everyone else,
  and conserves the pot to the lamport (crank suite).
- **4.4 — review.** The decision log (`decide` = chain action + logged
  criterion/decider/time), the four settlement actions behind the narrow
  `ReviewActions` seam, and the admin page (`/admin/review`) listing flagged
  entries with clear/release/forfeit actions posted to the review backend.
- **4.5 — KYC switch.** Tested against the compiled program in LiteSVM:
  switch on → 1st place escrows while 9th still pays direct; a tier-0 packet
  cannot release; a tier-1 packet releases the full share; switch off →
  direct payment.

## Judgement calls

1. **Malformed packet requests get the generic rejection too** — a 400 with
   field detail would let a prober distinguish "bad request" from "blocked",
   which is exactly the enumeration the generic answer exists to prevent.
2. **Zeroed device hashes never correlate.** Until Phase 5 wires the Privy
   fingerprint, payloads carry zeros; grouping those would flag everyone.
   Pinned by a test.
3. **The review page holds no authority.** Buttons post REQUESTS to the
   review backend, which holds the settlement signer; nothing signing-
   capable ships to a browser. Squads-member login lands with the Phase 5
   credentials (PHASE-4-REVIEW on the page).
4. **Ciphertext store keying**: the entry service keys rows by a
   deterministic mapping of the pool PDA until the deployment attaches the
   indexer's PDA→id resolution — an adapter seam, not a schema change.

## Deferred

- Geo vendor of record + sandbox credentials (Phase 6 contract, R2).
- Turnkey packet signer (with the other Phase 5 credentials).
- Squads-member login on the review page.
