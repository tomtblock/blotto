#!/usr/bin/env python3
"""Independent oracle for the 83-byte EntryPacket encoding (TECH-ARCH §8).

Python builds the canonical bytes for known field values; the TypeScript
issuer (src/packet.ts) and — via the LiteSVM suite — the on-chain verifier
(programs/blotto_cup/src/entry_packet.rs) are pinned to the SAME layout.
Signatures are deliberately out of scope: Ed25519 correctness is the
runtime's/the library's; the layout is ours, so the layout is what gets an
oracle.

Regenerate with: python3 fixtures/gen_vectors.py --write   (from backend/packet/)
"""
import json
import sys

# Minimal base58 (bitcoin alphabet) so the oracle has zero dependencies.
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58decode(s: str) -> bytes:
    zeros = 0
    while zeros < len(s) and s[zeros] == "1":
        zeros += 1
    acc = 0
    for c in s[zeros:]:
        acc = acc * 58 + B58.index(c)
    body = acc.to_bytes((acc.bit_length() + 7) // 8, "big") if acc else b""
    return b"\x00" * zeros + body


def b58encode(b: bytes) -> str:
    zeros = 0
    while zeros < len(b) and b[zeros] == 0:
        zeros += 1
    acc = int.from_bytes(b, "big")
    out = ""
    while acc:
        acc, r = divmod(acc, 58)
        out = B58[r] + out
    return "1" * zeros + out


def encode(wallet58: str, pool58: str, nonce: int, geo: int, age: int, kyc: int, issued_at: int) -> bytes:
    wallet = b58decode(wallet58).rjust(32, b"\x00")
    pool = b58decode(pool58).rjust(32, b"\x00")
    return (
        wallet
        + pool
        + nonce.to_bytes(8, "little")
        + bytes([geo, age, kyc])
        + issued_at.to_bytes(8, "little", signed=True)
    )


def main() -> None:
    cases = []
    for name, wallet, pool, nonce, geo, age, kyc, issued in [
        ("baseline", b58encode(bytes(range(1, 33))), b58encode(bytes(range(33, 65))), 42, 1, 1, 0, 1_756_000_000),
        ("kyc_tier_1", b58encode(bytes([7]) * 32), b58encode(bytes([9]) * 32), 2**63, 1, 1, 1, 2_000_000_000),
        ("uncleared", b58encode(bytes([1]) * 32), b58encode(bytes([2]) * 32), 0, 0, 0, 0, 0),
    ]:
        raw = encode(wallet, pool, nonce, geo, age, kyc, issued)
        assert len(raw) == 83
        cases.append(
            {
                "name": name,
                "wallet": wallet,
                "pool": pool,
                "nonce": str(nonce),
                "geo_cleared": geo,
                "age_verified": age,
                "kyc_tier": kyc,
                "issued_at": str(issued),
                "expected_hex": raw.hex(),
            }
        )
    out = json.dumps({"_comment": "GENERATED - python oracle for the 83-byte packet layout. Regenerate: python3 fixtures/gen_vectors.py --write", "cases": cases}, indent=1)
    if "--write" in sys.argv:
        with open("fixtures/vectors.json", "w") as f:
            f.write(out + "\n")
        print("wrote fixtures/vectors.json")
    else:
        print(out)


if __name__ == "__main__":
    main()
