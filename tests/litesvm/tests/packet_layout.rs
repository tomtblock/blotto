//! This suite's own packet encoder, pinned to the Python oracle (audit
//! 2026-09-11, F-14).
//!
//! `encode_packet_with_terms` in `src/lib.rs` is the FOURTH hand-written copy
//! of the 85-byte layout, and it is the copy that drives the real on-chain
//! verifier against the compiled artifact. Every credentialed and gate test
//! in this directory builds its entry packets with it. So when the program's
//! `entry_packet.rs` and this encoder drift together — the easy mistake,
//! because whoever moves a field will move both — the whole integration
//! suite agrees with itself and passes while the packet service issues
//! something the program cannot read.
//!
//! `backend/packet/fixtures/gen_vectors.py` is the independent oracle, and
//! this file is the last of the four copies to be tied to it. It needs no
//! artifact and no LiteSVM instance: it is pure bytes, so it runs (and can
//! fail) even when `target/deploy/blotto_cup.so` is absent.

use blotto_litesvm_tests::*;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;

const PACKET_VECTORS_JSON: &str = include_str!("../../../backend/packet/fixtures/vectors.json");

/// The quoted string value of `"key"` in one flat JSON object.
fn json_str<'a>(obj: &'a str, key: &str) -> &'a str {
    let needle = format!("\"{key}\":");
    let at = obj
        .find(&needle)
        .unwrap_or_else(|| panic!("vectors.json case has no `{key}`"));
    let rest = &obj[at + needle.len()..];
    let open = rest.find('"').expect("value is not a string");
    let tail = &rest[open + 1..];
    &tail[..tail.find('"').expect("unterminated string")]
}

/// The bare integer value of `"key"` in one flat JSON object.
fn json_int(obj: &str, key: &str) -> i64 {
    let needle = format!("\"{key}\":");
    let at = obj
        .find(&needle)
        .unwrap_or_else(|| panic!("vectors.json case has no `{key}`"));
    let rest = &obj[at + needle.len()..];
    let end = rest.find([',', '\n', '}']).expect("unterminated value");
    rest[..end].trim().parse().expect("value is not an integer")
}

/// Each case object of the oracle file, as raw text.
fn oracle_cases() -> Vec<&'static str> {
    // The generator writes one flat object per case, opened by `\n  {\n`.
    // Splitting there keeps each case's keys together, `"name"` included,
    // and cannot merge two objects.
    PACKET_VECTORS_JSON
        .split("\n  {\n")
        .skip(1)
        .map(|rest| &rest[..rest.find('}').expect("unterminated case object")])
        .collect()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn this_suites_encoder_reproduces_the_python_oracle_byte_for_byte() {
    let cases = oracle_cases();
    assert_eq!(
        cases.len(),
        5,
        "the scan found {} cases in backend/packet/fixtures/vectors.json — regenerate it with \
         `python3 fixtures/gen_vectors.py --write` from backend/packet/, and if the case count \
         legitimately changed, change it here too",
        cases.len()
    );

    for case in cases {
        let name = json_str(case, "name");
        let wallet = Pubkey::from_str(json_str(case, "wallet")).expect("wallet is base58");
        let pool = Pubkey::from_str(json_str(case, "pool")).expect("pool is base58");
        let produced = encode_packet_with_terms(
            &wallet,
            &pool,
            json_str(case, "nonce")
                .parse::<u64>()
                .expect("nonce is a u64"),
            json_int(case, "geo_cleared") as u8,
            json_int(case, "age_verified") as u8,
            json_int(case, "kyc_tier") as u8,
            json_str(case, "issued_at")
                .parse::<i64>()
                .expect("issued_at is an i64"),
            json_int(case, "terms_version") as u16,
        );
        assert_eq!(
            produced.len(),
            85,
            "{name}: the canonical packet is 85 bytes"
        );
        assert_eq!(
            hex(&produced),
            json_str(case, "expected_hex"),
            "{name}: this suite's encoder disagrees with the Python oracle. Every integration \
             test in this directory builds its packets with this function, so a disagreement \
             here means the suite is driving the program with bytes the packet service would \
             never issue."
        );
    }
}

/// `encode_packet` is `encode_packet_with_terms` at terms version 1 — the
/// well-formed default the gate tests rely on. Asserted rather than assumed,
/// because a default of 0 is refused by the program and would turn every
/// entry in this suite into a `PacketMalformed` that looked like a real bug.
#[test]
fn the_default_encoder_stamps_terms_version_one() {
    let wallet = Pubkey::new_unique();
    let pool = Pubkey::new_unique();
    let short = encode_packet(&wallet, &pool, 9, 1, 1, 0, 1_756_000_000);
    let long = encode_packet_with_terms(&wallet, &pool, 9, 1, 1, 0, 1_756_000_000, 1);
    assert_eq!(short, long);
    assert_eq!(
        u16::from_le_bytes([short[83], short[84]]),
        1,
        "terms_version must be non-zero or the program refuses the packet"
    );
}
