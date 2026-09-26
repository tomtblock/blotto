/**
 * The per-wallet allocation ledger — what each wallet set, and the chain's own
 * record of it (manual §5.6, §11.5).
 *
 * WHY THIS EXISTS AS ITS OWN FILE. The plan records a generator and a seed per
 * seat, which is reproducible but not readable: nobody reviewing the report can
 * see "this wallet set these seven allocations" without running code. This
 * renders the seeds into the actual numbers and puts the on-chain evidence
 * beside them.
 *
 * IT ADDS NO PREDICTION. Every allocation here is derived from the seed already
 * frozen in `<test>.plan.json`; running this before or after entry produces the
 * same numbers. That is why it is safe to generate after the plan's freeze.
 *
 * THE SEALING CONSTRAINT, which is the whole shape of this file. An allocation
 * is sealed at entry: the only thing on chain is
 * `battles_hash = sha256(battles ‖ salt)`, and the salt is random per entry and
 * secret until the pool's X25519 secret is revealed. So each seat has one of
 * three honest states:
 *
 *   PENDING    no entry yet — intended allocation only
 *   COMMITTED  the entry landed; the chain holds a hash nobody can yet open
 *   VERIFIED   the pool revealed; the published battles and salt recompute to
 *              the hash the chain recorded at entry
 *
 * A salt is NEVER printed before its pool reveals. Publishing one early would
 * let a guess at that entry's allocation be confirmed, which is the sealing
 * property gone.
 *
 * Run (from battle-test/):
 *   npx ts-node --transpile-only --compiler-options \
 *     '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/allocations.ts --test T1
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { generateEntrant } from '../../tests/rehearsal/src/strategies';

const REG = resolve(__dirname, '..', 'registry');
const STAT_NAMES = ['Strength', 'Speed', 'Heart', 'Wit', 'Durability'] as const;
const EXPLORER = 'https://explorer.solana.com';

const flag = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const sol = (l: bigint): string => {
  const neg = l < 0n;
  const a = neg ? -l : l;
  return `${neg ? '-' : ''}${a / 1_000_000_000n}.${(a % 1_000_000_000n).toString().padStart(9, '0')}`;
};

const short = (s: string | null | undefined, head = 8): string =>
  !s ? '—' : s.length <= head * 2 + 1 ? s : `${s.slice(0, head)}…${s.slice(-4)}`;

interface PlanSeat {
  wallet: string; route?: string; role?: string; generator?: string; seed?: number;
  battles?: number[][]; target?: number[][]; tolerance?: string;
  expectedRefundLamports?: string; expectedLamports?: string;
}
interface Plan {
  test: string; title?: string; entryLamports?: string;
  expectations?: { terminalState?: string; entrants?: number };
  seats: PlanSeat[];
}
interface ActualSeat {
  seat: number; wallet: string; route: string; address: string; battlesHash: string;
  passAsset: string; refunded: boolean; flagged: boolean;
  registerSig: string | null; slot: number | null; balanceAfter: string | null;
  revealedBattles?: number[][]; salt?: string;
}
interface Actual {
  test: string; poolId: string; poolPda: string; terminalState: string;
  entrants: number; entryLamports: string; secretRevealed: boolean;
  seats: ActualSeat[];
}

/** The seven battle sets this seat's frozen seed produces, or its declared set. */
function intendedBattles(seat: PlanSeat): number[][] | null {
  if (seat.battles) return seat.battles;
  if (seat.target) return seat.target;
  if (seat.seed === undefined) return null; // a UI seat the founder plays by hand
  return generateEntrant('random', seat.seed).battles;
}

function grid(battles: number[][]): string[] {
  const out: string[] = [];
  out.push(`     ${'battle'.padEnd(8)} ${STAT_NAMES.map((s) => s.padStart(9)).join(' ')}`);
  battles.forEach((b, i) => {
    out.push(`     ${String(i + 1).padEnd(8)} ${b.map((v) => String(v).padStart(9)).join(' ')}`);
  });
  const sums = new Set(battles.map((b) => b.reduce((a, v) => a + v, 0)));
  // UNSORTED, exactly as `backend/detection/src/signals.ts` measures it
  // (`b.join(',')`). Sorting was the bug: a rotating wall or pole is one sorted
  // shape however far it rotates, so this read "1 distinct shapes" for a set
  // with seven genuinely different rows. The same mistake was found and fixed
  // in `validate-plan.ts` on 2026-09-16 and survived here until T4's table was
  // read closely — fixed 2026-09-17.
  const shapes = new Set(battles.map((b) => b.join(',')));
  out.push(
    `     ${'—'.padEnd(8)} every battle sums to ${[...sums].join('/')}, ${shapes.size} distinct shapes`
  );
  return out;
}

