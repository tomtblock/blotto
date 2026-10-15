# TM-502: The randomness oracle fails or is compromised

**Status:** Closed by R22 (2026-10-15). The oracle is no longer a dependency. Kept as the record of
the threat while it applied, and of the guard that remains on `commit_vrf_seed`.

> **What changed.** Switchboard shut down: it announced on 2026-09-19 and ended support on 2026-09-25.
> Its devnet oracles stopped on 2026-10-10, which is the availability risk below in its worst form:
> under "no seed, no entries", no pool from 90 on could take an entry. R22 removes that gate.
> `register` draws without a seed, using the four other inputs of
> [ADR-026](adr-026-multi-source-randomness.md). `commit_vrf_seed` is unchanged except that it
> now refuses once a pool has an entry (`VrfSeedAfterEntries`).

**Former status:** Mitigated · residual risk low (and limited to a cosmetic outcome)
**Enforced in:** `programs/blotto_cup/src/vrf.rs` (`commit_vrf_seed`),
`programs/blotto_cup/src/instructions/register.rs`

## Threat

**Attacker:** a compromised oracle (unlikely), network interference, or a caller substituting a
different randomness account.
**Vector:** the Switchboard On-Demand reveal for a pool never lands, so the pool has no seed; or the
seed is predictable; or a caller commits a different, validly revealed randomness account than the
one requested for this pool.
**Impact:** a pool that cannot take entries, or a class draw that is weaker than published. The
class is cosmetic and read by nothing in the scoring path, so **no outcome of this threat changes
who wins money**.

## Mitigation in Blotto Cup

- **Strict validation in `commit_vrf_seed`:** the pool must be `Open`; the seed is write-once
  (refused if already non-zero, `VrfSeedAlreadyCommitted`); the randomness account must be owned by
  the Switchboard On-Demand program (mainnet or devnet ID, `InvalidRandomnessAccount`); it is parsed
  by the Switchboard SDK, which checks its discriminator and size; and its value is read with
  `get_value(current slot)`, which succeeds only in the slot the oracle revealed it
  (`RandomnessNotResolved` otherwise). The caller bundles the reveal and the commit in one
  transaction.
- **Atomic failure.** If the reveal does not land, the commit transaction reverts; there is never a
  half-committed seed.
- **No seed, no entries.** `register` refuses until a seed is committed (`VrfSeedNotCommitted`), so
  no entry is ever drawn from an empty seed. A pool whose seed never lands takes no entries, stays
  below the minimum field, and returns its prize pool to the treasury at the deadline through the
  permissionless `trigger_refund`.
- **A known seed is not enough to choose a class.** The class digest also mixes a slot hash from at
  least five slots back, the entry index, the pool and the player's key
  ([ADR-026](adr-026-multi-source-randomness.md)). The seed is public once committed, and the
  candidate slot hashes are public before an entry is sent, so an entrant can estimate their class
  and time an entry around it; what they cannot fix in advance is the landing slot or the entry
  index, so they cannot choose it. The class is cosmetic and the bag fixes each class's count per
  pool, so this moves nothing of value (corrected 2026-10-11; the earlier wording said
  "unpredictable", which overstated it).
- **Auditable.** The committed seed and the randomness account used are emitted in `PoolVrfSeeded`.

## Residual risk

**Low.** Switchboard On-Demand randomness is not bound to an application payload, so a caller could
commit a different validly revealed account than the one requested. The substitute is still
oracle-produced, not chosen, and is mixed with execution-time inputs; the bag's composition holds
regardless. The code carries a `TODO(TM-502)` to bind the account to the pool if Switchboard exposes
payload binding. The remaining practical risk is availability: if the oracle is down, new pools
cannot take entries until it returns.
