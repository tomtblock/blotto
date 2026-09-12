//! Entry-packet verification (roadmap 4.1; TECH-ARCH §8).
//!
//! The packet is the compliance gate on `register`: an off-chain service runs
//! geolocation, VPN, sanctions and age checks and, when they clear, signs an
//! `EntryPacket` with the Turnkey-custodied entry signer. The transaction
//! carries that signature as an `Ed25519Program` instruction; this module
//! confirms — from the **instructions sysvar**, never from anything the caller
//! merely claims — that:
//!
//!   1. an `Ed25519Program` instruction is present in THIS transaction,
//!   2. its verified public key equals `Config.entry_signer`,
//!   3. its verified message is a well-formed canonical packet,
//!   4. the packet binds this wallet and this pool,
//!   5. its checks cleared and it is fresh (≤ 60s old).
//!
//! The Ed25519 native program has already verified the signature by the time
//! any program instruction runs — a transaction carrying a bad signature fails
//! wholesale at the runtime. What this module adds is the BINDING: that the
//! thing verified is our signer's packet for this entry. Reading a boolean the
//! caller passes, instead of the sysvar, is the failure mode this design
//! exists to prevent (the extraction brief's §4 warning).
//!
//! # Canonical packet encoding — 85 bytes, all integers little-endian
//!
//! | offset | size | field         |
//! |--------|------|---------------|
//! | 0      | 32   | wallet        |
//! | 32     | 32   | pool          |
//! | 64     | 8    | nonce (u64)   |
//! | 72     | 1    | geo_cleared   |
//! | 73     | 1    | age_verified  |
//! | 74     | 1    | kyc_tier      |
//! | 75     | 8    | issued_at (i64) |
//! | 83     | 2    | terms_version (u16) |
//!
//! `kyc_tier` is retained in the struct and always 0 at launch (R3); the
//! KYC-at-claim switch (4.5) requires `kyc_tier ≥ 1` on `release_escrow`.
//! `terms_version` (D-B4, ratified 2026-08-27) is the version of the terms +
//! 18+ clickwrap the wallet attested to, persisted by the packet service
//! before it will sign a packet; the program requires it non-zero and emits
//! it on `EntryRegistered`, tying every entry to an accepted version. WHICH
//! version is current is service policy (config/terms.json), not program
//! state.
//!
//! # Who else writes these bytes, and what pins each one (audit 2026-09-11, F-14)
//!
//! The layout is hand-written in four places. The Python generator
//! `backend/packet/fixtures/gen_vectors.py` is the independent oracle, and
//! every other copy is now pinned to the vectors it emits:
//!
//!   - **this decoder** — `oracle_vectors_decode_to_their_declared_fields`
//!     below reads `backend/packet/fixtures/vectors.json` and decodes every
//!     case's bytes;
//!   - **the issuer**, `backend/packet/src/packet.ts` — pinned by
//!     `backend/packet/test/packet.spec.ts`;
//!   - **the integration suite's encoder**,
//!     `tests/litesvm/src/lib.rs::encode_packet_with_terms`, which is what
//!     actually drives this verifier against the compiled artifact — pinned
//!     by `tests/litesvm/tests/packet_layout.rs`;
//!   - **the oracle itself**, regenerated and diffed by
//!     `scripts/check-fixtures.sh`.
//!
//! The browser does NOT encode a packet: it receives the message from the
//! packet service as opaque bytes and wraps it in an `Ed25519Program`
//! instruction (`app/src/entry/register-tx.ts`). Until 2026-09-12 this
//! paragraph named `app/src/tx/blotto-instructions.ts`, which is not a file
//! in this repository, and claimed a pinning that existed for one of the
//! four copies.

use anchor_lang::prelude::*;
// anchor-lang 1.0's `solana_program` facade does not re-export the checked
// sysvar loaders; they come from the split crate directly (same version
// anchor itself depends on).
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

use crate::constants::{PACKET_MAX_AGE_SECS, PACKET_MAX_FUTURE_SKEW_SECS};
use crate::error::ErrorCode;

/// The Ed25519 signature-verification native program.
pub const ED25519_PROGRAM_ID: Pubkey = pubkey!("Ed25519SigVerify111111111111111111111111111");

