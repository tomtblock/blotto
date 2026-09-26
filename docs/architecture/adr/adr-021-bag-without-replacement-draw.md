> Exported from anarchy-fun for reference; superseded by Blotto Cup docs where they conflict.

## ADR-021: Rarity system — six-tier power-law distribution and AI trait assignment

**Status:** Accepted (founder ratified 2026-05-22)
**Date:** 2026-05-22

**Context.** Q-003 resolved the per-collection NFT distribution across rarity tiers. Q-004 resolved how sub-traits are assigned rareness levels (1–5) within each trait category.

**Decision.**

**Rarity tier distribution per collection (Q-003, Option A):**

| Tier | Count | Share |
|---|---|---|
| Common | 250 | 59.5% |
| Uncommon | 100 | 23.8% |
| Rare | 50 | 11.9% |
| Epic | 15 | 3.6% |
| Legendary | 4 | 0.95% |
| Mythic | 1 | 0.24% |
| **Total** | **420** | **100%** |

These counts initialize the rarity counter array at collection creation. Per ADR-009 and ADR-026, each pack open decrements the counter for whichever tier is drawn. Sum is invariant: 420 at launch, 0 at graduation.

**Trait rareness assignment (Q-004):**
- Sub-traits within each trait category are assigned rarity tiers (1–5) by a hosted LLM at collection creation.
- Model: Claude or GPT-4-class. Specific model + version pinned per environment configuration.
- Configuration: temperature 0, fixed prompt template controlled by anarchy team, fixed input format (creator's trait list).
- Determinism: same input → same output. Pinning model version is non-negotiable; bumping the version requires a new ADR documenting the change and re-verifying determinism on test collections.
- Output recorded immutably on-chain in the collection account at creation.
- Creators do not influence assignments. Anarchy team controls the prompt and model choice.
- Failure mode: if the model API is unreachable at collection creation, creation fails atomically. Acceptable — creation is a creator-initiated one-time event.

**Tier-name overlap (Mythic).** The XP system also has a Mythic tier (100,000 XP, ADR-022). The overlap is intentional: both denote apex of their system. UI must disambiguate by context ("Mythic NFT" vs "Mythic-tier User").

**Consequences.**
- All anarchy.fun collections share the same global rarity distribution. This is a deliberate brand choice — players know the odds going in, every collection has its "holy grail" Mythic.
- The hosted LLM is an off-chain dependency at the creation step only. Pack opens are 100% on-chain.
- Audit-replayability: anyone can rerun the model with the same prompt + trait list and verify the on-chain assignments. Requires anarchy to publish the prompt template (recommend doing so in `Standards.md` once written).
- Pinned model version is a real ops commitment — model providers deprecate versions, and we must either upgrade with a documented ADR or absorb the cost of keeping an older version available.

**Alternatives considered.**
- *5-tier coarser distribution (Q-003 Option B)* — rejected. Option A's six tiers create more reveal moments.
- *Creator-defined trait rareness* — rejected. Self-dealing risk.
- *Deterministic heuristic (no AI)* — rejected. Heuristics produce weak rarity differentiation.
- *On-chain inference* — rejected. Solana doesn't host arbitrary inference; one-time creation-step call is acceptable.

---

