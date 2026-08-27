#!/usr/bin/env python3
"""Known-vector generator for the TypeScript scoring engine (roadmap 2.1).

Python is the independent oracle (R20): every number in vectors.json is
computed HERE, by plain Python over the PID §5 rules, never captured from the
TypeScript implementation — a vector captured from our own engine proves
nothing (CLAUDE.md, output expectations).

Scoring rules implemented (PID §4.4/§5, TECH-ARCH §6):
  - allocation: five integers in one battle, fixed stat order, sum exactly 100
  - battle k vs battle k; a stat is won by the larger number; ties to neither
  - a battle is won by >= 3 stats; if neither side reaches 3, it is a draw
  - score is carried in INTEGER HALF-POINTS: win 2, draw 1, loss 0 (no floats
    anywhere — the on-chain rule extends to the oracle)
  - rank by score desc, then zones (total stats won) desc, then entry index
    asc (TECH-ARCH says "entered_at asc"; entry index is the same order made
    strictly monotonic — recorded in the Phase 2 report)
  - prizes: pot = 64 x 80% x entry; rank r takes PRIZE_BANDS_1024[r-1]/1024
    of the pot (exact 1024ths, NOT the rounded bps column — see
    programs/blotto_cup/src/constants.rs for the derivation); ranks 17..64
    take zero
  - results leaf: sha256(0x00 || player(32) || rank(u8) || amount(u64 LE)),
    node: sha256(0x01 || left || right); an odd node is PROMOTED, not
    duplicated; leaves in rank order 1..64

Deterministic allocation stream (also implemented in TS, byte-identical):
  alloc_bytes(i) = sha256("alloc:" + str(i))          # 32 bytes
  dividers d0..d3 = (u16 LE at offsets 0,2,4,6) % 101, sorted
  parts = [d0, d1-d0, d2-d1, d3-d2, 100-d3]
Adequate as a spread sanity stream; not a uniformity proof.

Regenerate with:  python3 fixtures/gen_vectors.py --write  (from backend/scoring/)
"""

import hashlib
import json
import sys

STATS = 5
BATTLES = 7
CAPACITY = 64
PRIZE_BANDS_1024 = [270, 158, 102, 78, 50, 50, 50, 50, 27, 27, 27, 27, 27, 27, 27, 27]
ENTRY_LAMPORTS = 100_000_000  # the 0.1 SOL tier anchors every amount vector
POT = ENTRY_LAMPORTS * 8 // 10 * CAPACITY  # 5_120_000_000


def sha256(b: bytes) -> bytes:
    return hashlib.sha256(b).digest()


# ---------------------------------------------------------------------------
# Deterministic allocation stream
# ---------------------------------------------------------------------------

def alloc_from_counter(i: int) -> list[int]:
    h = sha256(f"alloc:{i}".encode())
    d = sorted(int.from_bytes(h[k * 2 : k * 2 + 2], "little") % 101 for k in range(4))
    parts = [d[0], d[1] - d[0], d[2] - d[1], d[3] - d[2], 100 - d[3]]
    assert sum(parts) == 100 and all(0 <= p <= 100 for p in parts)
    return parts


def battles_from_counter(base: int) -> list[list[int]]:
    return [alloc_from_counter(base + k) for k in range(BATTLES)]


# ---------------------------------------------------------------------------
# The rules
# ---------------------------------------------------------------------------

def battle_outcome(a: list[int], b: list[int]) -> tuple[str, int, int]:
    """-> (outcome for a: 'win'|'loss'|'draw', stats won by a, stats won by b)."""
    wa = sum(1 for z in range(STATS) if a[z] > b[z])
    wb = sum(1 for z in range(STATS) if b[z] > a[z])
    if wa >= 3:
        return "win", wa, wb
    if wb >= 3:
        return "loss", wa, wb
    return "draw", wa, wb