/// The Instructions sysvar address (`Sysvar1nstructions…`). Pinned by
/// `address =` constraints wherever the sysvar account is taken.
pub const INSTRUCTIONS_SYSVAR_ID: Pubkey = pubkey!("Sysvar1nstructions1111111111111111111111111");

/// Canonical packet length.
pub const PACKET_LEN: usize = 32 + 32 + 8 + 1 + 1 + 1 + 8 + 2;

/// A parsed, signature-verified entry packet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntryPacket {
    pub wallet: Pubkey,
    pub pool: Pubkey,
    pub nonce: u64,
    pub geo_cleared: u8,
    pub age_verified: u8,
    pub kyc_tier: u8,
    pub issued_at: i64,
    /// Terms/attestation version accepted by the wallet (D-B4); never 0.
    pub terms_version: u16,
}

impl EntryPacket {
    /// Decode the canonical 83-byte message. Pure; rejects any other length.
    pub fn decode(message: &[u8]) -> Result<Self> {
        if message.len() != PACKET_LEN {
            return err!(ErrorCode::PacketMalformed);
        }
        let mut w = [0u8; 32];
        w.copy_from_slice(&message[0..32]);
        let mut p = [0u8; 32];
        p.copy_from_slice(&message[32..64]);
        Ok(Self {
            wallet: Pubkey::new_from_array(w),
            pool: Pubkey::new_from_array(p),
            nonce: u64::from_le_bytes(message[64..72].try_into().unwrap()),
            geo_cleared: message[72],
            age_verified: message[73],
            kyc_tier: message[74],
            issued_at: i64::from_le_bytes(message[75..83].try_into().unwrap()),
            terms_version: u16::from_le_bytes(message[83..85].try_into().unwrap()),
        })
    }

    /// Encode the canonical message. Used by the test suites; the off-chain
    /// encoders mirror it byte for byte.
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(PACKET_LEN);
        out.extend_from_slice(self.wallet.as_ref());
        out.extend_from_slice(self.pool.as_ref());
        out.extend_from_slice(&self.nonce.to_le_bytes());
        out.push(self.geo_cleared);
        out.push(self.age_verified);
        out.push(self.kyc_tier);
        out.extend_from_slice(&self.issued_at.to_le_bytes());
        out.extend_from_slice(&self.terms_version.to_le_bytes());
        out
    }
}

/// One `(pubkey, message)` pair extracted from an Ed25519 program instruction's
/// data. The signature itself is the runtime's business — see the module doc.
pub struct VerifiedSignature {
    pub pubkey: Pubkey,
    pub message: Vec<u8>,
}

/// Parse an `Ed25519Program` instruction's data (pure, fully bounds-checked).
///
/// # Layout (solana `ed25519_program`)
///
/// ```text
/// [0]     u8   number of signatures — this program requires exactly 1
/// [1]     u8   padding
/// [2..16] Ed25519SignatureOffsets, 7 × u16 LE:
///         signature_offset, signature_instruction_index,
///         public_key_offset, public_key_instruction_index,
///         message_data_offset, message_data_size, message_instruction_index
/// [16..]  the referenced bytes
/// ```
///
/// Every `*_instruction_index` must reference the ed25519 instruction itself —
/// either `u16::MAX` (the runtime's "this instruction" sentinel) or the
/// instruction's own index. A packet whose bytes live in a DIFFERENT
/// instruction is rejected: cross-instruction references would let a crafted
/// transaction point our binding checks at bytes the ed25519 program did not
/// actually verify together.
pub fn parse_ed25519_instruction_data(data: &[u8], self_index: u16) -> Result<VerifiedSignature> {
    const HEADER: usize = 2;
    const OFFSETS: usize = 14;
    if data.len() < HEADER + OFFSETS {
        return err!(ErrorCode::PacketMalformed);
    }
    if data[0] != 1 {
        // Exactly one signature: a multi-signature ed25519 ix would make "the
        // verified message" ambiguous.
        return err!(ErrorCode::PacketMalformed);
    }

    let u16_at =
        |i: usize| -> u16 { u16::from_le_bytes([data[HEADER + i * 2], data[HEADER + i * 2 + 1]]) };
    let _signature_offset = u16_at(0);
    let signature_ix = u16_at(1);
    let pubkey_offset = u16_at(2) as usize;
    let pubkey_ix = u16_at(3);
    let message_offset = u16_at(4) as usize;
    let message_size = u16_at(5) as usize;
    let message_ix = u16_at(6);

    let self_ref = |ix: u16| ix == u16::MAX || ix == self_index;
    if !(self_ref(signature_ix) && self_ref(pubkey_ix) && self_ref(message_ix)) {
        return err!(ErrorCode::PacketMalformed);
    }

    let pubkey_end = pubkey_offset
        .checked_add(32)
        .ok_or(ErrorCode::PacketMalformed)?;
    let message_end = message_offset
        .checked_add(message_size)
        .ok_or(ErrorCode::PacketMalformed)?;
    if pubkey_end > data.len() || message_end > data.len() {
        return err!(ErrorCode::PacketMalformed);
    }

    let mut pk = [0u8; 32];
    pk.copy_from_slice(&data[pubkey_offset..pubkey_end]);
    Ok(VerifiedSignature {
        pubkey: Pubkey::new_from_array(pk),
        message: data[message_offset..message_end].to_vec(),
    })
}

