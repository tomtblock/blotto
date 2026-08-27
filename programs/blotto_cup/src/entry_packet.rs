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
//! # Canonical packet encoding — 83 bytes, all integers little-endian
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
//!
//! `kyc_tier` is retained in the struct and always 0 at launch (R3); the
//! KYC-at-claim switch (4.5) requires `kyc_tier ≥ 1` on `release_escrow`.
//!
//! The packet service (`backend/packet/`) and the client instruction builder
//! (`app/src/tx/blotto-instructions.ts`) encode this SAME layout; the Python
//! generator `backend/packet/fixtures/gen_vectors.py` is the independent
//! oracle all three are pinned to.

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
pub const PACKET_LEN: usize = 32 + 32 + 8 + 1 + 1 + 1 + 8;

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
}
