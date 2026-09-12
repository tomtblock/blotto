/**
 * `ReviewActions` over the settlement chain seam (C10). The review page
 * keys on POOL ADDRESSES (what the indexer serves); the chain seam keys on
 * pool IDS (the PDA seed) — `resolvePoolId` bridges them (deployment wires
 * it to a Pool-account read: the id is the first field after the
 * discriminator). The chain client itself is `@blotto/reveal`'s
 * `Web3Chain`, the same settlement-signed client the daemon drives — which
 * holds NO admin key, so `forfeitEscrow` (admin-signed since 2026-09-07)
 * throws here by design; see review.ts.
 *
 * The two READS (`poolState`, `entryState`) are what the state preconditions
 * run on (audit B-25, `preconditions.ts`). They come from the same client as
 * the writes on purpose: a precondition read from a different source than
 * the one the action is sent to can disagree with it, and a disagreement
 * here is an action taken against a state that has moved.
 */

import type { SettlementChain } from '../../reveal/src/chain';
import type { ReviewActions, ReviewEntryState, ReviewPoolState } from './review';

export function reviewActionsFromChain(
  chain: Pick<
    SettlementChain,
    'flagEntry' | 'clearFlag' | 'releaseEscrow' | 'forfeitEscrow' | 'getPool' | 'getEntries'
  >,
  resolvePoolId: (pool: string) => Promise<bigint>
): ReviewActions {
  return {
    async flagEntry(pool, player) {
      await chain.flagEntry(await resolvePoolId(pool), player);
    },
    async clearFlag(pool, player) {
      await chain.clearFlag(await resolvePoolId(pool), player);
    },
    async releaseEscrow(pool, player) {
      await chain.releaseEscrow(await resolvePoolId(pool), player);
    },
    async forfeitEscrow(pool, player) {
      await chain.forfeitEscrow(await resolvePoolId(pool), player);
    },
    async poolState(pool): Promise<ReviewPoolState> {
      return (await chain.getPool(await resolvePoolId(pool))).state;
    },
    async entryState(pool, player): Promise<ReviewEntryState | null> {
      // The program reads one Entry account; this client's seam serves the
      // pool's entries, so the wallet is matched here. A wallet with no seat
      // in this pool answers null, which every precondition refuses — the
      // plainest form of the finding was a reviewer key naming any wallet at
      // all.
      const entries = await chain.getEntries(await resolvePoolId(pool));
      const entry = entries.find((e) => e.player === player);
      if (entry === undefined) return null;
      return {
        flagged: entry.flagged,
        settled: entry.settled,
        forfeited: entry.forfeited,
        sanctionsHold: entry.sanctionsHold,
        escrowLamports: entry.escrowLamports,
      };
    },
  };
}
