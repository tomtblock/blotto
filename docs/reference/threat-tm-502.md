> Exported from anarchy-fun for reference; superseded by Blotto Cup docs where they conflict.

### TM-502: Switchboard VRF callback failure or compromise

**Attacker:** oracle compromise (low likelihood) or network-level interference.
**Vector.** VRF call at collection creation never lands → collection stuck without a seed. Or worse, oracle returns predictable randomness.
**Impact.** Collections cannot launch, or launch with weak randomness.
**Mitigations.** Switchboard On-Demand is maintained and externally audited (rationale in ADR-004, retained under ADR-026 for the seed component). On callback failure, the launch transaction fails atomically — no half-launched collection. Multi-source randomness (ADR-026) limits damage from a compromised seed: attacker still can't predict delayed slot hashes, so per-open outcomes remain unpredictable even with a known seed.
**Residual risk:** **Low.** Real risk is service availability (Switchboard down → can't launch new collections), not randomness compromise.

---

