# ADR-026: The class digest mixes five sources, including the player's public key

**Status:** Accepted · in force
**Enforced in:** `crates/blotto-randomness/src/lib.rs` (`derive_class_randomness`),
`programs/blotto_cup/src/vrf.rs` (`commit_vrf_seed`), `programs/blotto_cup/src/slot_hashes.rs`,
`programs/blotto_cup/src/instructions/register.rs`, `backend/class-digest/src/digest.ts`

## Context

The class draw ([ADR-021](adr-021-bag-without-replacement-draw.md)) needs 32 random bytes per
entry. Those bytes must be:

- **unpredictable at submission**, so nobody can choose their moment of entry to target a class;
- **not steerable by the validator** that executes `register`;
- **replayable afterwards** from public data;
- **cheap**, because they are computed inside every `register`.

A single oracle seed per pool, stretched by the entry index, fails the first test: once the seed is
public, anyone can compute which seat index receives which class and time their entry. An oracle
request per entry would be slow and would make every entry depend on the oracle's availability.

## Decision

One Switchboard On-Demand randomness value per pool, combined per entry with execution-time and
entry-specific inputs:

```
digest = sha256( vrf_seed        32 bytes  committed once per pool by commit_vrf_seed
               ‖ slot_hash       32 bytes  newest SlotHashes entry at least 5 slots old
               ‖ entry_index      2 bytes  u16, little-endian
               ‖ pool             32 bytes  the Pool account address
               ‖ player           32 bytes  the entrant's public key )      130 bytes in all
```

- **`vrf_seed`** is written once per pool by `commit_vrf_seed`, from a revealed Switchboard
  Randomness account ([threat-tm-502](threat-tm-502.md) covers its checks). `register` refuses to run
  until it is set (`VrfSeedNotCommitted`).
- **`slot_hash`** is the newest `SlotHashes` entry with `slot ≤ current − 5` (`SLOT_HASH_DELAY = 5`
  in `constants.rs`). It is finalised before the executing slot begins, so the executing validator
  cannot influence it, and the entrant cannot know which slot their transaction will land in. "At
  least 5 back" rather than "exactly 5" because skipped slots have no entry. The sysvar is read as
  raw account data at a pinned address.
- **`entry_index`** is the seat counter, encoded little-endian to match Borsh.
- **`pool`** separates pools that could otherwise share the other inputs.
- **`player`** binds the digest to the entrant, so two entries can never share a digest even in
  constructed cases.

## Consequences

- **Unpredictable, not steerable, replayable.** The chosen slot hash is stored on `Entry.slot_hash`
  and emitted in `EntryRegistered`; the seed is emitted in `PoolVrfSeeded`. A replay therefore needs
  no historical sysvar data, only the program log.
- **One oracle interaction per pool**, not per entry. `register` pays only a sysvar read and one
  SHA-256.
- **Three implementations, one set of vectors.** The Rust crate, the TypeScript replay and a
  Python generator (`crates/blotto-randomness/fixtures/gen_vectors.py`) agree on committed known
  vectors. The crate's tests also rebuild the 130-byte stream by hand and flip one bit in each of
  the five inputs, so dropping any input fails a test.
- **Bounded stakes.** The digest decides a cosmetic class only. Even a fully compromised seed moves
  nothing a player can win; scoring depends only on the sealed allocations.

## Alternatives considered

- **Pool seed only, stretched by entry index.** Rejected: predictable per seat once the seed is
  public.
- **An oracle request per entry.** Rejected: adds latency to every entry and makes every entry fail
  when the oracle is unavailable.
- **The current slot's hash (or one slot back).** Rejected: the leader producing the slot can
  influence it through transaction inclusion.
- **A much deeper delay.** Rejected: adds nothing once the hash is finalised, and risks leaving the
  sysvar's window.
- **A recent blockhash.** Rejected in favour of the `SlotHashes` sysvar, the more direct primitive
  with a deterministic selection rule.
- **Four inputs, without the player's key.** Rejected: the player key costs 32 bytes of hashing and
  removes the only collision case the other four leave open.
