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
  - rank by score desc, then zones (total stats won) desc; players equal on
    BOTH are TIED (D3-B, ratified 2026-08-27) and share a COMPETITION rank
    (1, 2, 2, 4 — one plus the number of strictly-better players); entry
    index never breaks a rank
  - prizes: pot = 64 x 80% x entry; a tie group at rank r of size s occupies
    positions r..r+s-1 and its combined prize is the sum of the band amounts
    of those positions that are <= 16 (PRIZE_BANDS_1024[p-1]/1024 of the pot
    each — exact 1024ths, NOT the rounded bps column, see
    programs/blotto_cup/src/constants.rs); each member takes
    floor(combined/s), the indivisible remainder goes to the group's lowest
    entry index; every tied member with a nonzero share is paid (the paid
    set can exceed 16 seats)
  - results leaf: sha256(0x00 || player(32) || rank(u8) || amount(u64 LE)),
    node: sha256(0x01 || left || right); an odd node is PROMOTED, not
    duplicated; leaves ordered (rank asc, entry index asc)

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
    group_start = 0
    for pos, i in enumerate(order):
        if pos > 0:
            prev = order[pos - 1]
            if (score[i], zones[i]) != (score[prev], zones[prev]):
                group_start = pos
        ranks[i] = group_start + 1
    return [
        {"index": i, "score_half": score[i], "zones": zones[i], "rank": ranks[i]}
        for i in range(n)
    ]


def band_amount(pot: int, position: int) -> int:
    if 1 <= position <= 16:
        return pot * PRIZE_BANDS_1024[position - 1] // 1024
    return 0


def assign_prizes(results: list[dict], pot: int) -> dict[int, int]:
    """D3-B split-pot assignment: seat -> lamports (0 for unpaid seats)."""
    amounts = {r["index"]: 0 for r in results}
    groups: dict[int, list[int]] = {}
    for r in results:
        groups.setdefault(r["rank"], []).append(r["index"])
    for rank, seats in groups.items():
        combined = sum(band_amount(pot, p) for p in range(rank, rank + len(seats)))
        if combined == 0:
            continue
        each = combined // len(seats)
        rem = combined % len(seats)
        low = min(seats)
        for seat in seats:
            amounts[seat] = each + (rem if seat == low else 0)
    expected = sum(band_amount(pot, p) for p in range(1, min(16, len(results)) + 1))
    assert sum(amounts.values()) == expected, "split-pot conservation failed"
    return amounts


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


def pool_vector(
    name: str,
    players: list[list[list[int]]],
    with_tree: bool,
    entry_lamports: int = ENTRY_LAMPORTS,
) -> dict:
    results = score_pool(players)
    pot = entry_lamports * 8 // 10 * CAPACITY
    amounts = assign_prizes(results, pot)
    for r in results:
        r["amount_lamports"] = str(amounts[r["index"]])
    # Published leaf order: rank asc, entry index asc (ranks repeat).
    by_rank = sorted(results, key=lambda r: (r["rank"], r["index"]))
    vec = {
        "name": name,
        "entry_lamports": str(entry_lamports),
        "players": [
            {"battles": p, "battles_hex": encode_battles(p).hex()} for p in players
        ],
        "results": results,
        # Comma-joined rather than a JSON array: a bare 64-integer array is
        # exactly the shape of a Solana keypair, and the gitleaks rule that
        # guards against committed keypairs must stay strict (no allowlist).
        "leaf_order": ",".join(str(r["index"]) for r in by_rank),
        # The on-chain committed payout list: nonzero seats, seat-sorted.
        "payouts": [
            {"entry_index": seat, "amount": str(amount)}
            for seat, amount in sorted(amounts.items())
            if amount > 0
        ],
    }
    if with_tree:
        leaves = [
            leaf_bytes(
                player_pubkey(name, r["index"]), r["rank"], amounts[r["index"]]
            )
            for r in by_rank
        ]
        vec["players_pubkeys"] = [player_pubkey(name, i).hex() for i in range(len(players))]
        vec["amounts"] = [str(amounts[r["index"]]) for r in by_rank]
        vec["leaves_hex"] = [l.hex() for l in leaves]
        vec["root"] = merkle_root(leaves).hex()
    return vec


