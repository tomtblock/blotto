# Blotto Cup — rules for AI coding agents

You are working on Blotto Cup, a paid-entry skill tournament on Solana: up to 64 players per pool (a
pool runs with at least 40), a non-transferable cosmetic character pass, seven sealed battles of
five stats placed on a board in one of two modes (easy: 100 per battle; hard: 700 across the
board), all-vs-all scoring, the player ranked first paid the whole fixed prize pool.

**Read [`docs/README.md`](docs/README.md) first.** It maps which document is canonical for which
subject. Product facts, constants and the scoring rules live in the code and in those documents —
do not restate them here.

## Posture

Be direct. State a recommendation, then its rationale, then the rejected alternatives with reasons.
Disagree explicitly when you disagree; the project owner makes the call, but they need to know what
they are choosing against. Ask one clarifying question only when you genuinely cannot proceed;
otherwise propose and let the owner accept or counter.

Push back on product claims that do not hold up. When a documented claim conflicts with what the
technology can deliver, name it — do not silently implement around it. Own mistakes directly.

Explain decisions to the project owner in plain language, with step-by-step instructions for
anything hands-on. Prompts written for other agents stay technical.

## Tradeoff order

1. **Correctness and security of on-chain logic.** The vault holds real money on mainnet and has no
   withdraw instruction; a bug there is unrecoverable.
2. **The product's legal position.** Anything that erodes "class is cosmetic", "no chance in the
   mechanism", or the language rules is a product-ending risk, not a polish item.
3. **Verifiability.** Every number a player is paid must be recomputable by that player from
   published data. Sealing, the revealed pool secret, the published battle set and the TypeScript
   scoring engine (one module, run by the settlement service and the browser — decision `R20`) exist
   so the operator is checkable rather than trusted.
4. **Integrity of the competition.** Detection quality, the allocation invariant, the draw rate the
   free-integer space buys.
5. **UX of the player's session.**
6. **Compute and rent cost on Solana.**
7. **Implementation speed.**

When two priorities conflict, name the conflict, recommend the higher-priority resolution, and say
what is sacrificed.

## Hard rules — never violate

- **No floats in on-chain math.** Integer-only, `u128` intermediates where a product can grow
  ([`threat-tm-403`](docs/architecture/adr/threat-tm-403.md)). This holds in the TypeScript scoring
  engine too — half a win is carried as half-points in integer units, never as a float.
- **Class is cosmetic and is read by nothing in the scoring path.** A Mythic's Strength is worth
  exactly what a Common's is. No class may affect any stat, battle, pool, prize or ranking
  tiebreak. Any proposed class reward faces two questions — *would anyone pay money for this, and
  does it improve the chance of winning?* Both must be no. `scripts/check-standing-rules.sh`
  enforces the scoring-path half.
- **The prize vault has no withdraw instruction** (decisions `R10`, `D-E6`, `D-E7`). The vault's
  lamport exits are exactly `pay_prizes`, `release_escrow` and `pay_next_place`, plus
  `trigger_refund` returning the untouched pot to the treasury when a pool fails to fill.
  `refund` repays entries from the treasury. **`forfeit_escrow` moves nothing**: an upheld flag
  leaves the share in the vault until `pay_next_place` divides it among the eligible players at the
  next rank. Once a pool plays, its prize is always paid to players and never returns to the
  operator. Do not add another exit, an admin escape hatch or a "recover stuck funds" path.
  `scripts/check-standing-rules.sh` asserts the exact exit set in CI and that `escrow.rs` cannot
  address the treasury.
- **Allocation invariant, per mode**, in the fixed stat order Strength, Speed, Heart, Wit,
  Durability. **Easy:** five integers per battle summing to exactly 100. **Hard:** thirty-five
  integers summing to exactly 700 across the board. **The program does not and cannot enforce
  this** — it receives only `sha256(battles ‖ salt)`, and a program that could check an allocation
  could read one, which would end sealing. The two enforcement points are the client at submission,
  whose interaction cannot express a violating shape, and the scoring engine at reveal
  (`backend/scoring/src/allocation.ts`), which scores a malformed set all-losses and publishes that
  status rather than halting the pool.
- **The pass is permanently non-transferable.** No instruction in this program can set
  `frozen: false`. Adding one changes the product's legal position and requires legal sign-off.
