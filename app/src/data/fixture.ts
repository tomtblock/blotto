/*
 * Deterministic fixture data — what the pages render before an indexer URL
 * is configured. Shaped exactly like the read API's rows; the pool ids all
 * begin `F1XTURE`, which is the watermark.
 *
 * The rows come from `scenarios.ts`, which carries one pool per lifecycle
 * state so that every page can be reached without a live tournament. This
 * module is only the adapter: it answers the `IndexerApi` questions by
 * looking the pool up in that catalogue.
 *
 * `listPools()` deliberately returns EVERY scenario rather than just the open
 * one — the pools index is itself a screen that needs to show a mixed list,
 * and a one-row list is not a design of anything.
 */

import type { IndexerApi } from './types';
import {
  FIXTURE_CAREER,
  FIXTURE_PLAYER,
  FIXTURE_PROFILE,
  FIXTURE_TREASURY,
  SCENARIOS,
  SCENARIO_BY_POOL,
  fixturePoolTypes,
} from './scenarios';

export const FIXTURE_API: IndexerApi = {
  async listPools() {
    return SCENARIOS.map((s) => s.summary);
  },
  async getPool(pool) {
    return SCENARIO_BY_POOL.get(pool)?.summary ?? null;
  },
  async getEntries(pool) {
    return SCENARIO_BY_POOL.get(pool)?.entries ?? [];
  },
  async getResults(pool) {
    return SCENARIO_BY_POOL.get(pool)?.results ?? [];
  },
  async getPayouts(pool) {
    return SCENARIO_BY_POOL.get(pool)?.payouts ?? [];
  },
  async getProfile(player) {
    // Any wallet gets the fixture career: the preview is driven by the test
    // signer, whose address is whatever keypair the harness injected, and a
    // profile page that renders empty for it would show nothing to design.
    return player === FIXTURE_PLAYER ? FIXTURE_PROFILE : { ...FIXTURE_PROFILE, player };
  },
  async getCareer() {
    return FIXTURE_CAREER;
  },
  async getPoolTypes() {
    // D-E19: the devnet launch posture — both boards × the four sizes at
    // tier 0, every one live — so the landing's size toggle renders what
    // production renders. The clock is the fixture's own (it IS the server).
    return {
      server_time: Math.floor(Date.now() / 1000),
      source: 'chain' as const,
      pool_types: fixturePoolTypes(),
    };
  },
  async getTreasury() {
    return FIXTURE_TREASURY;
  },
  async getLeaderboard(pool) {
    // E3: only scenarios whose bundle "verified" carry one — the read API's
    // fail-closed 404 renders as the archive section simply not appearing.
    // D-E8: "verified" covers the committed leaf (player, rank, amount) and
    // nothing more; the scenario rows carry `committed_fields` and their
    // recomputed scores exactly as the read API serves them.
    return SCENARIO_BY_POOL.get(pool)?.leaderboard ?? null;
  },
};