/// Policy checks on a decoded packet (pure — the whole decision table is unit
/// tested without a runtime).
pub fn check_packet_policy(
    packet: &EntryPacket,
    expected_wallet: &Pubkey,
    expected_pool: &Pubkey,
    now: i64,
    min_kyc_tier: u8,
) -> Result<()> {
    require_keys_eq!(
        packet.wallet,
        *expected_wallet,
        ErrorCode::PacketWrongWallet
    );
    require_keys_eq!(packet.pool, *expected_pool, ErrorCode::PacketWrongPool);
    require!(
        packet.geo_cleared == 1 && packet.age_verified == 1,
        ErrorCode::PacketNotCleared
    );
    // D-B4: an entry must tie to an accepted terms version; 0 = never
    // attested. Version currency is enforced by the issuing service.
    require!(
        packet.terms_version >= 1,
        ErrorCode::PacketTermsVersionMissing
    );
    require!(
        packet.kyc_tier >= min_kyc_tier,
        ErrorCode::PacketKycInsufficient
    );
    require!(
        packet.issued_at <= now.saturating_add(PACKET_MAX_FUTURE_SKEW_SECS),
        ErrorCode::PacketStale
    );
    require!(
        now.saturating_sub(packet.issued_at) <= PACKET_MAX_AGE_SECS,
        ErrorCode::PacketStale
    );
    Ok(())
}

