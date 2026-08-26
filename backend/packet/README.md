# backend/packet

**Status: not implemented. Placeholder created in Phase 0.**

## Why it is empty

The extraction brief (§4) expected to carry an ed25519 signed-packet path from `anarchy-fun` — a
backend-issued struct, verified on-chain against a config pubkey via the instructions sysvar, with a
Turnkey-custodied signer and an admin rotation instruction.

**None of it exists in the old repository.** There is no ed25519 code, no signed packet of any kind,
no Turnkey integration, and no signer-rotation instruction anywhere in it. The brief's instruction
to "quote the relevant verification code in the report" is therefore moot — there is no code to
quote. See `EXTRACTION-REPORT.md` under "Component: Signed-packet infrastructure".

The nearest useful thing in the old repo is unrelated to packets: `pack_open.rs` reads the
`SlotHashes` sysvar as raw account data with an `address =` constraint pinning it to the real sysvar.
That is a good pattern reference for reading a sysvar safely, and nothing more.

## What Phase 1 must build here

The backend half of the entry packet: an endpoint that runs geolocation, VPN, sanctions, age and KYC
checks at issuance and returns either a signed `EntryPacket` or a **generic** rejection that does not
tell the caller which check failed.

Packet fields per TECH-ARCH §8: `wallet, pool, nonce, geo_cleared, age_verified, kyc_tier,
issued_at, signature`. The signer is Turnkey-custodied, sign-only, no export, and rotatable through
`Config.entry_signer` on-chain.

The on-chain half is `programs/blotto_cup/src/entry_packet.rs`, also new work. Its verification must
load the instructions sysvar, confirm an `Ed25519Program` instruction is present in the same
transaction, and confirm that instruction's pubkey, message and signature match the config signer and
the canonical packet encoding. **Reading a boolean flag, or trusting anything the caller passes, is
the failure mode this design exists to prevent.** TECH-ARCH §13's first acceptance criterion is that
`register` without the ed25519 precompile instruction reverts.
