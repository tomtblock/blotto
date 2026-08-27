# backend/reveal

**Status: not implemented. Placeholder created in Phase 0.**

## Why it is empty

New work, and note that "reveal" means two different things in this repository:

- **This directory** is the *pool* reveal — the post-close pipeline that decrypts sealed battles,
  verifies each against its on-chain hash, runs scoring, builds the results tree and lands
  `commit_results`.
- **`app/src/reveal/`** is the *class* reveal — the front-end animation that shows a player which
  cosmetic character class their pass drew. Carried from the old repo's animation code.

They are unrelated. The old repo had a URI-reveal authority concept for NFT metadata; it does not
exist in its code (the asset URI is minted as an empty string and nothing ever updates it), and it is
not what either of these is.

## What Phase 2 must build here

Consume the revealed pool secret, decrypt every ciphertext, verify each plaintext against the
`battles_hash` written to its `Entry` account at registration, run `blotto-scoring` over the verified
set, build the results Merkle tree with `blotto-merkle`, and land `commit_results`.

Everything needed to recompute the outcome independently must be published: the revealed secret, the
plaintext battle sets with their salts, and the class table. A player who does not trust the operator
must be able to arrive at the same root from the event log alone — that is what `app/src/verify/`
is for.
