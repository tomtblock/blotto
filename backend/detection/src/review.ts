/**
 * The review decision log (roadmap 4.4): every clear/forfeit decision on a
 * flagged entry is recorded — who decided, when, why — and applied through
 * the settlement seam. The review PAGE renders this; the criteria the
 * decisions cite are published (rules page, Phase 6 copy).
 *
 * The chain actions themselves (`flag_entry`, `clear_flag`,
 * `forfeit_escrow`, `release_escrow`) are the settlement signer's; the seam
 * here is deliberately narrow — a review backend holds no other authority.
 */

export interface ReviewActions {
  flagEntry(pool: string, player: string): Promise<void>;
  clearFlag(pool: string, player: string): Promise<void>;
  releaseEscrow(pool: string, player: string): Promise<void>;
  forfeitEscrow(pool: string, player: string): Promise<void>;
}

export interface Decision {
  pool: string;
  player: string;
  action: 'flag' | 'clear' | 'release' | 'forfeit';
  /** Which published criterion the decision cites. */
  criterion: string;
  decidedBy: string;
  decidedAt: string; // ISO
}

export interface DecisionLog {
  append(d: Decision): Promise<void>;
  list(pool: string): Promise<Decision[]>;
}

export class MemoryDecisionLog implements DecisionLog {
  private rows: Decision[] = [];
  async append(d: Decision): Promise<void> {
    this.rows.push({ ...d });
  }
  async list(pool: string): Promise<Decision[]> {
    return this.rows.filter((r) => r.pool === pool).map((r) => ({ ...r }));
  }
}

/** Apply one review decision: chain action + log row, in that order. */
export async function decide(
  actions: ReviewActions,
  log: DecisionLog,
  d: Decision
): Promise<void> {
  switch (d.action) {
    case 'flag':
      await actions.flagEntry(d.pool, d.player);
      break;
    case 'clear':
      await actions.clearFlag(d.pool, d.player);
      break;
    case 'release':
      await actions.releaseEscrow(d.pool, d.player);
      break;
    case 'forfeit':
      await actions.forfeitEscrow(d.pool, d.player);
      break;
  }
  await log.append(d);
}
