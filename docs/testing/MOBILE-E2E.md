# Mobile end-to-end runs on devnet — the evidence

One table per run of the Android package against devnet, each field with the source it was read
from. A field that was not captured at the time says **not recorded**; nothing here is
reconstructed from memory. How to run the test is [`../guide/MOBILE.md`](../guide/MOBILE.md) §5;
what is not covered by automation is [`TESTING-REPORT.md`](TESTING-REPORT.md) §8.

Devnet only; no real money. Every signature links to the Solana Explorer on devnet.

**The short version.** One run is on record: on 30 September 2026 the package, inside the emulator,
signed in through the Mobile Wallet Adapter and placed an easy-mode entry into devnet pool #50. **Pool
#50 never sealed.** It had one entrant against a floor of 40, so at its deadline it took the refund
fork: the untouched pot went back to the treasury and the entry was repaid in full. There was no
reveal, no result and no prize payment, so there is nothing for the verify page to recompute for
that pool. A run that reaches a settled pool and the verify page on the phone is
[pending](#run-2--pending-a-settled-pool-verified-on-the-phone).

## Run 1 — sign-in and an entry, pool #50 (30 September 2026)

| Field | Value | Source |
|---|---|---|
| Date and time (UTC) | 2026-09-30, entry transaction landed **04:22:27** (slot 505778029). The entry packet was issued at 04:22:11 | The transaction's block time; the packet's `issued_at` |
| Device | Android emulator: Pixel, Android 15 / API 35 with Google Play; WebView Chromium 124. Build fingerprint not recorded | [`MOBILE.md`](../guide/MOBILE.md) §5 and §9 |
| Package | `gg.blotto.app` | [`app/src/channel/android-app.ts`](../../app/src/channel/android-app.ts) (`ANDROID_PACKAGE_ID`) |
| Release tag and APK SHA-256 | **Not recorded for this run.** The package was built locally that morning and used without a rebuild; its hash was not captured. The only release, `mobile-v1-57701bc` (pre-release, published 2026-09-30 16:51 UTC, about 12 hours after this run, from a later commit), is a different build: its APK SHA-256 is `1ee7a0c30ede321b7f5fedee36680df608dcc3e185ee2e3f8ae033d30ce8eaf9`, signed with the certificate whose fingerprint the site publishes (`ANDROID_SIGNING_CERT_SHA256`) | GitHub release asset digest, and a local `sha256sum` of the downloaded file |
| Wallet | Phantom on Solana devnet (`cluster='devnet'` in Phantom's log). Phantom version not recorded. Address `7PwabxFpJkn123xZAX6NogvTa6pXjJxwwATKyizEAh2n` — the fee payer and first signer of the pool's only `register` | `MOBILE.md` §5; the transaction |
| Site build | `/api/version` was **not recorded**. The production deployment completed at 04:20:34 UTC was `62dcb7a`, which contains the Ed25519 fix `23d5ca4` the entry needed; that `www.blotto.gg` was serving it at 04:22 is not shown | GitHub deployment record |
| Mobile Wallet Adapter sign-in | `IdentityVerifier: DAL verification for https://www.blotto.gg (caller=gg.blotto.app): true`, one `associate/local`, `Authorize request completed successfully`, `cluster='devnet'`, then three `AuthRecord still valid; reissuing`, no `Revoking AuthRecord`. Quoted without timestamps; the raw logcat was not kept | `MOBILE.md` §5 |
| 18+ attestation | The wallet's signature over the 18+ and terms statement is off-chain and was not recorded. On chain, the entry carries an Ed25519 entry packet signed by the entry signer `9XhwKrXjKwFdYJatxYMZYyfB6nFLbmdFNSuM5JTyy8TP`, which the program accepts only from `Config.entry_signer`. Decoded: `age_verified = 1`, `geo_cleared = 1`, `terms_version = 5` | The transaction's Ed25519 instruction, read with the layout in [`entry_packet.rs`](../../programs/blotto_cup/src/entry_packet.rs) |
| Seal and entry | The seal's message signature is off-chain and was not recorded. Entry (`register`): [`5pcrXqVzTd5JKRJcYqhqfRboiBCiRHzbZneiqDtNHejHggAmHYc3Wo5ZFtW26nH4yJN3WdroUVNxQZgVXvRv4Xfs`](https://explorer.solana.com/tx/5pcrXqVzTd5JKRJcYqhqfRboiBCiRHzbZneiqDtNHejHggAmHYc3Wo5ZFtW26nH4yJN3WdroUVNxQZgVXvRv4Xfs?cluster=devnet) — committed `battles_hash` `e2a3610af05c584c89f7713bbfa62c668cdd34975d8b55bf9ca6b4fcf0b26f02`, seat 1 | The transaction; the indexer's `/pools/:pool/entries` |
| Pool | **#50**, PDA [`32iyj3Quj2hxuw1vNzj2MWS1MchVr62oWKJE86UA39Fi`](https://explorer.solana.com/address/32iyj3Quj2hxuw1vNzj2MWS1MchVr62oWKJE86UA39Fi?cluster=devnet). Tier 0, easy mode, entry 0.1 SOL, fill deadline 14:23:10 UTC, minimum field 40 | The PDA derived from its seeds and matched to the indexer and the chain |
| Outcome | **Refunded; the pool never sealed.** One entrant against a floor of 40. `trigger_refund` [`62aWmni8DEFMJxfeepqBPHPmEmF7q6nk2oRLd3BrgeXwbNZ6XApcoQmGkdLDDrvqKPxe7Mxwr7GR81aQ6xYr1PAw`](https://explorer.solana.com/tx/62aWmni8DEFMJxfeepqBPHPmEmF7q6nk2oRLd3BrgeXwbNZ6XApcoQmGkdLDDrvqKPxe7Mxwr7GR81aQ6xYr1PAw?cluster=devnet) (14:23:14) returned the pot from the vault to the treasury; `refund` [`3qZF4sPA4xfvhVAprNJYR6Bf28qaDKzoZgF26YN1hCRTY8Mc7jjF4zZJ4om3XBYiDm2ns6aQMkswJAT8wuQWiwXA`](https://explorer.solana.com/tx/3qZF4sPA4xfvhVAprNJYR6Bf28qaDKzoZgF26YN1hCRTY8Mc7jjF4zZJ4om3XBYiDm2ns6aQMkswJAT8wuQWiwXA?cluster=devnet) (14:23:16) repaid the 0.1 SOL entry to the wallet. No prize payment | The pool PDA's full signature history (six transactions, all successful) |
| Verify result | **None — nothing to verify.** The pool has no revealed secret and no results root, and the indexer answers `no verified archive for this pool` | The indexer's `/pools/:pool/leaderboard` and `/verify-record` |

The pool's whole on-chain life, for completeness: `open_pool`, `commit_vrf_seed` and
`create_pass_collection` by the keeper at 02:23 UTC; the one `register` above at 04:22; then
`trigger_refund` and `refund` at 14:23. There is no `seal_at_deadline`, `reveal_pool_secret`,
`commit_results` or `pay_prizes` for this pool.

**What this run does establish:** the package signs in through the Mobile Wallet Adapter, the
wallet verifies the app against the site's Digital Asset Links, and a real entry lands on devnet from
inside the shell, gated by a signed entry packet that records the 18+ check. **What it does not:**
settlement, payment or verification, all of which run identically for an entry from any channel, but
none of which was exercised from the phone here.

## Run 2 — pending: a settled pool, verified on the phone

Not yet run. It needs a pool that reaches its minimum field and settles. When it happens, record
every field above at the time, and in particular the ones run 1 lost:

- the APK SHA-256 of the package installed (`sha256sum` before `adb install`), and its release tag;
- the Phantom version (Settings → About) and `adb shell getprop ro.build.fingerprint`;
- `https://www.blotto.gg/api/version`, fetched just before the entry;
- the raw logcat from sign-in to the entry (`adb logcat -c`, then capture to a file);
- the pool's `pay_prizes` signature or signatures, and the verify page's verdict for the pool on the
  phone, with a screen recording (`adb shell screenrecord`).
