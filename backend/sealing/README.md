# backend/sealing

**Status: not implemented. Placeholder created in Phase 0.**

## Why it is empty

New work. Nothing in the predecessor repository sealed anything — it had no allocations to hide — so there was
nothing to carry.

## What Phase 2 must build here

The pool-key lifecycle from TECH-ARCH §5:

1. At `open_pool`, generate an X25519 keypair in Turnkey under a policy that permits **export only
   after the pool reaches `Sealed` or passes its fill deadline**. Publish the public key and
   `sha256(secret)` on-chain.
2. Store submitted ciphertexts. **Ciphertext only** — the store never holds a plaintext allocation
   before close, and no code path may read one. This is the property that makes the operator blind
   rather than merely trusted, and it is defeated silently by any well-meaning debug endpoint.
3. At seal: export the secret, land `reveal_pool_secret`, decrypt every entry, verify each against
   the `battles_hash` recorded on-chain at entry, and publish the plaintext set with salts.

Two failure modes must be implemented and published, not discovered later (TECH-ARCH §5): a lost
ciphertext means that entry is scored as all losses and its fee is refunded from the platform share;
an export failure means the deadline-triggered full refund path runs.

The public wording is fixed: "Battles are encrypted to a key nobody holds until the pool closes, and
their hash is recorded on-chain at entry."
