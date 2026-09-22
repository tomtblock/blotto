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
  - prizes: the pot is the tier's FIXED constant (D-A1 revised, funded from
    the prize treasury at open_pool, never derived from entries — the launch
    table below); ONE paid place (D-E2, ratified 2026-09-06): a tie group at
    rank r of size s occupies positions r..r+s-1 and its combined prize is
    the sum of the band amounts of those positions that are <= PAID_RANKS
    (PRIZE_BANDS_1024[p-1]/1024 of the pot each — the table is [1024], so
    position 1 is the whole pot and every other position is zero; see
    programs/blotto_cup/src/constants.rs); each member takes
    floor(combined/s), the indivisible remainder goes to the group's lowest
    entry index; every tied member with a nonzero share is paid — so the
    winner takes the pot, or a tie for first splits it, and nobody else is
    paid
  - field size: a pool runs with 40..64 players (R7-b, MIN_SEATS = 40); the
    n = 52 and n = 58 pool vectors below cover the minimum-field path
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
MIN_SEATS = 40  # R7-b (2026-09-12): the smallest field that runs
PAID_RANKS = 1  # D-E2: winner takes all
PRIZE_BANDS_1024 = [1024]
ENTRY_LAMPORTS = 100_000_000  # the 0.1 SOL tier anchors every amount vector
# The launch economics table (D1 prices; D-A1 revised FIXED pots) — mirrors
# constants.rs. A pot is a table entry, never arithmetic over entries.
TIER_ENTRY_LAMPORTS = [
    100_000_000, 500_000_000, 750_000_000, 1_000_000_000,
    2_500_000_000, 5_000_000_000, 7_500_000_000,
]
TIER_POT_LAMPORTS = [
    4_000_000_000, 20_000_000_000, 30_000_000_000, 40_000_000_000,
    100_000_000_000, 200_000_000_000, 300_000_000_000,
]


def pot_for_entry(entry_lamports: int) -> int:
    return TIER_POT_LAMPORTS[TIER_ENTRY_LAMPORTS.index(entry_lamports)]


POT = pot_for_entry(ENTRY_LAMPORTS)  # 4_000_000_000 (D-E1)


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


def score_with_missing(players: list[list[list[int]]] | list[None]) -> list[dict]:
    """The lost-ciphertext rule (TECH-ARCH §5), computed from first principles.

    `players[i]` is a battle set, or None when that entry's ciphertext is lost.

    This deliberately does NOT reproduce the TypeScript's shortcut. The
    implementation scores the present players among themselves and then adds a
    constant (`missing * BATTLES * 2`) to every one of them, which is sound
    only because the adjustment is uniform. Transcribing that here would make
    the oracle agree with the implementation by construction and prove
    nothing — the exact failure CLAUDE.md names: "a vector captured from our
    own output proves nothing."

    So this walks the FULL n x n comparison and applies the published rule at
    each pairing:
      - present vs present : the ordinary battle
      - present vs missing : the present side wins every battle; no stats
                             exist to compare, so neither side gains a zone
      - missing vs missing : every battle is a draw, one half-point each
    If the shortcut is right, the two agree. That agreement is the proof.
    """
    n = len(players)
    score = [0] * n  # half-points
    zones = [0] * n
    for i in range(n):
        for j in range(i + 1, n):
            a, b = players[i], players[j]
            for k in range(BATTLES):
                if a is not None and b is not None:
                    out, wa, wb = battle_outcome(a[k], b[k])
                    zones[i] += wa
                    zones[j] += wb
                    if out == "win":
                        score[i] += 2
                    elif out == "loss":
                        score[j] += 2
                    else:
                        score[i] += 1
                        score[j] += 1
                elif a is not None:      # b is missing: a wins, no zones
                    score[i] += 2
                elif b is not None:      # a is missing: b wins, no zones
                    score[j] += 2
                else:                    # both missing: a draw
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
    if 1 <= position <= PAID_RANKS:
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
    expected = sum(band_amount(pot, p) for p in range(1, min(PAID_RANKS, len(results)) + 1))
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


