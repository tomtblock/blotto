# ADR-027: A Collection-level permanent freeze makes every pass non-transferable

**Status:** Accepted · in force
**Enforced in:** `programs/blotto_cup/src/pass.rs`; negative test
`tests/litesvm/tests/vrf_and_freeze.rs` (`a_minted_pass_refuses_transfer`)

## Context

The character pass ([ADR-003](adr-003-metaplex-core.md)) must never move from the wallet that
paid for the entry. A pass that could be transferred could be sold, and a random, sellable item
received for an entry fee is exactly what the product must not be. The mechanism has to:

- hold for the life of every pass, with **no instruction in this program able to undo it**;
- hold against delegates as well as owners;
- cost nothing extra per entry.

## Decision

- `create_pass_collection` creates each pool's Core Collection with one plugin:
  `PermanentFreezeDelegate { frozen: true }`, authority `UpdateAuthority`, which resolves to the
  pool's `Pool` PDA.
- `mint_pass_cpi` mints every pass **bare**, with no asset-level plugins, so it inherits the
  Collection's freeze.
- **There is no thaw path.** No instruction in `programs/blotto_cup` sets `frozen: false` or issues
  `UpdateCollectionPluginV1`. Because the plugin's authority is a program PDA, only this program
  could ever sign such a change, and it contains no code that does. Adding one would change the
  product's legal position and requires legal sign-off.

This rests on two properties verified on devnet before the code relied on them
([q-016](q-016-verification-note.md)):

1. Core accepts a `PermanentFreezeDelegate` at the Collection level.
2. A frozen Collection propagates to its bare member assets: an owner's transfer is rejected inside
   the freeze plugin's lifecycle check, and so is a transfer by a legitimately granted
   `TransferDelegate`.

## Consequences

- **The rejection code is `0x9` (`InvalidAuthority`), not `AssetIsFrozen` (`0xa`).** The freeze
  plugin force-rejects inside the lifecycle validator. Tests asserting "this pass cannot move" match
  `0x9` and the `permanent_freeze_delegate…Reject` log line; `a_minted_pass_refuses_transfer`
  asserts `Custom(9)`. A different code there means the mechanism has moved.
- **No per-asset delegate blocking is needed.** The Collection freeze overrides an approving
  transfer delegate.
- **Passes must be minted bare.** In the mpl-core version this was verified against, adding a plugin
  to a Collection member after mint fails early, before any lifecycle check. Any member plugin would
  have to be attached at creation; minting bare avoids the question entirely. The comment on the
  mint call site says so and must stay.
- **Permanence depends on upgrade governance.** The program is upgradeable, and an upgrade could add
  an instruction that thaws a Collection. That risk is controlled by who holds the upgrade authority
  (published in [`config/custody.json`](../../../config/custody.json) and on the custody page), not
  by this mechanism.
- **Known limitation.** The absence of a thaw instruction is checked by review; no CI check greps
  for `frozen: false` or `UpdateCollectionPluginV1` today.

## Alternatives considered

- **A per-asset freeze plugin on every pass.** Rejected: more work per entry, and adding plugins to
  Collection members is the failing path described above.
- **Token-2022 `NonTransferable`.** See [ADR-003](adr-003-metaplex-core.md): not chosen because the
  Core freeze was already verified and tested.
- **A freeze that can later be lifted** (for example, at some future lifecycle stage). Rejected
  outright: a pass that can ever become transferable has a market, and the pass must have none.
