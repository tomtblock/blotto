> Exported from anarchy-fun for reference; superseded by Blotto Cup docs where they conflict.

## ADR-002: Solana Foundation dev skill as canonical Claude knowledge source; framework choice (Anchor vs Pinocchio) deferred per-component

**Status:** Accepted (founder ratified 2026-05-22)
**Date:** 2026-05-22

**Context.** The original ADR pre-committed the project to Anchor latest stable as the framework. Founder pushed back: instead of pre-committing a framework, install a maintained Solana skill that gives Claude up-to-date context (January 2026 best practices, modern tooling, both Anchor and Pinocchio coverage, security guidance), and defer the framework choice to per-component decisions informed by actual CU profiling. This is structurally correct for a project where pack-open CU is the binding constraint — we should measure before committing.

**Decision.**
1. **Primary Claude knowledge source: `solana-foundation/solana-dev-skill`.** Official Solana Foundation skill. Covers the full stack with January 2026 best practices: `@solana/kit` and framework-kit (over legacy web3.js), Anchor and Pinocchio programs, LiteSVM/Mollusk/Surfpool testing, IDL/codegen, payments via Commerce Kit, and a dedicated security module. Uses progressive disclosure (pulls in only what's needed per task).
   - Install: `npx skills add https://github.com/solana-foundation/solana-dev-skill --skill solana-dev`
2. **Complementary (optional, not v1-required): `solanabr/solana-claude`.** Full Claude Code configuration shipping 15 specialized agents (architect, anchor-engineer, pinocchio, DeFi, tokens, frontend, mobile, QA, docs, Unity, etc.), 24 workflow commands, and 6 MCP integrations (Helius for on-chain data, solana-dev docs, Context7, Playwright, memsearch). It pulls skill files from ecosystem repos rather than reinventing them, so it composes well with the Foundation skill.
   - Adoption posture: cherry-pick. Adopt specific agents or MCP integrations (Helius MCP especially) as needs arise. Don't wholesale-import the config until we have a reason to.
3. **Framework choice is deferred.** No project-wide commitment to Anchor or Pinocchio. Each program/instruction is profiled and the framework chosen on merit:
   - Default for v1 scaffolding: Anchor (faster to set up, better IDL/codegen, sufficient for non-hot paths).
   - Migration trigger: any hot-path instruction (especially `pack_open`) that exceeds a 200k CU budget under Anchor gets evaluated for Pinocchio migration. The Foundation skill covers both, so the migration cost is mostly mechanical.
   - Decision is per-instruction, recorded in a follow-up ADR once we have profiling data.

**Consequences.**
- Claude responses are grounded in current Solana practice (post-`@solana/kit`, post-Pinocchio maturation) rather than potentially stale training-data priors.
- The dedicated security module in the Foundation skill becomes the canonical reference for our threat-model and audit-prep docs.
- We retain optionality on the framework decision until we have measurements. No accidental lock-in.
- Slight build-velocity cost: v1 scaffolding in Anchor with the expectation that hot paths *may* migrate. Mitigated by structuring the program so hot-path math (curve integration, synthetic-sell payout, rarity draw) lives in framework-agnostic Rust modules that can be called from either an Anchor or Pinocchio entry point.
- The Helius MCP from the BR config is the most immediately valuable supplemental — gives Claude on-chain query power for debugging. Recommend adopting this one component early.

**Follow-ups.**
- Once `pack_open` is profiled on devnet, write a follow-up ADR locking in Anchor vs Pinocchio for that specific instruction (and any others over CU budget).
- Decide whether Helius MCP gets installed at project start (recommend yes) or on-demand.

**Alternatives considered.**
- *Pre-commit to Anchor (original v0.1 proposal)* — rejected. Locks in framework before we have data. Defensible for productivity but premature for a CU-sensitive project.
- *Pre-commit to Pinocchio* — rejected. Sacrifices v1 velocity for performance we may not need on cold paths.
- *No skill, rely on training-data priors* — rejected. Solana tooling has moved meaningfully since most training cutoffs (`@solana/kit` displacing web3.js, Pinocchio maturing, modern testing tools). Foundation skill keeps Claude current.
- *Wholesale import of `solanabr/solana-claude`* — rejected for v1. 15 agents and 24 commands is a lot to onboard at once; cherry-pick the components that solve specific problems we have.

---

