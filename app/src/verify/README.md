# app/src/verify

**Status: empty scaffold created in Phase 0.**

## Why it is empty

The extraction brief (§6) expected to carry a verify-page scaffold from `anarchy-fun`. **No verify
page exists there.** The nearest thing, `app/design/signing/`, is a signing console for constructing
and inspecting transactions — a developer tool, not a verifier — and was not carried.

## What Phase 3 must build here

The page that makes the operator checkable rather than trusted (TECH-ARCH §10). Given a pool id:

1. Read the pool's events from chain: `PoolOpened`, every `EntryRegistered`, `PoolSealed`,
   `PoolSecretRevealed`, `ResultsCommitted`.
2. Decrypt the published ciphertexts with the revealed pool secret.
3. Hash each decrypted battle set with its salt and compare against the `battles_hash` recorded
   on-chain at entry — proving no allocation was altered after submission.
4. Recompute the full scoring and ranking **in the browser**, using the WASM build of
   `crates/blotto-scoring`, and rebuild the results Merkle tree.
5. Compare the recomputed root against the `results_root` the operator committed, and show the
   comparison plainly — including when it fails.

This page is the reason the sealing design exists. It must work for someone who does not trust us
and did not enter the pool.