def score_pool(players: list[list[list[int]]]) -> list[dict]:
    n = len(players)
    score = [0] * n  # half-points
    zones = [0] * n
    for i in range(n):
        for j in range(i + 1, n):
            for k in range(BATTLES):
                out, wa, wb = battle_outcome(players[i][k], players[j][k])
                zones[i] += wa
                zones[j] += wb
                if out == "win":
                    score[i] += 2
                elif out == "loss":
                    score[j] += 2
                else:
                    score[i] += 1
                    score[j] += 1
    order = sorted(range(n), key=lambda i: (-score[i], -zones[i], i))
    ranks = [0] * n
    for pos, i in enumerate(order):
        ranks[i] = pos + 1
    return [
        {"index": i, "score_half": score[i], "zones": zones[i], "rank": ranks[i]}
        for i in range(n)
    ]


def amount_for_rank(rank: int) -> int:
    if 1 <= rank <= 16:
        return POT * PRIZE_BANDS_1024[rank - 1] // 1024
    return 0


# ---------------------------------------------------------------------------
# Encoding + Merkle
# ---------------------------------------------------------------------------

def encode_battles(battles: list[list[int]]) -> bytes:
    return bytes(v for b in battles for v in b)


def battles_hash(battles: list[list[int]], salt: bytes) -> bytes:
    return sha256(encode_battles(battles) + salt)


def leaf_bytes(player: bytes, rank: int, amount: int) -> bytes:
    return player + bytes([rank]) + amount.to_bytes(8, "little")


def merkle_root(leaves: list[bytes]) -> bytes:
    level = [sha256(b"\x00" + l) for l in leaves]
    while len(level) > 1:
        nxt = []
        for i in range(0, len(level) - 1, 2):
            nxt.append(sha256(b"\x01" + level[i] + level[i + 1]))
        if len(level) % 2 == 1:
            nxt.append(level[-1])  # promoted, not duplicated
        level = nxt
    return level[0]


def player_pubkey(pool: str, i: int) -> bytes:
    return sha256(f"player:{pool}:{i}".encode())


# ---------------------------------------------------------------------------
# Vector assembly
# ---------------------------------------------------------------------------

def hand_battle_cases() -> list[dict]:
    # NOTE: a 5-0 sweep is IMPOSSIBLE between equal-sum allocations (winning
    # all five stats would need a strictly larger sum), so 4-1 is the maximum.
    cases = [
        ("loss_2_3", [30, 30, 20, 10, 10], [10, 10, 30, 30, 20], "loss"),
        ("win_3_2", [30, 30, 30, 5, 5], [20, 20, 20, 20, 20], "win"),
        ("majority_3", [25, 25, 25, 15, 10], [20, 20, 20, 20, 20], "win"),
        ("mirror_loss", [10, 10, 10, 35, 35], [20, 20, 20, 20, 20], "loss"),
        ("all_tied", [20, 20, 20, 20, 20], [20, 20, 20, 20, 20], "draw"),
        ("two_two_one_tie", [30, 30, 10, 10, 20], [10, 10, 30, 30, 20], "draw"),
        ("one_one_three_ties", [30, 30, 20, 10, 10], [10, 30, 20, 30, 10], "draw"),
        ("four_one_maximum", [25, 25, 25, 24, 1], [20, 20, 20, 20, 20], "win"),
        ("three_with_a_tie", [25, 25, 25, 20, 5], [20, 20, 20, 20, 20], "win"),
        ("edge_100_0", [100, 0, 0, 0, 0], [0, 100, 0, 0, 0], "draw"),
    ]
    out = []
    for name, a, b, expected in cases:
        got, wa, wb = battle_outcome(a, b)
        assert got == expected, f"{name}: hand expectation wrong ({got} != {expected})"
        out.append(
            {"name": name, "a": a, "b": b, "stats_a": wa, "stats_b": wb, "outcome": got}
        )
    return out