- **The language gate is enforced, not advisory.** Never use: lottery · gamble · bet · wager ·
  casino · pull · pack · odds · jackpot · rake · deal · roll. Use instead: entry · pass · character
  · battle · stat · allocation · tournament · prize pool · ranking. This applies to identifiers,
  comments, commit messages, test names, documents and UI copy alike. The full list and its further
  groups are in [`CONTRIBUTING.md`](CONTRIBUTING.md#the-language-gate). In the class draw no variable
  is named `odds` or `weights` — the name is `class_counters`.
- **Sealing is a property, not a promise.** Do not add any path that lets the backend read an
  allocation before the pool closes. The pool secret's export policy is the mechanism; a change that
  reads plaintext early defeats it silently.
- **Distinct PDA seed prefixes for every PDA type**
  ([`threat-tm-401`](docs/architecture/adr/threat-tm-401.md)): `seeds = [b"<type>", ...]`.
- **Always verify the signer on privileged instructions**
  ([`threat-tm-402`](docs/architecture/adr/threat-tm-402.md)).
- **Never invent values.** Every constant comes from the code, `config/`, a decision in
  [`docs/architecture/DECISIONS.md`](docs/architecture/DECISIONS.md), or an explicit instruction
  from the project owner. If it comes from none of those, **ask**. Prices, pots, the fill deadline,
  the seat floor, the board clock, the tier table and the territory schedule
  (`config/territories.json`, with `config/territories.README.md` as its legend) are owner-set
  numbers with published consequences.

## Knowledge currency

The Solana and Anchor ecosystem moves faster than a model's training data. The Solana Foundation
skill is the authoritative source of current idioms
([`adr-002`](docs/architecture/adr/adr-002-solana-skill-knowledge-source.md)); where this file
specifies a pattern that conflicts with the skill, **the skill wins at execution time**. Flag
patterns where your confidence is low — Anchor major-version idioms, Solana CLI subcommands, npm
package names for client SDKs, test-validator choices, and clippy behaviour on macro-emitted code
are the usual suspects.

## Branch state currency

The documents say what the project intends; the branch says what it **is**. Before writing a change,
read the source files it will modify and the modules it depends on, and verify every reference
(paths, names, signatures, error variants, fields) against them. If those files are not available,
ask for them. [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) describes the
current build; the scoring engine and the results tree are TypeScript (`backend/scoring/`), and the
class draw replays from published events (the on-chain `class_counters` bag).

## Agent owns · project owner reserves

**The agent owns:** implementation correctness and security; account layouts and PDA seeds; the
scoring implementation and its known vectors; the sealing key lifecycle; detection signals within
the agreed design; frameworks and tooling within agreed defaults; compute budgets; test coverage and
"done" criteria.

**The project owner reserves:** entry prices and pool sizes; the prize table; the fill deadline and
minimum field; the board clock; the published review window; class names and art direction; the KYC
threshold; the operating entity and the blocked-territory list; brand voice and all user-facing
language; and how the product is characterised legally. Present proposals in these areas as
proposals awaiting a decision, not as facts. **If you cannot tell which column something falls in,
treat it as owner-reserved and ask.** Anything touching the product's legal characterisation also
needs legal review.

## Output expectations

- **Code:** complete files with imports, error handling, account validation and doc comments. Tests
  in the same change when feasible.
- **Anything a player must be able to recompute** ships with its published inputs and a known-vector
  test. Scoring and the class draw carry Python-generated fixtures committed with their generator
  script — a vector captured from our own output proves nothing.
- **Numerical proposals:** show the math.
- **Estimates:** compute-unit budgets per instruction, account sizes per PDA, rent where relevant.
- **Tradeoffs:** options labelled (a) / (b) / (c), then a clear recommendation.
- **Judgement calls under uncertainty** get a `// PHASE-N-REVIEW:` comment with one line of
  reasoning, and a line in the pull request description. Do not bury a decision in a diff.
- **Documents:** follow [`docs/README.md`](docs/README.md) — one subject, one home; point, don't
  restate; keep facts current with the code in the same change.

## Anti-patterns

- Silently working around a conflict between a document and the code. Surface it.
- Adding a class-linked effect "just for flavour".
- Introducing a float into a scoring or payout path because halves are convenient.
- Long preambles before the answer. Lead with the answer, then justify.
- Restating in one document a status, constant or rule that another document owns.
