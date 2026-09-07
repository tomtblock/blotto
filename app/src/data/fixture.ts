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
  FIXTURE_RIVALS,
  FIXTURE_TREASURY,
  SCENARIOS,
  SCENARIO_BY_POOL,
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
  async getRivals() {
    return FIXTURE_RIVALS;
  },
  async getSealedEntries(pool) {
    // The read API serves these only once the pool secret is on-chain; the
    // scenarios encode that by carrying rows only where `secret` is set.
    return SCENARIO_BY_POOL.get(pool)?.sealedEntries ?? [];
  },
  async getTiers() {
    // The fixture has no settled tier to count toward; the clock is the
    // fixture's own (it IS the server here).
    return { server_time: String(Math.floor(Date.now() / 1000)), tiers: [] };
  },
  async getTreasury() {
    return FIXTURE_TREASURY;
  },
  async getLeaderboard(pool) {
    // E3: only scenarios whose bundle "verified" carry one — the read API's
    // fail-closed 404 renders as the archive section simply not appearing.
    return SCENARIO_BY_POOL.get(pool)?.leaderboard ?? null;
  },
};