def pool_vector(name: str, players: list[list[list[int]]], with_tree: bool) -> dict:
    results = score_pool(players)
    by_rank = sorted(results, key=lambda r: r["rank"])
    vec = {
        "name": name,
        "players": [
            {"battles": p, "battles_hex": encode_battles(p).hex()} for p in players
        ],
        "results": results,
        "winners": [r["index"] for r in by_rank[: min(16, len(players))]],
    }
    if with_tree:
        leaves = [
            leaf_bytes(
                player_pubkey(name, r["index"]), r["rank"], amount_for_rank(r["rank"])
            )
            for r in by_rank
        ]
        vec["players_pubkeys"] = [player_pubkey(name, i).hex() for i in range(len(players))]
        vec["amounts"] = [str(amount_for_rank(r["rank"])) for r in by_rank]
        vec["leaves_hex"] = [l.hex() for l in leaves]
        vec["root"] = merkle_root(leaves).hex()
    return vec


def main() -> None:
    pools = []
    # 20 hand-checkable 4-player pools from the deterministic stream.
    for p in range(20):
        players = [battles_from_counter(p * 1000 + i * 100) for i in range(4)]
        pools.append(pool_vector(f"four_{p}", players, with_tree=False))
    # 5 full 64-player pools, with the results tree.
    for p in range(5):
        players = [
            battles_from_counter(100_000 + p * 100_000 + i * 100) for i in range(CAPACITY)
        ]
        pools.append(pool_vector(f"full_{p}", players, with_tree=True))
    # Edge cases.
    even = [[20, 20, 20, 20, 20] for _ in range(BATTLES)]
    pools.append(pool_vector("all_identical", [even] * 4, with_tree=False))
    alloc = alloc_from_counter(9_000_000)
    pools.append(
        pool_vector("all_tied_pairwise", [[alloc] * BATTLES] * 4, with_tree=False)
    )

    # Draw-rate sanity over the stream: single-battle comparisons.
    n_pairs = 10_000
    draws = 0
    for i in range(n_pairs):
        a = alloc_from_counter(10_000_000 + 2 * i)
        b = alloc_from_counter(10_000_000 + 2 * i + 1)
        if battle_outcome(a, b)[0] == "draw":
            draws += 1
    rate = draws / n_pairs

    # Hash cases.
    hash_cases = []
    for i in range(5):
        battles = battles_from_counter(20_000_000 + i * 10)
        salt = sha256(f"salt:{i}".encode())
        hash_cases.append(
            {
                "battles": battles,
                "salt": salt.hex(),
                "expected": battles_hash(battles, salt).hex(),
            }
        )

    vectors = {
        "_comment": (
            "GENERATED FILE - do not edit by hand. Regenerate with "
            "`python3 fixtures/gen_vectors.py --write` from backend/scoring/. "
            "Every value is computed by Python (the independent oracle, R20), "
            "never by the TypeScript engine under test."
        ),
        "rules": (
            "battle: stat won by larger number, ties to neither, battle won by "
            ">=3 stats else draw; score in half-points (win 2, draw 1); rank by "
            "score desc, zones desc, entry index asc; leaf sha256(0x00||player||"
            "rank_u8||amount_u64le), node sha256(0x01||l||r), odd node promoted"
        ),
        "entry_lamports": str(ENTRY_LAMPORTS),
        "pot_lamports": str(POT),
        "prize_bands_1024": PRIZE_BANDS_1024,
        "battle_cases": hand_battle_cases(),
        "pools": pools,
        "draw_rate": {"n": n_pairs, "draws": draws, "rate": rate, "stream_base": 10_000_000},
        "hash_cases": hash_cases,
    }

    out = json.dumps(vectors, indent=1)
    if "--write" in sys.argv:
        with open("fixtures/vectors.json", "w") as f:
            f.write(out + "\n")
        print(f"wrote fixtures/vectors.json ({len(out)} bytes); draw rate {rate:.3f}")
    else:
        print(out)


if __name__ == "__main__":
    main()
