# Q-016: Devnet verification of the Metaplex Core Collection freeze

**Type:** Verification record (evidence for [ADR-027](adr-027-collection-freeze-propagation.md))
**Environment:** Solana devnet · Metaplex Core `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`
(the same address on devnet and mainnet) · mpl-core JS SDK 1.10.0 · Umi 1.5.1
**Cited by:** `programs/blotto_cup/src/pass.rs` (the program ID and the rejection signature) and
`tests/litesvm/tests/vrf_and_freeze.rs` (the asserted error code)

## Question

Can a pass be made non-transferable for life by freezing its **Collection**, with the pass itself
minted bare? Two things had to hold:

1. Metaplex Core accepts a `PermanentFreezeDelegate` plugin at the Collection level.
2. A frozen Collection blocks transfers of its bare member assets, by owners and by delegates.

## Results

| Test | Setup | Outcome | Error |
|---|---|---|---|
| 1. Baseline | Unfrozen Collection, bare member asset, owner transfer | **Succeeded** | — |
| 2. **Core test** | Collection with `PermanentFreezeDelegate { frozen: true, authority: UpdateAuthority }`, bare member asset, owner transfer | **Rejected** (freeze held) | `InvalidAuthority` / `0x9` |
| 3. Thaw and retry | Same pair after a Collection-level update to `frozen: false`, then retry | Succeeded | — |
| 4. Delegate transfer | Frozen Collection, asset minted with a granted `TransferDelegate`, delegate transfer | **Rejected** (freeze held) | `InvalidAuthority` / `0x9` |

Test 3 is recorded only to show the freeze is what blocked tests 2 and 4. **Blotto Cup has no
thaw path**; no instruction in the program can perform test 3's update
([ADR-027](adr-027-collection-freeze-propagation.md)).

## The error signature tests must match

A frozen-member transfer does **not** fail with `AssetIsFrozen` (`0xa`). It fails with
`InvalidAuthority` (`0x9`), because the freeze plugin force-rejects inside the lifecycle validator.
The program-log tail from test 2:

```
Program log: programs/mpl-core/src/state/asset.rs:293:Approve
Program log: programs/mpl-core/src/plugins/internal/permanent/permanent_freeze_delegate.rs:58:Reject
Program log: programs/mpl-core/src/plugins/lifecycle.rs:733:Reject
Program log: Invalid Authority
Program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d failed: custom program error: 0x9
```

Test 4's tail is identical apart from the first line, which shows the transfer delegate approving
before the freeze rejects:

```
Program log: programs/mpl-core/src/plugins/internal/owner_managed/transfer_delegate.rs:47:Approve
Program log: programs/mpl-core/src/plugins/internal/permanent/permanent_freeze_delegate.rs:58:Reject
```

Both rejected transfers failed at preflight simulation, so neither produced an on-chain signature.

## How the repository uses this

- `pass.rs` creates each pool's Collection with exactly the plugin from test 2 (authority
  `UpdateAuthority`, which resolves to the `Pool` PDA) and mints every pass bare.
- `tests/litesvm/tests/vrf_and_freeze.rs` (`a_minted_pass_refuses_transfer`) mints a real pass
  through `register` against the compiled program and a local copy of the Core program
  (`tests/fixtures/mpl_core.so`), attempts an owner transfer, and asserts the error is `Custom(9)`,
  the `0x9` above. A different code means the freeze mechanism has changed and must be re-verified.
