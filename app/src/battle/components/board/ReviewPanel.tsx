'use client';

/*
 * The review: the entry as a 7 × 5 table with a Σ column, the check line,
 * the buzzer note when the clock ended it, and Back to board while time
 * remains; the one seal key is the flow's (BoardFlow). No JSON, no export,
 * no replay here: a real entry has one forward action and one back (plan §2).
 */

import { STAT_NAMES } from '@/battle/allocation';
import type { BoardReviewState } from '@/battle/board/machine';
import { EASY_PER_FIELD, HARD_TOTAL } from '@/battle/board/mode';
import { formatClock } from '@/battle/run-clock';
import { COPY } from '@/copy';
import { ModeBadge } from './hud';

const ABBR = ['STR', 'SPD', 'HRT', 'WIT', 'DUR'] as const;

export function ReviewPanel({ review, onResume }: { review: BoardReviewState; onResume?: () => void }) {
  const total = review.battles.reduce((a, row) => a + row.reduce((x, y) => x + y, 0), 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-[40px] leading-[42px] font-extrabold text-ink">{COPY.board.reviewTitle}</h2>
        <ModeBadge mode={review.mode} />
      </div>
      <p className="text-[14px] leading-5 text-ink-muted">
        {review.expired ? COPY.board.reviewExpired : COPY.board.reviewSubmitted(formatClock(review.remainingMs))}
      </p>
      <p className="text-[13px] font-semibold leading-5 text-ink">
        ✓ {review.mode === 'easy' ? COPY.board.checkEasy(EASY_PER_FIELD) : COPY.board.checkHard(HARD_TOTAL)}
      </p>
      <div className="overflow-x-auto">
        <table className="bb-review-table" aria-label={COPY.board.reviewTableLabel}>
          <thead>
            <tr>
              <th scope="col">{COPY.board.reviewBattle}</th>
              {ABBR.map((a, z) => (
                <th key={a} scope="col" abbr={STAT_NAMES[z]} title={STAT_NAMES[z]}>
                  {a}
                </th>
              ))}
              <th scope="col">Σ</th>
            </tr>
          </thead>
          <tbody>
            {review.battles.map((row, f) => (
              <tr key={f} className={review.locked[f] ? 'bb-row--locked' : undefined}>
                <td>{COPY.board.field(f + 1)}</td>
                {row.map((v, z) => (
                  <td key={z}>{v}</td>
                ))}
                <td>{row.reduce((a, b) => a + b, 0)}</td>
              </tr>
            ))}
            {review.mode === 'hard' && (
              <tr>
                <td>{COPY.board.reviewTotal}</td>
                <td colSpan={5} />
                <td>{total}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {onResume && !review.expired && review.remainingMs > 0 && (
        <button type="button" className="bb-btn self-start" onClick={onResume} data-testid="board-resume">
          {COPY.board.backToBoard}
        </button>
      )}
    </div>
  );
}
