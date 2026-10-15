# ADR-026: The class digest mixes five sources, including the player's public key

**Status:** Accepted · in force · **amended by R22 (2026-10-15): the oracle input is no longer committed**
**Enforced in:** `crates/blotto-randomness/src/lib.rs` (`derive_class_randomness`),
`programs/blotto_cup/src/vrf.rs` (`commit_vrf_seed`), `programs/blotto_cup/src/slot_hashes.rs`,
`programs/blotto_cup/src/instructions/register.rs`, `backend/class-digest/src/digest.ts`

## Context

The class draw ([ADR-021](adr-021-bag-without-replacement-draw.md)) needs 32 random bytes per
entry. Those bytes must be:

- **hard to target at submission**, so choosing a moment of entry to land a particular class is
  unreliable (see Consequences for how far this holds);
- **not steerable by the validator** that executes `register`;
- **replayable afterwards** from public data;
- **cheap**, because they are computed inside every `register`.

A single oracle seed per pool, stretched by the entry index, fails the first test: once the seed is
public, anyone can compute which seat index receives which class and time their entry. An oracle
request per entry would be slow and would make every entry depend on the oracle's availability.

## Amendment — R22, 2026-10-15: no oracle seed

Switchboard, the oracle behind `vrf_seed`, announced its shutdown on 2026-09-19 and ended support on
2026-09-25. Its devnet oracles sent their last heartbeat on 2026-10-10, and from pool 90 on no seed
could be committed. Because `register` refused to run without one, **no pool could take an entry**
until this amendment.

- `register` no longer requires a seed. The digest below is unchanged, byte for byte: a pool that
  never received a seed hashes 32 zero bytes in the `vrf_seed` position. A pool seeded before the
  shutdown keeps its seed, so every earlier entry replays exactly as before.
- `commit_vrf_seed` remains, but refuses once a pool has an entry (`VrfSeedAfterEntries`, 6075), so a
  late seed can never split one pool's entries into two draws that a one-seed replay could not
  reproduce.
- The daemon commits no seed. It creates each pool's pass collection first, because `register` needs
  the collection and no longer needs the seed.
- What is given up: the per-pool input that was unknown until the oracle revealed it. The four
  remaining inputs keep every property in **Consequences** below. "Hard to target" never depended on
  the seed being secret, because the seed was public before the first entry anyway. The class is
  cosmetic, and nothing in scoring, ranking or prizes reads it.
- Open, before mainnet: whether a live randomness provider returns as the fifth input. The digest
  already has the slot for it.

## Decision

One Switchboard On-Demand randomness value per pool, combined per entry with execution-time and
entry-specific inputs. **Since R22 the value is no longer committed; see the amendment above.**

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
  cannot influence it, and the entrant cannot know exactly which slot their transaction will land in. "At
  least 5 back" rather than "exactly 5" because skipped slots have no entry. The sysvar is read as
  raw account data at a pinned address.
- **`entry_index`** is the seat counter, encoded little-endian to match Borsh.
- **`pool`** separates pools that could otherwise share the other inputs.
- **`player`** binds the digest to the entrant, so two entries can never share a digest even in
  constructed cases.

## Consequences

- **Hard to target, not validator-steerable, replayable.** "Hard to target" is the honest claim,
  not "unpredictable" (corrected 2026-10-11, scanner triage §5). At submission an entrant already
  knows the seed, the pool, their own key, the likely entry index and every candidate slot hash —
  the hash used is the newest at least five slots older than the LANDING slot, and those are
  public before the transaction is sent. What they do not know is which slot it lands in, or
  whether another entry takes the index first, so they can estimate their class and time an entry
  around it, but not choose it. Nothing of value follows: the class is cosmetic, the bag fixes how
  many of each class a pool hands out, and a pass cannot be transferred, so there is nothing to
  resell. The chosen slot hash is stored on `Entry.slot_hash`
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
