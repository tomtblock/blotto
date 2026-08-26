> Exported from anarchy-fun for reference; superseded by Blotto Cup docs where they conflict.

### TM-402: Missing signer check on privileged instructions

**Attacker:** anyone.
**Vector.** Call an instruction that should require creator authorization without the creator's signature.
**Impact.** Unauthorized state changes (e.g., bypassing graduation conditions, mutating creator-controlled fields).
**Mitigations.** Anchor `Signer<'info>` and `has_one` patterns. Comprehensive review. Test coverage on unauthorized calls (negative tests).
**Residual risk:** **Low under discipline.** The second-most-common Solana bug class; rigorous review handles it.

---

