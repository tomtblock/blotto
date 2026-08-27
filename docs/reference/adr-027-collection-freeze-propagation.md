> Exported from anarchy-fun for reference; superseded by Blotto Cup docs where they conflict.

# ADR-027 (partial export): Collection-level Permanent Freeze Delegate propagates to member assets

**Source:** `anarchy-fun/docs/Decisions.md` → ADR-027, and the empirical run behind it
(`docs/archive/verification/q-016-verification.md`, exported here as `q-016-verification-note.md`).
**Original status:** Accepted (architect), 2026-05-27.

## Scope of this export — read this first

The original ADR-027 recorded **two** decisions. Only the **first** is carried into Blotto Cup:

| Half of ADR-027 | Carried? |
|---|---|
| Collection-level `PermanentFreezeDelegate` exists, and a frozen Collection **propagates** to its member Assets | **Yes** — this is the mechanism behind the non-transferable character pass |
| "Single-CPI unfreeze adopted at graduation; `unfreeze_batch` fallback dropped" | **No — deliberately dropped.** Blotto Cup has no unfreeze path at all |

Blotto Cup's character pass is **permanently** non-transferable (PID §3, §8.4). There is no
graduation, no thaw, and no instruction in `programs/blotto_cup` that can set `frozen: false`.
Adding one would be a legal-position change and requires counsel sign-off. The unfreeze half of
ADR-027 is recorded here only so a future reader knows it existed and was consciously not carried.

## The finding that is carried

Both questions the original ADR set out to answer resolved **YES**, verified on devnet against
Metaplex Core `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` (mpl-core SDK 1.10.0 / Umi 1.5.1):

1. **A `PermanentFreezeDelegate` plugin exists and is accepted at the Collection level** —
   `createCollection` accepts the plugin entry `{ type: 'PermanentFreezeDelegate', frozen, authority }`.
2. **A frozen Collection propagates to its member Assets.** A member Asset minted **bare** (no
   per-asset plugins) could not be transferred while the Collection was frozen; the transfer was
   rejected inside the Collection's freeze lifecycle
   (`plugins/internal/permanent/permanent_freeze_delegate.rs:58:Reject`).

Two consequences carried forward into `programs/blotto_cup/src/pass.rs`:

- **Freeze rejection surfaces as program error `0x9` (`InvalidAuthority`), not `AssetIsFrozen`
  (`0xa`).** The freeze plugin force-rejects the transfer in the lifecycle validator. Test code
  asserting "this pass cannot move" must match on `0x9` plus the
  `permanent_freeze_delegate…Reject` log line.
- **The freeze holds against transfer delegates, not only owners.** An Asset minted with a
  legitimately-granted `TransferDelegate` still could not be moved by that delegate while the
  Collection was frozen — the delegate *approved*, the freeze *rejected*. The pass mint therefore
  does not need to defensively block per-asset transfer delegates for freeze integrity.

## Harness note carried into the mint code

In mpl-core 1.10, a post-mint `AddPlugin` against a Collection member **panics early**
(`utils/mod.rs:31`), before any lifecycle check. Plugins must be attached at mint time via
`create`'s `plugins` argument. Blotto Cup mints the pass **bare** and inherits the Collection-level
freeze, which sidesteps the trap entirely. This was tracked as IPC-003 in the old repo and is
preserved as a comment on the mint call site.
