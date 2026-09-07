/**
 * The pool-cycle orchestrator: one function that fills a pool with a
 * strategy population, seals every entry, and settles it through the REAL
 * crank + detection pipeline — over whatever `SettlementChain` it is handed.
 *
 * With `FakeChain` this is the OFFLINE rehearsal (runs in CI: 20 pools,
 * refund path, conservation checks). With `Web3Chain` and the Phase 5
 * credentials it is the devnet rehearsal — same orchestration, real cluster
 * (docs/devnet-rehearsal.md is the runbook).
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
  type ChainEntryView,
  type CrankOutcome,
  type RevealedForDetection,
} from '../../../backend/reveal/src';
import { detectPool } from '../../../backend/detection/src';
import { poolPopulation, type GeneratedEntrant } from './strategies';

const sha = (s: string) => new Uint8Array(createHash('sha256').update(s).digest());

export interface OfflinePoolRun {
  poolId: bigint;
  outcome: CrankOutcome;
  chain: FakeChain;
  publisher: MemoryPublisher;
  population: GeneratedEntrant[];
  players: string[];
}

export interface OfflinePoolOptions {
  /** Override the entrant population (default: `poolPopulation(poolSeed)`). */
  population?: GeneratedEntrant[];
  /**
   * Wire the detection pipeline (default true). The skill-evidence study
   * (D-A2) runs with detection OFF: identical sets inside a strategy class
   * are the study's own construction, not collusion, and flag-escrowing
   * them would distort the outcome statistics being measured.
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
  const entries: ChainEntryView[] = [];

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
    vrfCommitted: true,
    entryLamports: 100_000_000n,
    potLamports: potForTier(0),
    fillDeadline: 0n,
    secretRevealed: false,
    resultsCommitted: false,
    paidMask: 0n,
    payouts: [],
    // The real field size: a pool seals at 64, or at 52..63 when its
    // deadline passes (D-E4). The crank commits over `entrants`, so a
    // population smaller than 64 rehearses the minimum-field path.
    entrants: population.length,
  });
  chain.entries.set(poolId.toString(), entries);

  const detect =
    options.detect === false
      ? undefined
      : async (id: bigint, revealed: RevealedForDetection[]) => {
          const report = detectPool(
            id.toString(),
            revealed
              .filter((e) => e.battles !== null)
              .map((e) => ({
                player: e.player,
                index: e.index,
                battles: e.battles as number[][],
                timingsMs: e.timingsMs ?? [],
                deviceHash: e.deviceHash ?? '',
                ipHash: `ip:${e.player}`,
                scoreHalf: e.scoreHalf,
              })),
            { fullEscrowTier: false }
          );
          return report.hardBlocks;
        };

  const outcome = await crankPool(
    { chain, custody, ciphertexts: store, publisher, detect },
    poolId
  );

  return { poolId, outcome, chain, publisher, population, players };
}
