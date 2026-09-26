> Exported from anarchy-fun for reference; superseded by Blotto Cup docs where they conflict.

# Q-016 verification note — Metaplex Core Collection freeze, devnet run

**Source:** `anarchy-fun/docs/q-016-verification.md` (a pointer stub) and the full run report at
`anarchy-fun/docs/archive/verification/q-016-verification.md`.
**Run environment:** Solana devnet · Metaplex Core `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`
(same address on devnet and mainnet) · mpl-core SDK 1.10.0 · Umi 1.5.1.

This is the empirical evidence behind the freeze-propagation half of ADR-027
(`adr-027-collection-freeze-propagation.md`). It is carried because
`programs/blotto_cup/src/pass.rs` and `tests/pass.ts` cite it as the source of the Metaplex Core
program ID and of the freeze-rejection error signature.

## Results

| Test | Setup | Outcome | Error |
|---|---|---|---|
| 1 — baseline positive control | Unfrozen Collection, bare member Asset, owner transfer | **SUCCESS** | — |
| 2 — **core test** | Collection with `PermanentFreezeDelegate { frozen: true, authority: UpdateAuthority }`, bare member Asset, owner transfer | **FAILURE** (freeze held) | `InvalidAuthority` / `0x9` |
| 3 — unfreeze and retry | Same pair, Collection-level `updateCollectionPlugin(frozen: false)`, then retry | **SUCCESS** | — |
| 4 — delegate-initiated transfer | Collection frozen, Asset minted with a granted `TransferDelegate`, delegate transfer | **FAILURE** (freeze held) | `InvalidAuthority` / `0x9` |

Test 3 is recorded for completeness. **Blotto Cup does not carry an unfreeze path** — see the scope
note in `adr-027-collection-freeze-propagation.md`.

## The error signature that tests must match

A frozen-member transfer does **not** surface as `AssetIsFrozen` (`0xa`). It surfaces as
`InvalidAuthority` (`0x9`), because the freeze plugin force-rejects inside the lifecycle validator.
The program-log tail from Test 2:

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

Both frozen-transfer attempts were rejected at **preflight simulation**, so neither produced an
on-chain signature.

## Why this matters to Blotto Cup

The character pass is non-transferable for the life of the asset (PID §3, §8.4). The mechanism is
exactly the one proven above: attach `PermanentFreezeDelegate { frozen: true }` at the **Collection**
level with authority `UpdateAuthority` (which resolves to the program's Pool PDA), then mint every
member **bare** so it inherits the freeze. `tests/pass.ts` asserts the negative case — that a minted
pass cannot be transferred — by matching on the `0x9` signature above.
