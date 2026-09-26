> Exported from anarchy-fun for reference; superseded by Blotto Cup docs where they conflict.

### TM-401: PDA seed collision

**Attacker:** anyone with PDA-derivation knowledge.
**Vector.** Craft input that produces a PDA matching some other account's seed pattern; use it to bypass authority checks.
**Impact.** Forged authority; potential unauthorized mints or fund transfers.
**Mitigations.** Distinct seed prefixes for every PDA type. Standard Anchor `seeds = [...]` pattern with explicit prefixes (`"wallet"`, `"curve"`, `"collection"`, etc.). Code review catches this.
**Residual risk:** **Low under discipline.** Listed because it's the single highest-likelihood Solana program bug class.

---