def split_case(name: str, group_sizes: list[int], entry_lamports: int) -> dict:
    """A constructed ranking with the given tie-group sizes over 64 seats,
    fed through the SAME assign_prizes as the real pools."""
    assert sum(group_sizes) == CAPACITY
    results = []
    rank = 1
    seat = 0
    for size in group_sizes:
        for _ in range(size):
            results.append({"index": seat, "rank": rank})
            seat += 1
        rank += size
    pot = entry_lamports * 8 // 10 * CAPACITY
    amounts = assign_prizes(results, pot)
    return {
        "name": name,
        "entry_lamports": str(entry_lamports),
        "group_sizes": group_sizes,
        "payouts": [
            {"entry_index": s, "amount": str(a)}
            for s, a in sorted(amounts.items())
            if a > 0
        ],
    }


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
    # Per-tier 64-player vectors for the D1 tiers beyond 0.1 SOL (same
    # battles, different pots — amounts must scale exactly).
    tier_players = [battles_from_counter(700_000 + i * 100) for i in range(CAPACITY)]
    for entry in (500_000_000, 750_000_000, 1_000_000_000, 2_500_000_000,
                  5_000_000_000, 7_500_000_000):
        pools.append(
            pool_vector(
                f"tier_{entry}", tier_players, with_tree=True, entry_lamports=entry
            )
        )
    # Edge cases. Identical battle sets are exact ties (D3-B): every member
    # shares rank 1 and the pot splits evenly.
    even = [[20, 20, 20, 20, 20] for _ in range(BATTLES)]
    pools.append(pool_vector("all_identical", [even] * 4, with_tree=False))
    pools.append(pool_vector("all_identical_64", [even] * CAPACITY, with_tree=True))
    alloc = alloc_from_counter(9_000_000)
    pools.append(
        pool_vector("all_tied_pairwise", [[alloc] * BATTLES] * 4, with_tree=False)
    )

    # D3-B split-pot cases, through the same assign_prizes as the pools:
    # a two-way tie for 1st; a three-way tie at 4th-6th with a visible
    # integer remainder (890_000_000 / 3 leaves 2 lamports to the lowest
    # seat); a two-way tie at 16th whose paid set is 17 seats; and a 64-way
    # tie splitting the whole pot.
    split_cases = [
        split_case("two_way_first", [2] + [1] * 62, ENTRY_LAMPORTS),
        split_case("three_way_4_6", [1, 1, 1, 3] + [1] * 58, ENTRY_LAMPORTS),
        split_case("straddle_17", [1] * 15 + [2] + [1] * 47, ENTRY_LAMPORTS),
        split_case("all_identical_64", [64], ENTRY_LAMPORTS),
        split_case("three_way_4_6_tier_0_75", [1, 1, 1, 3] + [1] * 58, 750_000_000),
    ]

    # Per-tier prize tables: the 16 band amounts at every configured tier.
    tier_tables = [
        {
            "entry_lamports": str(entry),
            "pot_lamports": str(entry * 8 // 10 * CAPACITY),
            "bands": [str(band_amount(entry * 8 // 10 * CAPACITY, p)) for p in range(1, 17)],
        }
        for entry in (100_000_000, 500_000_000, 750_000_000, 1_000_000_000,
                      2_500_000_000, 5_000_000_000, 7_500_000_000)
    ]

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
            "score desc, zones desc; equal on both = TIED, shared competition "
            "rank (D3-B), tie group splits the combined band prize of its "
            "occupied positions <= 16 evenly, remainder to the lowest seat; "
            "leaf sha256(0x00||player||rank_u8||amount_u64le), node "
            "sha256(0x01||l||r), odd node promoted, leaves (rank asc, seat asc)"
        ),
        "entry_lamports": str(ENTRY_LAMPORTS),
        "pot_lamports": str(POT),
        "prize_bands_1024": PRIZE_BANDS_1024,
        "battle_cases": hand_battle_cases(),
        "pools": pools,
        "split_cases": split_cases,
        "tier_tables": tier_tables,
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
