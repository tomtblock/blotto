# ADR-002: The Solana Foundation dev skill is the source of current Solana idioms

**Status:** Accepted · in force
**Applies to:** every change to `programs/blotto_cup`, the TypeScript chain clients, and the test
harnesses

## Context

Blotto Cup is built largely with an AI coding agent working from written specifications. The
Solana and Anchor ecosystem moves faster than any model's training data: account types, handler
naming, IDL and code generation, CLI subcommands, client SDK package names, test validators and
lint behaviour on macro-generated code have all changed within recent releases. A specification
written from memory can be confidently out of date, and in a program whose prize vault has no
withdraw instruction, an out-of-date pattern is a correctness risk rather than a style issue.

## Decision

1. **The Solana Foundation dev skill (`solana-foundation/solana-dev-skill`) is the authoritative
   source for current idioms.** It covers Anchor and lower-level program frameworks, the
   `@solana/kit` client stack, LiteSVM / Mollusk / Surfpool testing, IDL and code generation, and a
   security module.
2. **Where a specification conflicts with the skill, the skill wins at execution time.** The
   project's rules and invariants (the vault exit set, integer-only maths, the allocation invariant,
   the language gate) are not idioms and are not overridden by it.
3. **Uncertain patterns are flagged, not asserted.** A specification that relies on a pattern where
   confidence is low says so explicitly, so the implementer checks the skill before following it.
   The areas most likely to be stale are Anchor major-version idioms, Solana CLI flags, client SDK
   package names, test-validator choice, and clippy behaviour on macro output.
4. **Framework.** The program is written in Anchor. The pinned versions live in
   `programs/blotto_cup/Cargo.toml` (`anchor-lang = "=1.0.2"`, `mpl-core = "=0.12.0"`,
   `switchboard-on-demand = "=0.12.1"`), and the integration suite runs against the compiled
   artifact in LiteSVM (`tests/litesvm/`). No instruction has been moved to a lower-level framework.

## Consequences

- Specifications are grounded in current practice rather than training-data priors, and the
  executor has a stated tie-breaker when the two disagree.
- The skill's security module is a reference for the threat records in this directory
  (`threat-tm-401` to `threat-tm-403`, `threat-tm-502`).
- Dependency pins are deliberate. `programs/blotto_cup/Cargo.toml` documents why the Switchboard
  and Metaplex Core SDKs are used without their `anchor` features (they would bring in a conflicting
  `anchor-lang`); a version bump is a reviewed change, not a routine update.
- The rule is repeated in [`CLAUDE.md`](../../../CLAUDE.md) under "Knowledge currency" so every
  agent session sees it.

## Alternatives considered

- **Rely on the model's own knowledge.** Rejected: the areas listed in decision 3 have changed
  within recent releases, and the failures are silent until build or runtime.
- **Adopt a full third-party agent configuration** (many agents, commands and integrations at once).
  Rejected: too much to onboard and review; individual components can be adopted when a specific
  need arises.
- **Commit to a lower-level framework up front for compute efficiency.** Rejected: Anchor's account
  validation (`has_one`, `seeds`, `Signer`) is itself a security control here (see
  `threat-tm-401`, `threat-tm-402`), and no instruction has needed the savings.
