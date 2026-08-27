> Exported from anarchy-fun for reference; superseded by Blotto Cup docs where they conflict.

## ADR-026: Multi-source per-open randomness — supersedes ADR-004

**Status:** Accepted (founder ratified 2026-05-22)
**Date:** 2026-05-22
**Supersedes:** ADR-004 (single VRF seed only).

**Context.** ADR-004 committed to a single Switchboard On-Demand VRF call at collection launch, with per-open randomness derived as `hash(committed_seed || open_index || stable on-chain inputs)`. Q-022 (founder-surfaced during the Q-009 discussion) revealed that this design makes rarity outcomes fully predictable from public on-chain state. Sophisticated users could compute the tier for each upcoming `open_index` and race to claim favorable ones — the very "rarity sniping" the PRD claimed to prevent.

The architect should have flagged this gap when ADR-004 was authored. The gap was identified through founder questioning during the Q-022 discussion and is acknowledged here for the record.

**Decision.**

**Per-open randomness derivation:**
```
random_bytes = hash(
  committed_VRF_seed,      // from Switchboard On-Demand at launch
  slot_hash_at_N-5,        // delayed slot hash from SlotHashes sysvar
  open_index,              // current open counter from collection account
  collection_pubkey        // disambiguates collections
)
```

Where `slot_hash_at_N-5` is the blockhash from 5 slots before the execution slot, read from the `SlotHashes` sysvar at pack-open execution time.

**Why N-5 (delayed slot hash):**
- A current-slot (N) hash lets the validator producing that slot manipulate outcomes by choosing transaction inclusion based on what they'd compute their slot hash to be.
- A hash from 5 slots ago is already finalized when slot N executes. The validator at slot N has no influence over the hash of slot N-5.
- At submission time, the user does not know which slot their tx will land in, and therefore cannot precompute the N-5 hash either.
- 5 slots is comfortably outside the manipulation window (typical confirmation depth) while still inside the 512-entry `SlotHashes` sysvar buffer.

**Switchboard On-Demand role:** unchanged. One VRF call per collection at launch; the resulting seed is committed to the collection account. The VRF anchors long-term randomness; the delayed slot hash provides per-open unpredictability.

**Properties.**

| Property | ADR-004 (single seed) | ADR-026 (multi-source) |
|---|---|---|
| Outcomes predictable pre-execution | Yes | No |
| Validator can manipulate | No | No (delayed hash is finalized) |
| User can target known-good `open_index` | Yes | No |
| Bag-without-replacement preserved | Yes | Yes |
| Audit-replayable | Yes | Yes |
| Cost per open | Free (hash only) | Free (hash + ~5k CU sysvar read) |
| VRF calls per collection | 1 | 1 (unchanged) |
| Latency hit | None | None |

**Consequences.**
- The PRD's "no rarity sniping" promise now actually holds. Outcomes depend on data that doesn't exist at submission time.
- XP intra-tier weighting (ADR-009) is unchanged — XP still affects trait selection, never tier selection.
- Q-021 (`min_tier` slippage) becomes moot; the underlying exploit it would have defended against is fixed at the randomness layer.
- Implementation: `pack_open` reads `SlotHashes` sysvar (~5k CU), computes the hash, proceeds with weighted draw. Trivial CU impact.
- Audit-replayability: anyone can re-derive any historical open by reading the on-chain seed, on-chain `open_index`, and the historical `SlotHashes` entry. Slot hashes drop out of the sysvar after 512 slots; for deeper history, indexers maintain the data.

**Alternatives considered.**
- *Single VRF seed only (ADR-004 literal)* — superseded. Doesn't deliver on the "no rarity sniping" PRD claim.
- *Per-open VRF call (one Switchboard call per pack open)* — rejected per ADR-004 reasoning. 420 VRF calls × 1-3s latency kills reveal UX.
- *N-1 slot hash (less delay)* — rejected. Validator at slot N can still influence slot N-1 via inclusion ordering.
- *Deep delay (N-100, etc.)* — rejected. Adds no security benefit; risks falling out of the sysvar buffer.
- *Recent blockhash instead of slot hash* — rejected. Slot hashes are the more direct primitive.

---

