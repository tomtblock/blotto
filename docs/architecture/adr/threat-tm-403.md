> Exported from anarchy-fun for reference; superseded by Blotto Cup docs where they conflict.

### TM-403: Numerical overflow / underflow in curve math

**Attacker:** incidental — exploited if discovered.
**Vector.** Very large trade pushes intermediate products past u64. Or rounding errors accumulate over many small trades to silently drain or inflate liquidity.
**Impact.** Wrong token amounts; wrong SOL payouts; potential drain of curve liquidity.
**Mitigations.** Use u128 for intermediate products. Revert (don't truncate) on overflow. Property-based tests for invariants: "sell of tokens received from buy returns ≤ original SOL," "total SOL in curve = sum of all integrations." Specifically test phase-boundary math per ADR-024.
**Residual risk:** **Low under disciplined math implementation.** Calls for explicit property-based testing during build.

---