/// Find and fully verify the entry packet in this transaction.
///
/// Walks the instructions sysvar for an `Ed25519Program` instruction (the
/// runtime has already verified its signature or the transaction would not be
/// executing), binds its public key to `expected_signer`, decodes its message
/// as a canonical packet, and applies the policy checks.
pub fn verify_entry_packet(
    instructions_sysvar: &AccountInfo,
    expected_signer: &Pubkey,
    expected_wallet: &Pubkey,
    expected_pool: &Pubkey,
    now: i64,
    min_kyc_tier: u8,
) -> Result<EntryPacket> {
    let current = load_current_index_checked(instructions_sysvar)?;
    for index in 0..current {
        let ix = load_instruction_at_checked(index as usize, instructions_sysvar)?;
        if ix.program_id != ED25519_PROGRAM_ID {
            continue;
        }
        // An ed25519 instruction that fails any check propagates its specific
        // error via `?` right here — so falling out of the loop can only mean
        // no ed25519 instruction existed at all (the §13 omission case).
        let sig = parse_ed25519_instruction_data(&ix.data, index)?;
        require_keys_eq!(sig.pubkey, *expected_signer, ErrorCode::PacketWrongSigner);
        let packet = EntryPacket::decode(&sig.message)?;
        check_packet_policy(&packet, expected_wallet, expected_pool, now, min_kyc_tier)?;
        return Ok(packet);
    }
    err!(ErrorCode::PacketMissing)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packet() -> EntryPacket {
        EntryPacket {
            wallet: Pubkey::new_unique(),
            pool: Pubkey::new_unique(),
            nonce: 42,
            geo_cleared: 1,
            age_verified: 1,
            kyc_tier: 0,
            issued_at: 1_700_000_000,
            terms_version: 1,
        }
    }

    /// Build a well-formed ed25519 instruction data blob around a message,
    /// mirroring what `Ed25519Program.createInstructionWithPublicKey` emits.
    fn ed25519_ix_data(pubkey: &Pubkey, message: &[u8], ix_index: u16) -> Vec<u8> {
        let sig_offset = 2u16 + 14; // header + offsets
        let pk_offset = sig_offset + 64;
        let msg_offset = pk_offset + 32;
        let mut d = vec![1u8, 0u8];
        for v in [
            sig_offset,
            ix_index,
            pk_offset,
            ix_index,
            msg_offset,
            message.len() as u16,
            ix_index,
        ] {
            d.extend_from_slice(&v.to_le_bytes());
        }
        d.extend_from_slice(&[0u8; 64]); // signature bytes (runtime-verified)
        d.extend_from_slice(pubkey.as_ref());
        d.extend_from_slice(message);
        d
    }

    #[test]
    fn packet_round_trips_through_the_canonical_encoding() {
        let p = packet();
        assert_eq!(p.encode().len(), PACKET_LEN);
        assert_eq!(EntryPacket::decode(&p.encode()).unwrap(), p);
    }

    #[test]
    fn decode_rejects_any_other_length() {
        assert!(EntryPacket::decode(&[0u8; PACKET_LEN - 1]).is_err());
        assert!(EntryPacket::decode(&[0u8; PACKET_LEN + 1]).is_err());
        assert!(EntryPacket::decode(&[]).is_err());
    }

    #[test]
    fn parse_accepts_a_well_formed_instruction_with_max_sentinel() {
        let p = packet();
        let signer = Pubkey::new_unique();
        let d = ed25519_ix_data(&signer, &p.encode(), u16::MAX);
        let got = parse_ed25519_instruction_data(&d, 0).unwrap();
        assert_eq!(got.pubkey, signer);
        assert_eq!(got.message, p.encode());
    }

    #[test]
    fn parse_accepts_a_self_index_reference() {
        let p = packet();
        let signer = Pubkey::new_unique();
        let d = ed25519_ix_data(&signer, &p.encode(), 3);
        assert!(parse_ed25519_instruction_data(&d, 3).is_ok());
        // …but not a reference to a DIFFERENT instruction.
        assert!(parse_ed25519_instruction_data(&d, 2).is_err());
    }

    #[test]
    fn parse_rejects_multi_signature_and_truncated_data() {
        let p = packet();
        let signer = Pubkey::new_unique();
        let mut d = ed25519_ix_data(&signer, &p.encode(), u16::MAX);
        d[0] = 2; // two signatures
        assert!(parse_ed25519_instruction_data(&d, 0).is_err());
        assert!(parse_ed25519_instruction_data(&[1, 0, 0], 0).is_err());
    }

    #[test]
    fn parse_rejects_out_of_bounds_offsets() {
        let p = packet();
        let signer = Pubkey::new_unique();
        let mut d = ed25519_ix_data(&signer, &p.encode(), u16::MAX);
        // Point the message past the end of the data.
        let msg_off_pos = 2 + 4 * 2;
        d[msg_off_pos..msg_off_pos + 2].copy_from_slice(&u16::MAX.to_le_bytes());
        assert!(parse_ed25519_instruction_data(&d, 0).is_err());
    }

    #[test]
    fn policy_accepts_a_fresh_cleared_packet() {
        let p = packet();
        assert!(check_packet_policy(&p, &p.wallet, &p.pool, p.issued_at + 30, 0).is_ok());
    }

    #[test]
    fn policy_rejects_every_failure_mode() {
        let p = packet();
        let now = p.issued_at + 10;
        let other = Pubkey::new_unique();
        // Wrong wallet / wrong pool (§13: "a packet for another pool reverts").
        assert!(check_packet_policy(&p, &other, &p.pool, now, 0).is_err());
        assert!(check_packet_policy(&p, &p.wallet, &other, now, 0).is_err());
        // Checks not cleared.
        let mut q = p.clone();
        q.geo_cleared = 0;
        assert!(check_packet_policy(&q, &q.wallet, &q.pool, now, 0).is_err());
        let mut q = p.clone();
        q.age_verified = 0;
        assert!(check_packet_policy(&q, &q.wallet, &q.pool, now, 0).is_err());
        // D-B4: a packet with no accepted terms version is refused.
        let mut q = p.clone();
        q.terms_version = 0;
        assert!(check_packet_policy(&q, &q.wallet, &q.pool, now, 0).is_err());
        // Stale (61s) and too-far-future (6s beyond skew).
        assert!(check_packet_policy(&p, &p.wallet, &p.pool, p.issued_at + 61, 0).is_err());
        assert!(check_packet_policy(&p, &p.wallet, &p.pool, p.issued_at - 6, 0).is_err());
        // KYC tier gate (4.5): tier 0 packet refused when tier 1 required.
        assert!(check_packet_policy(&p, &p.wallet, &p.pool, now, 1).is_err());
        let mut q = p.clone();
        q.kyc_tier = 1;
        assert!(check_packet_policy(&q, &q.wallet, &q.pool, now, 1).is_ok());
    }

    #[test]
    fn policy_boundary_exactly_60s_is_fresh() {
        let p = packet();
        assert!(check_packet_policy(&p, &p.wallet, &p.pool, p.issued_at + 60, 0).is_ok());
    }

    // -----------------------------------------------------------------
    // The Python oracle (audit 2026-09-11, F-14)
    //
    // The 85-byte layout is hand-written in four places and the module doc
    // claimed all of them were pinned to `gen_vectors.py`. One was. This
    // pins the on-chain decoder — the copy that decides whether real money
    // moves — directly against the generated vectors, so a field inserted
    // in Python and not here fails in this crate rather than on devnet.
    //
    // WHY THE FILE IS SCANNED RATHER THAN PARSED. The program crate carries
    // no JSON parser and cannot gain one: a dependency added for a test
    // still enters the on-chain crate's tree. The same reasoning, and the
    // same `include_str!` + `#[cfg(test)]` shape, as
    // `constants::tests::class_counter_mirrors_hold`. The scanner below is
    // strict — it fails on a missing key rather than returning a default —
    // and the test asserts the case COUNT first, so a scan that found
    // nothing cannot pass silently.
    // -----------------------------------------------------------------

    const PACKET_VECTORS_JSON: &str = include_str!("../../../backend/packet/fixtures/vectors.json");

    /// The quoted string value of `"key"` in one flat JSON object.
    fn json_str<'a>(obj: &'a str, key: &str) -> &'a str {
        let needle = format!("\"{key}\":");
        let at = obj
            .find(&needle)
            .unwrap_or_else(|| panic!("vectors.json case has no `{key}`: {obj}"));
        let rest = &obj[at + needle.len()..];
        let open = rest
            .find('"')
            .unwrap_or_else(|| panic!("`{key}` is not a string in vectors.json"));
        let tail = &rest[open + 1..];
        let close = tail
            .find('"')
            .unwrap_or_else(|| panic!("`{key}` is unterminated in vectors.json"));
        &tail[..close]
    }

    /// The bare integer value of `"key"` in one flat JSON object.
    fn json_int(obj: &str, key: &str) -> i64 {
        let needle = format!("\"{key}\":");
        let at = obj
            .find(&needle)
            .unwrap_or_else(|| panic!("vectors.json case has no `{key}`: {obj}"));
        let rest = &obj[at + needle.len()..];
        let end = rest
            .find([',', '\n', '}'])
            .unwrap_or_else(|| panic!("`{key}` is unterminated in vectors.json"));
        rest[..end]
            .trim()
            .parse()
            .unwrap_or_else(|e| panic!("`{key}` is not an integer in vectors.json: {e}"))
    }

    fn unhex(s: &str) -> Vec<u8> {
        assert!(s.len().is_multiple_of(2), "expected_hex has an odd length");
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("expected_hex is not hex"))
            .collect()
    }

    /// Each case object of the oracle file, as raw text.
    fn oracle_cases() -> Vec<&'static str> {
        // The generator writes one flat object per case; splitting on the
        // object opener keeps each case's keys together and cannot merge two.
        PACKET_VECTORS_JSON
            .split("\n  {\n")
            .skip(1)
            .map(|rest| &rest[..rest.find('}').expect("unterminated case object")])
            .collect()
    }

    #[test]
    fn oracle_vectors_decode_to_their_declared_fields() {
        let cases = oracle_cases();
        assert_eq!(
            cases.len(),
            5,
            "the scan found {} cases in backend/packet/fixtures/vectors.json — regenerate it \
             with `python3 fixtures/gen_vectors.py --write` from backend/packet/, and if the \
             case count legitimately changed, change it here too",
            cases.len()
        );

        for case in cases {
            let bytes = unhex(json_str(case, "expected_hex"));
            assert_eq!(
                bytes.len(),
                PACKET_LEN,
                "the oracle emits {} bytes; PACKET_LEN is {PACKET_LEN}",
                bytes.len()
            );
            let decoded = EntryPacket::decode(&bytes).expect("the oracle's bytes must decode");

            let wallet = Pubkey::try_from(json_str(case, "wallet")).expect("wallet is base58");
            let pool = Pubkey::try_from(json_str(case, "pool")).expect("pool is base58");
            assert_eq!(decoded.wallet, wallet, "wallet at offset 0");
            assert_eq!(decoded.pool, pool, "pool at offset 32");
            assert_eq!(
                decoded.nonce,
                json_str(case, "nonce")
                    .parse::<u64>()
                    .expect("nonce is a u64"),
                "nonce at offset 64"
            );
            assert_eq!(
                decoded.geo_cleared as i64,
                json_int(case, "geo_cleared"),
                "geo_cleared at offset 72"
            );
            assert_eq!(
                decoded.age_verified as i64,
                json_int(case, "age_verified"),
                "age_verified at offset 73"
            );
            assert_eq!(
                decoded.kyc_tier as i64,
                json_int(case, "kyc_tier"),
                "kyc_tier at offset 74"
            );
            assert_eq!(
                decoded.issued_at,
                json_str(case, "issued_at")
                    .parse::<i64>()
                    .expect("issued_at is an i64"),
                "issued_at at offset 75"
            );
            assert_eq!(
                decoded.terms_version as i64,
                json_int(case, "terms_version"),
                "terms_version at offset 83"
            );
        }
    }

    /// The oracle's own cases cover the edges the layout can get wrong: a
    /// nonce above 2^53 (a JS number would lose it), a non-zero KYC tier, an
    /// all-zero packet, a terms version past 1, and a packet whose
    /// `geo_cleared` and `age_verified` DIFFER. Asserted so a future
    /// regeneration that quietly dropped one is visible.
    #[test]
    fn the_oracle_still_covers_the_edges_the_layout_can_get_wrong() {
        let names: Vec<&str> = oracle_cases().iter().map(|c| json_str(c, "name")).collect();
        assert_eq!(
            names,
            [
                "baseline",
                "kyc_tier_1",
                "uncleared",
                "terms_v2",
                // Added 2026-09-12: every other case sets geo_cleared and
                // age_verified alike, so a layout that swapped those two
                // adjacent bytes reproduced all four vectors exactly.
                "geo_without_age",
            ]
        );

        let by_name = |want: &str| -> Vec<u8> {
            for case in oracle_cases() {
                if json_str(case, "name") == want {
                    return unhex(json_str(case, "expected_hex"));
                }
            }
            panic!("no oracle case named {want}");
        };
        // 2^63 — past what a double can represent exactly.
        assert_eq!(
            EntryPacket::decode(&by_name("kyc_tier_1")).unwrap().nonce,
            1u64 << 63
        );
        let uncleared = EntryPacket::decode(&by_name("uncleared")).unwrap();
        assert_eq!(uncleared.geo_cleared, 0);
        assert_eq!(uncleared.age_verified, 0);
        assert_eq!(
            EntryPacket::decode(&by_name("terms_v2"))
                .unwrap()
                .terms_version,
            2
        );
        // The two adjacent flag bytes are distinguishable in at least one
        // vector, or a swapped pair would decode every case correctly.
        let asymmetric = EntryPacket::decode(&by_name("geo_without_age")).unwrap();
        assert_eq!(asymmetric.geo_cleared, 1);
        assert_eq!(asymmetric.age_verified, 0);
    }
}
