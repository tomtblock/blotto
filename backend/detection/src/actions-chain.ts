/**
 * `ReviewActions` over the settlement chain seam (C10). The review page
 * keys on POOL ADDRESSES (what the indexer serves); the chain seam keys on
 * pool IDS (the PDA seed) — `resolvePoolId` bridges them (deployment wires
 * it to a Pool-account read: the id is the first field after the
 * discriminator). The chain client itself is `@blotto/reveal`'s
 * `Web3Chain`, the same settlement-signed client the daemon drives — which
 * holds NO admin key, so `forfeitEscrow` (admin-signed since 2026-09-07)
 * throws here by design; see review.ts.
 */

import type { SettlementChain } from '../../reveal/src/chain';
import type { ReviewActions } from './review';

export function reviewActionsFromChain(
  chain: Pick<SettlementChain, 'flagEntry' | 'clearFlag' | 'releaseEscrow' | 'forfeitEscrow'>,
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
  };
}
