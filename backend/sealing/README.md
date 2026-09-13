# `backend/sealing` — how a battle is sealed, and what that does and does not promise

This package owns two things: the **sealed payload format** a client encrypts at entry, and the
**custody of the key** it is encrypted to. It is the implementation behind compliance item **C4**,
which requires the sealing to be "described accurately" in published rules — so the wording at the
bottom of this file is fixed, and `app/src/rules/README.md` points here for it.

---

## The mechanism

At `open_pool`, before any entry exists, a fresh **X25519 keypair** is created for that pool. Two
things go on chain immediately:

- `Pool.sealing_pubkey` — the public half. It is what every entry encrypts to.
- `Pool.sealing_secret_hash` — `sha256(secret)`. This is the commitment that makes the later reveal
  checkable: when the secret is published, anyone can hash it and confirm it is the one the pool
  committed to at open.

A client seals its payload to that public key using **libsodium's `crypto_box_seal`** construction
(`sealedbox.ts`): a fresh ephemeral keypair per entry, a nonce derived as
`blake2b-24(ephemeral_pk ‖ recipient_pk)`, and the ciphertext `ephemeral_pk ‖ box(...)`.

The construction is deliberately libsodium-compatible rather than something of our own. Any standard
sodium binding — Python, Rust, a command-line tool — can open these boxes once the secret is
published. That keeps the claim honest: **a player is not obliged to trust our code to check our
work.**

The payload is fixed-width, 127 bytes (`payload.ts`): the seven battles, a salt, per-battle timings,
and a device hash. The battles and salt are what the on-chain `battles_hash` commits to. The timings
and device hash ride along sealed and reach the detection layer only — the published reveal bundle
carries neither.

---

## What the sealing actually guarantees

**While a pool is taking entries, no entry can be read.** Not by another player, and not by us. The
secret is held in custody under an **export policy that reads chain state** (`custody.ts`): an
export is permitted only once the pool is `Sealed` or past its `fill_deadline`. It is not a local
flag an operator can flip — `ExportRefusedError` is the policy working.

That is what stops the attack the whole design exists to prevent: seeing the field before choosing
your own allocation.

## What it does not guarantee — read this before repeating the claim

**The key is generated inside the operator's own process.** `createPoolKey` mints the X25519 keypair
in process memory, imports it into the enclave, and wipes it (`custody-turnkey.ts`). For that instant
the operator's process has held the secret.

So the sealing property rests on **the custody policy**, not on a claim that the operator never had
the key. That distinction is recorded as an open risk in `docs/BUILD-ROADMAP_v1.0.md` — the fix is
generation inside the enclave, so the secret never exists outside it, and it is not yet scheduled.
The custody disclosure page states the position plainly rather than implying more.

Do not describe this as a scheme where nobody could ever have read an entry. Describe it as one
where reading an entry early would require defeating the custody policy, and where the reveal is
checkable against a commitment made before the first entry.

---

## The fixed public wording (C4)

Published rules use this sentence. It is accurate, it claims no more than the mechanism delivers, and
it must not be paraphrased into something stronger:

> **Battles are encrypted to a key nobody holds until the pool closes, and their hash is recorded
> on-chain at entry.**

Two things it deliberately does not say: that the encryption is unbreakable, and that the operator is
incapable of holding the key. Both would be claims the mechanism cannot support.

---

## Layout

| File | What it owns |
|---|---|
| `sealedbox.ts` | The `crypto_box_seal` construction — the same code the browser and the crank run |
| `payload.ts` | The 127-byte canonical payload and its encode/decode |
| `custody.ts` | The `PoolKeyCustody` contract, the export policy seam, `ExportRefusedError` |
| `custody-turnkey.ts` | The production custody: keys held by Turnkey, exported only under the policy |
| `custody-pg.ts`, `store.ts` | The published-key store — the public half and the hash, never the secret |
| `scoring.ts` | The battle-set encoding shared with the scoring engine |

---

*Canonical for the sealing lifecycle and its failure modes:
`docs/TECH-ARCHITECTURE_Blotto-Cup_v0.2.md` §5. Canonical for what is deployed: `docs/AS-BUILT.md`.*
