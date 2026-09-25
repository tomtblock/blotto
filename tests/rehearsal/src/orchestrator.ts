/**
 * The pool-cycle orchestrator: one function that fills a pool with a
 * strategy population, seals every entry, and settles it through the REAL
 * crank and the REAL detection pipeline, over a `FakeChain`.
 *
 * WHAT IT IS NOT (audit 2026-09-11, G-16). It is not chain-agnostic. This
 * header used to say "over whatever `SettlementChain` it is handed", and
 * that "with `Web3Chain` and the Phase 5 credentials it is the devnet
 * rehearsal" — neither of which its own signature permits: `runOfflinePool`
 * takes no chain, constructs `new FakeChain()` itself, and returns that
 * concrete type so its callers can read `chain.paid` and `chain.escrowed`.
 * The devnet rehearsal is a different thing entirely: the DAEMON over
 * `Web3Chain` against a real cluster, described in docs/devnet-rehearsal.md
 * and driven by its runbook, not by this file.
 *
 * So what this is: the OFFLINE rehearsal that runs in CI — 20 pools, the
 * refund fork, conservation to the lamport — and the harness the
 * skill-evidence study (D-A2) drives.
 */

import { createHash } from 'crypto';
import {
  LocalCustody,
  MemoryCiphertextStore,
  encodePayload,
  seal,
} from '../../../backend/sealing/src';
import { battlesHash, potForTier } from '../../../backend/scoring/src';
import { base58Encode } from '../../../backend/_shared/src/blotto-events';
import {
  FakeChain,
  MemoryPublisher,
  crankPool,
  type FakeEntry,
  type CrankOutcome,
  type RevealedForDetection,
} from '../../../backend/reveal/src';
import { detectPool, type DetectionReport } from '../../../backend/detection/src';
import { poolPopulation, type GeneratedEntrant } from './strategies';

const sha = (s: string) => new Uint8Array(createHash('sha256').update(s).digest());

export interface OfflinePoolRun {
  poolId: bigint;
  outcome: CrankOutcome;
  chain: FakeChain;
  publisher: MemoryPublisher;
  population: GeneratedEntrant[];
  players: string[];
  /**
   * Every detection report the run produced, in the order the crank asked
   * for them (one per pool under the current crank, so one entry). Empty
   * when `detect: false`.
   *
   * Returned because otherwise the rehearsal cannot tell "the signals fired
   * and nothing was acted on" — SHADOW MODE, which is what D-E9 ruled and
   * what production does — apart from "the signals never fired at all"
   * (audit 2026-09-11, G-13). Those two look identical from the outside and
   * only one of them is the system working.
   */
  detection: DetectionReport[];
}

export interface OfflinePoolOptions {
  /** Override the entrant population (default: `poolPopulation(poolSeed)`). */
  population?: GeneratedEntrant[];
  /**
   * Run the detection pipeline (default true). The skill-evidence study
   * (D-A2) runs with it OFF: identical sets inside a strategy class are the
   * study's own construction rather than collusion, and there is nothing for
   * the study to learn from reports about them.
   *
   * Turning it off changes no OUTCOME — under ruling D-E9 detection flags
   * nobody either way (see `detect` below) — only whether the reports are
   * computed and returned.
   */
  detect?: boolean;
}

/** Build, fill and settle one offline pool end to end. */
export async function runOfflinePool(
  poolSeed: number,
  options: OfflinePoolOptions = {}
): Promise<OfflinePoolRun> {
  const poolId = BigInt(poolSeed);
  const chain = new FakeChain();
  const custody = new LocalCustody(async (id) => (await chain.getPool(id)).state !== 'Open');
  const store = new MemoryCiphertextStore();
  const publisher = new MemoryPublisher();

  const { publicKey } = await custody.createPoolKey(poolId);
  const population = options.population ?? poolPopulation(poolSeed);
  const players: string[] = [];
  const entries: FakeEntry[] = [];

  population.forEach((entrant, i) => {
    const player = base58Encode(sha(`player:${poolSeed}:${i}`));
    players.push(player);
    const payload = {
      battles: entrant.battles as never,
      salt: sha(`salt:${poolSeed}:${i}`),
      timingsMs: entrant.timingsMs,
      deviceHash: sha(`device:${poolSeed}:${i}`),
    };
    entries.push({
      player,
      index: i,
      battlesHash: Buffer.from(battlesHash(payload.battles, payload.salt)).toString('hex'),
      flagged: false,
      refunded: false,
      settled: false,
      forfeited: false,
    });
    void store.put(poolId, player, seal(encodePayload(payload), publicKey));
  });

  chain.pools.set(poolId.toString(), {
    poolId,
    tier: 0,
    state: 'Sealed',
    resultsRootHex: null,
    vrfCommitted: true,
    entryLamports: 100_000_000n,
    potLamports: potForTier(0),
    fillDeadline: 0n,
    secretRevealed: false,
    resultsCommitted: false,
    paidMask: 0n,
    payouts: [],
    // The rehearsal plays easy until the hard strategies land (Phase B).
    mode: 0,
    // The real field size: a pool seals at 64, or at its floor..63 when its
    // deadline passes (D-E4). The crank commits over `entrants`, so a
    // population smaller than 64 rehearses the minimum-field path.
    entrants: population.length,
  });
  chain.entries.set(poolId.toString(), entries);

  // SHADOW MODE, the way production runs it (audit 2026-09-11, G-13).
  //
  // This hook used to return `report.hardBlocks`, so the flagship offline
  // rehearsal auto-flagged and escrowed on a detection signal. Production
  // does not and has never been permitted to: `backend/reveal/src/main.ts`
  // computes the same report, persists it for the reviewer, and returns an
  // EMPTY list, because under founder ruling D-E9 (2026-09-12) a flag is a
  // reviewer's signed decision and never the daemon's. A rehearsal that
  // rehearses a policy the product does not have proves the wrong thing —
  // and, worse, it makes the one shadow-mode assertion in the suite
  // (`rehearsal.spec.ts`) pass for the wrong reason.
  //
  // The reports are returned instead, so the rehearsal can assert BOTH
  // halves of shadow mode: the signals fired, and nothing acted on them.
  const detection: DetectionReport[] = [];
  const detect =
    options.detect === false
      ? undefined
      : async (id: bigint, revealed: RevealedForDetection[]) => {
          detection.push(
            detectPool(
              id.toString(),
              revealed
                .filter((e) => e.battles !== null)
                .map((e) => ({
                  player: e.player,
                  index: e.index,
                  battles: e.battles as number[][],
                  timingsMs: e.timingsMs ?? [],
                  deviceHash: e.deviceHash ?? '',
                  scoreHalf: e.scoreHalf,
                })),
              { fullEscrowTier: false }
            )
          );
          return [];
        };

  const outcome = await crankPool(
    { chain, custody, ciphertexts: store, publisher, detect },
    poolId
  );

  return { poolId, outcome, chain, publisher, population, players, detection };
}
