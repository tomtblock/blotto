> Exported from anarchy-fun for reference; superseded by Blotto Cup docs where they conflict.

## ADR-003: Metaplex Core for NFT standard

**Status:** Accepted (architect)
**Date:** 2026-05-22

**Context.** Need an NFT standard for the 420-asset collections. Options: Metaplex Token Metadata (legacy), Metaplex Core, custom.

**Decision.** Metaplex Core. Collection asset groups the 420 NFTs. Per-NFT plugins as needed for rarity-tier metadata.

**Consequences.**
- Lower rent than Token Metadata (single account per NFT vs. mint + metadata + edition).
- Native collection grouping → Magic Eden indexing works out of the box post-graduation.
- Plugin system gives us a clean place to store rarity tier and trait list on-chain.
- Smaller tooling ecosystem than legacy Token Metadata, but Magic Eden and major indexers support Core.

**Alternatives considered.**
- *Token Metadata (legacy)* — rejected. Higher rent, more accounts per NFT, no plugin system, deprecated trajectory.
- *Custom NFT standard* — rejected. Loses marketplace indexing; massive integration cost for zero meaningful benefit.

---

