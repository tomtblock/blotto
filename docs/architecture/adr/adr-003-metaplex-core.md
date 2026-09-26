# ADR-003: The character pass is a Metaplex Core asset

**Status:** Accepted · in force
**Enforced in:** `programs/blotto_cup/src/pass.rs`, `programs/blotto_cup/src/instructions/register.rs`

## Context

Every paid entry mints one character pass to the player. The pass carries a cosmetic class
([ADR-021](adr-021-bag-without-replacement-draw.md)) and must be **permanently non-transferable**:
it has no market and no competitive effect, and class is read by nothing in the scoring path. The
pass therefore needs:

- a way to group one pool's passes (at most 64) under an authority the program controls;
- a non-transferability mechanism that no instruction in this program can undo
  ([ADR-027](adr-027-collection-freeze-propagation.md));
- low per-entry cost, because the pass is minted inside `register` and the player pays its rent;
- a metadata slot for later art without a program change (decision R12 in
  [DECISIONS.md](../DECISIONS.md)).

## Decision

Use **Metaplex Core** (program `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`, the same address
on devnet and mainnet, pinned as `MPL_CORE_ID` in `pass.rs`).

- **One Core Collection per pool**, created by the permissionless `create_pass_collection` at the
  PDA `[b"pass_collection", pool]`. Its update authority is the pool's `Pool` PDA, which no person
  holds. Its name is derived (`BLOTTO PASS COLLECTION #<pool id>`) and its URI starts empty, so a
  caller cannot label a collection with arbitrary text.
- **One Core asset per entry**, minted by `mint_pass_cpi` inside `register` and nowhere else. There
  is no standalone mint instruction. The asset is named `BLOTTO PASS #<pool>-<index>`, has an empty
  URI, is paid for and owned by the player, and is minted **bare** (no asset-level plugins) so it
  inherits the Collection-level freeze.
- The program uses only the `mpl-core` crate's CPI builders (`CreateCollectionV2CpiBuilder`,
  `CreateV2CpiBuilder`), pinned at `=0.12.0`.

## Consequences

- One account per pass, which keeps the per-entry cost inside `register` low.
- The Collection groups a pool's passes under one on-chain address derived from the pool.
- Illustrated art would be a URI update signed by the Pool PDA, not a change to the competition. No
  URI-update instruction exists; adding one would not touch the freeze.
- The pass address is stored on the `Entry` account and emitted in `EntryRegistered`, so every
  pass can be traced to its entry from public data.
- Core's plugin rules shape the freeze design: an asset-level plugin added after mint fails in the
  version this was verified against, which is why passes are minted bare
  ([ADR-027](adr-027-collection-freeze-propagation.md)).

## Alternatives considered

- **Metaplex Token Metadata.** Rejected: several accounts per asset (mint, metadata, edition), so a
  higher cost inside every `register`, and no Collection-level freeze plugin to inherit.
- **Token-2022 with the `NonTransferable` extension.** Considered in the original design. Not
  chosen: the Core Collection freeze had already been verified on devnet
  ([q-016](q-016-verification-note.md)) and ships with tests that assert its exact rejection code;
  Token-2022 would have meant a new, unverified mint path.
- **A custom pass account.** Rejected: no wallet or explorer would display it as a token, and it
  would add program code to review for no gain.