function main(): void {
  const test = flag('test');
  if (!test) throw new Error('--test <T1> is required');

  const planPath = resolve(REG, `${test}.plan.json`);
  if (!existsSync(planPath)) throw new Error(`no frozen plan at ${planPath}`);
  const plan = JSON.parse(readFileSync(planPath, 'utf8')) as Plan;

  const actualPath = resolve(REG, `${test}.actual.json`);
  const actual: Actual | null = existsSync(actualPath)
    ? (JSON.parse(readFileSync(actualPath, 'utf8')) as Actual)
    : null;
  const bySeat = new Map((actual?.seats ?? []).map((s) => [s.wallet, s]));
  const revealed = Boolean(actual?.secretRevealed);
  // A pool that refunded is finished, and a finished pool that has not
  // revealed never will: `crankPool` returns for a `Refunding` pool
  // (crank.ts:179-188) and no-ops for a `Closed` one (:189-192), both before
  // `assembleBundle`, which holds the only production call to
  // `revealPoolSecret` (crank.ts:395-397). So COMMITTED is this table's
  // terminal state for a refunded pool, not a waiting one, and it says so
  // rather than leaving twelve seats looking unfinished. docs/testing/TESTING-REPORT.md.
  const neverReveals = !revealed && actual?.terminalState === 'Closed';

  // Addresses come from the roster, so a wallet is identifiable before it has
  // entered anything — the founder should be able to look one up at any point,
  // not only after a seat lands.
  const roster = JSON.parse(readFileSync(resolve(REG, 'wallets.json'), 'utf8')) as {
    wallets: { id: string; address: string }[];
  };
  const addressOf = new Map(roster.wallets.map((w) => [w.id, w.address]));

  const freezePath = resolve(REG, `${test}.freeze.json`);
  const freeze = existsSync(freezePath)
    ? (JSON.parse(readFileSync(freezePath, 'utf8')) as { mergedAt: string; pullRequest: number; planSha256: string })
    : null;

  const L: string[] = [];
  L.push(`# ${test} — every wallet's allocation, and the chain's record of it`);
  L.push('');
  L.push(plan.title ? `**${plan.title}**` : '');
  L.push('');
  L.push(
    'Each wallet sets seven allocations of five stats, each summing to exactly 100, in the fixed ' +
    'order Strength · Speed · Heart · Wit · Durability.'
  );
  L.push('');
  if (freeze) {
    L.push(
      `The allocations below are **derived from the seeds frozen in \`${test}.plan.json\`** ` +
      `(PR ${freeze.pullRequest}, merged ${freeze.mergedAt}, plan sha256 \`${short(freeze.planSha256, 12)}\`). ` +
      'This file adds no prediction — it renders one that was already fixed, so it reads the same ' +
      'whenever it is generated.'
    );
  } else {
    L.push(`Derived from the seeds in \`${test}.plan.json\`. No freeze record found.`);
  }
  L.push('');
  L.push('## How to read the state column');
  L.push('');
  L.push('| State | Meaning |');
  L.push('|---|---|');
  L.push('| `PENDING` | no entry has landed yet; the intended allocation only |');
  L.push('| `COMMITTED` | the entry landed and the chain holds `sha256(battles ‖ salt)`, which nobody can open yet |');
  if (neverReveals) {
    L.push(
      '| | **For this pool `COMMITTED` is terminal.** It refunded, and a refunded pool never ' +
      'reveals its secret on this tree — so these hashes stay sealed and no seat here can reach ' +
      '`VERIFIED`. The finding, with its evidence, is docs/testing/TESTING-REPORT.md. |'
    );
  }
  L.push('| `VERIFIED` | the pool revealed its secret; the published battles and salt recompute to the hash the chain recorded at entry |');
  L.push('');
  L.push(
    'A salt is never printed before its pool reveals: publishing one early would let a guess at ' +
    "that entry's allocation be confirmed, which is the sealing property gone."
  );
  L.push('');
  if (actual) {
    L.push(
      `Pool ${actual.poolId} · \`${actual.poolPda}\` · ${actual.terminalState} · ` +
      `${actual.entrants} entrants · [pool on the explorer](${EXPLORER}/address/${actual.poolPda}?cluster=devnet)`
    );
  } else {
    L.push('_No entry has landed yet. Evidence columns fill in as the pool runs._');
  }
  L.push('');
  L.push('---');
  L.push('');

  let pending = 0, committed = 0, verified = 0;

  for (const seat of plan.seats) {
    const got = bySeat.get(seat.wallet);
    const intended = intendedBattles(seat);

    let state: 'PENDING' | 'COMMITTED' | 'VERIFIED';
    if (!got) { state = 'PENDING'; pending++; }
    else if (revealed && got.revealedBattles) { state = 'VERIFIED'; verified++; }
    else { state = 'COMMITTED'; committed++; }

    const head =
      `### ${seat.wallet}` +
      `${got ? `  ·  seat ${got.seat}` : ''}` +
      `  ·  ${seat.role ?? 'unassigned'}` +
      `  ·  ${seat.route ?? 'direct'}  ·  **${state}**`;
    L.push(head);
    L.push('');

    if (intended) {
      L.push(`Intended, from \`${seat.generator ?? 'plan'}\`${seat.seed !== undefined ? ` seed ${seat.seed}` : ''}:`);
      L.push('```');
      L.push(...grid(intended));
      L.push('```');
    } else {
      L.push(
        `Played by hand in the browser${seat.tolerance ? ` — ${seat.tolerance}` : ''}. ` +
        'The allocations are whatever the founder locked, and are read from the published bundle ' +
        'at reveal rather than predicted here.'
      );
    }
    L.push('');

    if (got?.revealedBattles) {
      L.push('Revealed by the published bundle:');
      L.push('```');
      L.push(...grid(got.revealedBattles));
      L.push('```');
      L.push('');
    }

    L.push('| evidence | value |');
    L.push('|---|---|');
    const address = got?.address ?? addressOf.get(seat.wallet);
    L.push(
      `| address | ${address ? `[\`${address}\`](${EXPLORER}/address/${address}?cluster=devnet)` : '—'} |`
    );
    L.push(
      `| battles hash on chain | ${got ? `\`${short(got.battlesHash, 12)}\`` : '— (no entry yet)'} |`
    );
    if (state === 'VERIFIED') {
      L.push('| recomputed | matches the hash committed at entry |');
    } else if (state === 'COMMITTED') {
      L.push(
        neverReveals
          ? '| recomputed | **never** — this pool refunded and its secret was never revealed (docs/testing/TESTING-REPORT.md) |'
          : '| recomputed | not yet — the pool has not revealed its secret |'
      );
    }
    if (got?.scoreHalf !== undefined) {
      L.push(`| score | ${got.scoreHalf} half-points · ${got.zones} stats won |`);
    }
    L.push(
      `| register | ${got?.registerSig ? `[\`${short(got.registerSig)}\`](${EXPLORER}/tx/${got.registerSig}?cluster=devnet)${got.slot ? ` · slot ${got.slot}` : ''}` : '—'} |`
    );
    L.push(
      `| pass asset | ${got?.passAsset ? `[\`${short(got.passAsset)}\`](${EXPLORER}/address/${got.passAsset}?cluster=devnet)` : '—'} |`
    );
    if (got) {
      const expected = seat.expectedRefundLamports ?? seat.expectedLamports ?? '0';
      L.push(
        `| outcome | ${
          got.refunded
            ? `refunded ${sol(BigInt(expected))} SOL`
            : got.flagged
              ? 'flagged, held in escrow'
              : got.amountLamports !== undefined
                ? BigInt(got.amountLamports) > 0n
                  ? `**PAID ${sol(BigInt(got.amountLamports))} SOL** — rank ${got.rank} of ${plan.seats.length}`
                  : `not paid — rank ${got.rank} of ${plan.seats.length}`
                : 'not yet settled'
        } |`
      );
      if (got.balanceAfter) L.push(`| balance after | ${sol(BigInt(got.balanceAfter))} SOL |`);
    }
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push(`${plan.seats.length} seats — ${pending} PENDING · ${committed} COMMITTED · ${verified} VERIFIED`);
  L.push('');

  const out = resolve(REG, `${test}.allocations.md`);
  writeFileSync(out, L.filter((l) => l !== undefined).join('\n') + '\n');
  console.log(
    `wrote ${out}\n${plan.seats.length} seats — ${pending} pending, ${committed} committed, ${verified} verified`
  );
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