def merkle_proof(leaves: list[bytes], index: int) -> list[tuple[str, bool]]:
    """Inclusion proof for leaf `index`: [(sibling_hex, sibling_on_right)].
    A promoted odd node contributes no step, so the side bit is explicit —
    the same shape backend/scoring/src/merkle.ts emits and the on-chain
    verifier (programs/blotto_cup/src/merkle.rs) consumes."""
    level = [sha256(b"\x00" + l) for l in leaves]
    i = index
    proof: list[tuple[str, bool]] = []
    while len(level) > 1:
        nxt = []
        for k in range(0, len(level) - 1, 2):
            nxt.append(sha256(b"\x01" + level[k] + level[k + 1]))
        odd = len(level) % 2 == 1
        if odd:
            nxt.append(level[-1])
        if odd and i == len(level) - 1:
            pass  # promoted — no sibling at this level
        elif i % 2 == 0:
            proof.append((level[i + 1].hex(), True))
        else:
            proof.append((level[i - 1].hex(), False))
        i //= 2
        level = nxt
    return proof


def rust_merkle_vectors(pools: list[dict]) -> str:
    """The Rust fixture module for the on-chain verifier's unit test —
    Python-generated so the program is checked against the same oracle as
    the TypeScript engine (CLAUDE.md: a vector captured from our own Rust
    output proves nothing). Proofs for the first, a middle, the promoted
    (odd-position) and the last leaf of pool `full_0` (64 leaves) and of
    the minimum-field pool (MIN_SEATS leaves). The second one exists to
    exercise an ODD level on the way up the tree, where the last node is
    carried unhashed: 64 is a clean power of two and never produces one.
    That property survives the R7-b change from 52 to 40 seats — 40 halves
    to 20, 10, 5, and 5 is odd."""
    out = [
        "//! GENERATED by backend/scoring/fixtures/gen_vectors.py — do not edit.",
        "//! Merkle proofs computed by the Python oracle (R20) over the pool",
        "//! vectors in vectors.json; consumed by `merkle.rs`'s unit test.",
        "",
        "pub struct ProofCase {",
        "    pub player: &'static str,",
        "    pub rank: u8,",
        "    pub amount: u64,",
        "    pub steps: &'static [(&'static str, bool)],",
        "}",
        "",
        "pub struct PoolVector {",
        "    pub root: &'static str,",
        "    pub cases: &'static [ProofCase],",
        "}",
        "",
    ]
    for name, const in (("full_0", "FULL_0"), (f"field_{MIN_SEATS}", "FIELD_MIN")):
        pool = next(p for p in pools if p["name"] == name)
        n = len(pool["leaves_hex"])
        leaves = [bytes.fromhex(h) for h in pool["leaves_hex"]]
        by_rank = [int(s) for s in pool["leaf_order"].split(",")]
        results = {r["index"]: r for r in pool["results"]}
        out.append(f"pub const {const}: PoolVector = PoolVector {{")
        out.append(f'    root: "{pool["root"]}",')
        out.append("    cases: &[")
        for pos in sorted({0, n // 2, n - 1, n - 2}):
            seat = by_rank[pos]
            r = results[seat]
            steps = merkle_proof(leaves, pos)
            out.append("        ProofCase {")
            out.append(f'            player: "{pool["players_pubkeys"][seat]}",')
            out.append(f'            rank: {r["rank"]},')
            out.append(f'            amount: {r["amount_lamports"]},')
            out.append("            steps: &[")
            for sib, right in steps:
                out.append(f'                ("{sib}", {"true" if right else "false"}),')
            out.append("            ],")
            out.append("        },")
        out.append("    ],")
        out.append("};")
        out.append("")
    return "\n".join(out)


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
    pot = pot_for_entry(entry_lamports)
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
    """A constructed ranking with the given tie-group sizes over a field of
    52..64 seats (D-E4), fed through the SAME assign_prizes as the real
    pools."""
    assert MIN_SEATS <= sum(group_sizes) <= CAPACITY, name
    results = []
    rank = 1
    seat = 0
    for size in group_sizes:
        for _ in range(size):
            results.append({"index": seat, "rank": rank})
            seat += 1
        rank += size
    pot = pot_for_entry(entry_lamports)
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


def missing_vector(name: str, players: list) -> dict:
    """A pool where some entries' ciphertexts were lost.

    `players[i]` is a battle set or None. No prizes and no tree here: the
    money and the leaf order are already covered by the present-only pools,
    and what these vectors exist to pin is the scoring and ranking of a field
    that is not all there.
    """
    return {
        "name": name,
        "players": [
            None if p is None else {"battles": p, "battles_hex": encode_battles(p).hex()}
            for p in players
        ],
        "missing_indices": [i for i, p in enumerate(players) if p is None],
        "results": score_with_missing(players),
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
    # Minimum-field pools: a pool that sealed at its deadline with MIN_SEATS
    # (40 since R7-b, founder instruction 2026-09-12) or 58 players. Same
    # rules, a shorter leaf list, the whole pot to rank 1 — the tree over
    # n < 64 leaves exercises the odd node being carried up unhashed at
    # different depths.
    for n in (MIN_SEATS, 58):
        players = [battles_from_counter(800_000 + n * 1000 + i * 100) for i in range(n)]
        pools.append(pool_vector(f"field_{n}", players, with_tree=True))
    # Edge cases. Identical battle sets are exact ties (D3-B): every member
    # shares rank 1 and the pot splits evenly.
    even = [[20, 20, 20, 20, 20] for _ in range(BATTLES)]
    pools.append(pool_vector("all_identical", [even] * 4, with_tree=False))
    pools.append(pool_vector("all_identical_64", [even] * CAPACITY, with_tree=True))
    alloc = alloc_from_counter(9_000_000)
    pools.append(
        pool_vector("all_tied_pairwise", [[alloc] * BATTLES] * 4, with_tree=False)
    )

    # Lost-ciphertext pools (TECH-ARCH §5). scoreWithMissing decides every
    # real settlement — crank.ts and ranking.ts both score through it — and
    # until 2026-09-21 no oracle covered it. The Python here walks the full
    # n x n comparison rather than the implementation's uniform-shift
    # shortcut, so agreement is evidence and not a tautology.
    def _p(base: int, n: int) -> list:
        return [battles_from_counter(base + i * 100) for i in range(n)]

    missing_pools = []
    # One lost entry, at the front, in the middle, and at the back — the seat
    # a missing entry occupies must not change anyone else's score.
    for seat in (0, 2, 3):
        pl = _p(2_000_000, 4)
        pl[seat] = None
        missing_pools.append(missing_vector(f"one_missing_seat_{seat}", pl))
    # Two missing: they draw with each other and lose to everyone else, so
    # they tie with each other and sit last.
    pl = _p(2_100_000, 6)
    pl[1] = pl[4] = None
    missing_pools.append(missing_vector("two_missing", pl))
    # Every entry lost. Degenerate, and it must still produce a lawful
    # ranking rather than throw: all equal, all rank 1.
    missing_pools.append(missing_vector("all_missing_4", [None] * 4))
    # Exactly one entry survives — it wins everything, the rest tie behind it.
    pl = [None] * 5
    pl[3] = battles_from_counter(2_200_000)
    missing_pools.append(missing_vector("one_present_of_5", pl))
    # A realistic settlement: a full field with a handful lost.
    pl = _p(2_300_000, CAPACITY)
    for seat in (0, 7, 31, 62, 63):
        pl[seat] = None
    missing_pools.append(missing_vector("full_64_five_missing", pl))
    # A minimum field with one lost, the shape a pool that sealed at its
    # deadline actually takes.
    pl = _p(2_400_000, MIN_SEATS)
    pl[MIN_SEATS - 1] = None
    missing_pools.append(missing_vector(f"field_{MIN_SEATS}_one_missing", pl))
    # None missing at all: scoreWithMissing must agree with scorePool exactly,
    # which is the claim its doc comment makes about relative ranking.
    missing_pools.append(missing_vector("none_missing_4", _p(2_500_000, 4)))

    # D3-B split-pot cases under D-E2, through the same assign_prizes as the
    # pools: a two-way tie for 1st at EVERY tier (pot / 2, exact — every pot
    # is even); a three-way tie for 1st at tier 0 with the visible integer
    # remainder (4_000_000_000 / 3 leaves 1 lamport to the lowest seat); a
    # tie for SECOND, which pays exactly one seat (nothing below first is
    # paid); a 64-way tie splitting the whole pot; and the same shapes over
    # a 52-seat field.
    split_cases = [
        split_case(f"two_way_first_tier_{entry}", [2] + [1] * 62, entry)
        for entry in TIER_ENTRY_LAMPORTS
    ] + [
        split_case("three_way_first", [3] + [1] * 61, ENTRY_LAMPORTS),
        split_case("tie_for_second", [1, 2] + [1] * 61, ENTRY_LAMPORTS),
        split_case("all_identical_64", [64], ENTRY_LAMPORTS),
        split_case("two_way_first_field_52", [2] + [1] * 50, ENTRY_LAMPORTS),
        split_case("three_way_first_field_52", [3] + [1] * 49, ENTRY_LAMPORTS),
        # The floor itself (R7-b): a two-way tie for first in a pool that
        # sealed at exactly MIN_SEATS. The 52-seat cases above keep their
        # names and their fields -- 52 is still an ordinary field between the
        # floor and capacity, and what they pin is the tie shape, not the
        # floor.
        split_case("two_way_first_field_min", [2] + [1] * (MIN_SEATS - 2), ENTRY_LAMPORTS),
        split_case("all_identical_52", [52], ENTRY_LAMPORTS),
    ]

    # Per-tier prize tables: the band amounts at every configured tier — one
    # band under D-E2, equal to the pot.
    tier_tables = [
        {
            "entry_lamports": str(entry),
            "pot_lamports": str(pot_for_entry(entry)),
            "bands": [
                str(band_amount(pot_for_entry(entry), p)) for p in range(1, PAID_RANKS + 1)
            ],
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
            "occupied positions <= PAID_RANKS (= 1, D-E2: the winner takes the "
            "pot) evenly, remainder to the lowest seat; a pool runs with 52..64 "
            "players (D-E4); "
            "leaf sha256(0x00||player||rank_u8||amount_u64le), node "
            "sha256(0x01||l||r), odd node promoted, leaves (rank asc, seat asc)"
        ),
        "entry_lamports": str(ENTRY_LAMPORTS),
        "pot_lamports": str(POT),
        "paid_ranks": PAID_RANKS,
        "min_seats": MIN_SEATS,
        "prize_bands_1024": PRIZE_BANDS_1024,
        "battle_cases": hand_battle_cases(),
        "pools": pools,
        "missing_pools": missing_pools,
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
        # The on-chain verifier's fixture, from the same oracle run.
        rust_path = "../../programs/blotto_cup/src/merkle_vectors.rs"
        with open(rust_path, "w") as f:
            f.write(rust_merkle_vectors(pools))
        print(f"wrote {rust_path}")
    elif "--check" in sys.argv:
        sys.exit(check(out + "\n", rust_merkle_vectors(pools)))
    else:
        print(out)


def check(vectors_text: str, rust_text: str) -> int:
    """Compare what this oracle computes NOW with what is committed.

    Added 2026-09-12 (audit 2026-09-11, finding F-13). Until then nothing ran
    this file in CI, so the committed vectors and the generator that is
    supposed to be their independent source could drift apart in silence:
    an edit here that nobody regenerated, or an edit to vectors.json that
    this file would never produce, both passed every lane. The whole point
    of a Python oracle (CLAUDE.md, output expectations) is that the numbers
    a player is paid come from something other than the engine under test —
    which only holds while the committed numbers are the oracle's.

    Regenerates in memory, compares byte for byte, prints the differing
    lines, and returns a non-zero exit status on any difference. Paths are
    resolved from THIS FILE rather than the working directory so CI can run
    it from anywhere.
    """
    import difflib
    import os

    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, "..", "..", ".."))
    targets = [
        (os.path.join(here, "vectors.json"), vectors_text),
        (
            os.path.join(root, "programs", "blotto_cup", "src", "merkle_vectors.rs"),
            rust_text,
        ),
    ]

    bad = 0
    for path, expected in targets:
        shown = os.path.relpath(path, root)
        try:
            with open(path) as f:
                committed = f.read()
        except FileNotFoundError:
            print(f"DRIFT: {shown} does not exist; the oracle produces it")
            bad = 1
            continue
        if committed == expected:
            print(f"ok: {shown} is exactly what the oracle computes")
            continue
        bad = 1
        print(f"DRIFT: {shown} is not what the oracle computes")
        diff = list(
            difflib.unified_diff(
                committed.splitlines(),
                expected.splitlines(),
                fromfile=f"{shown} (committed)",
                tofile=f"{shown} (oracle)",
                lineterm="",
                n=1,
            )
        )
        for line in diff[:40]:
            print(f"  {line}")
        if len(diff) > 40:
            print(f"  … and {len(diff) - 40} more diff lines")
    if bad:
        print()
        print("Regenerate with `python3 fixtures/gen_vectors.py --write` from")
        print("backend/scoring/, and commit both files together. If the oracle")
        print("is what changed, that is a scoring-rule change and needs its own")
        print("review — the committed vectors are what players recompute against.")
    return bad


if __name__ == "__main__":
    main()
