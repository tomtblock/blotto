# backend/sealing — how a battle set is sealed, and what that does and does not promise

This package owns two things: the **sealed payload format** a client encrypts at entry, and the
**custody of the key** it is encrypted to. The published rules must describe sealing accurately, so
this file also records exactly what the public wording may claim.

---

## The mechanism

At `open_pool`, before any entry exists, a fresh **X25519 keypair** is created for that pool. Two
things go on-chain immediately:

- `Pool.sealing_pubkey` — the public half, which every entry encrypts to.
- `Pool.sealing_secret_hash` — `sha256(secret)`. This commitment makes the later reveal checkable:
  when the secret is published (`PoolSecretRevealed`), anyone can hash it and confirm it is the one
  the pool committed to at open.

A client seals its payload to that public key using **libsodium's `crypto_box_seal`** construction
(`sealedbox.ts`): a fresh ephemeral keypair per entry, a nonce derived as
`blake2b-24(ephemeral_pk ‖ recipient_pk)`, and the ciphertext `ephemeral_pk ‖ box(...)`.

The construction is deliberately libsodium-compatible. Any standard sodium binding — Python, Rust, a
command-line tool — can open these boxes once the secret is published, so **a player does not have
to trust this code to check its work.**

The payload is fixed-width per board mode (`payload.ts`): the battle set (35 bytes in easy mode, 70
in hard), a 32-byte salt, per-battle timings (7 × u32) and a 32-byte device hash — **127 bytes in
easy mode, 162 in hard**. The battle set and salt are what the on-chain `battles_hash` commits to;
`battlesCommitment` is the one definition of that hash. The timings and device hash travel sealed and
reach only the detection layer: the published reveal bundle carries neither, and no public route
serves a sealed box. The bundle is the only public copy of a pool's battle sets.

---

## What the sealing guarantees

**While a pool is taking entries, no entry can be read** — not by another player and not by the
operator. The secret is held in custody under an **export policy that reads chain state**
(`custody.ts`): export is permitted only once the pool is `Sealed` or past its `fill_deadline`. It
is not a local flag an operator can flip; `ExportRefusedError` is the policy working.

In production the secret is held by Turnkey (`custody-turnkey.ts`). Turnkey's policies gate *who*
may export it; this package's chain-state check gates *when*. Without Turnkey credentials the daemon
uses `LocalCustody`, which enforces the same policy and is for devnet only.

That is what stops the attack the design exists to prevent: seeing the field before choosing your
own allocation.

## What it does not guarantee

**The key is generated inside the operator's own process.** Turnkey offers no X25519 curve, and the
on-chain hash must exist at `open_pool`, so `createPoolKey` generates the keypair in process memory,
imports the secret into Turnkey and wipes the local copy. For that instant the operator's process
holds the secret.

The sealing property therefore rests on **the custody policy**, not on a claim that the operator
never had the key. Generating the key inside the custody enclave would remove this gap; it is not
built. The rules page says plainly that the operator's systems generate and hold the key.

Do not describe this as a scheme in which nobody could ever read an entry. Describe it as one where
reading an entry early would require defeating the custody policy, and where the reveal is checkable
against a commitment made before the first entry.

---

## The public wording

The one-line form used beside the entry button (`app/src/copy/index.ts`, `sealed`):

> Battles are encrypted on your device to a key our systems hold locked against export until the
> pool closes; their hash is recorded on-chain at entry.

The rules page carries the longer form (`rules.sealing` in the same file). Both say that the
operator's systems generate and hold the key. Neither may be strengthened into a claim that the
encryption is unbreakable or that the operator cannot hold the key; the mechanism supports neither.

---

## Layout

| File | What it owns |
|---|---|
| `sealedbox.ts` | The `crypto_box_seal` construction — the same code the browser and the daemon run |
| `payload.ts` | The canonical payload per mode, its encode/decode, and `battlesCommitment` |
| `custody.ts` | The `PoolKeyCustody` contract, the export policy, `ExportRefusedError`, `LocalCustody` |
| `custody-turnkey.ts` | The production custody: secrets held by Turnkey, exported only under the policy |
| `custody-pg.ts`, `store.ts` | The published-key store — the public half and the hash, never the secret |
| `scoring.ts` | The battle-set encoding shared with the scoring engine |

Further reading: [`docs/architecture/ARCHITECTURE.md`](../../docs/architecture/ARCHITECTURE.md)
(pool-key custody) and [`docs/guide/HOW-IT-WORKS.md`](../../docs/guide/HOW-IT-WORKS.md).
