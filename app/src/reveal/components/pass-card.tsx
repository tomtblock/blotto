/*
 * PassCard (UI constitution 6.6): the character pass, presented as a card
 * that fades and settles — after the consequential information, never as
 * THE moment. Rarity is conveyed by material finish (matte → brushed →
 * the top class's slow sheen, hover-driven only); no fanfare, no
 * confetti, no escalating suspense (hard constraints 3 and 6). Class is
 * cosmetic: nothing here implies advantage, and the card says so.
 *
 * Class colour has one door — classColorToken() — and this card is the
 * only surface that opens it at entry time.
 */
import { COPY } from '@/copy';
import { classColorToken } from '@/reveal/class-colour';
import type { RevealOutcome } from '@/reveal/types';
import { truncateAddress } from '@/wallet/types';

const FINISH: Record<number, 'matte' | 'brushed' | 'sheen'> = {
  0: 'matte',
  1: 'brushed',
  2: 'brushed',
  3: 'brushed',
  4: 'sheen',
};

export function PassCard({ outcome, className = '' }: { outcome: RevealOutcome; className?: string }) {
  const token = classColorToken(outcome.class);
  const finish = FINISH[outcome.class];
  return (
    <figure
      className={
        'pass-material animate-enter flex w-56 flex-col items-center gap-2 rounded-2xl border bg-raised px-6 py-7 text-center ' +
        className
      }
      data-finish={finish}
      style={
        {
          borderColor: `color-mix(in srgb, var(${token}) 55%, var(--color-line))`,
          '--finish-grade': String(outcome.class),
        } as React.CSSProperties
      }
    >
      {finish === 'sheen' ? <span aria-hidden className="pass-sheen-layer" /> : null}
      <figcaption className="text-[11px] uppercase tracking-[0.14em] text-ink-muted">
        {COPY.reveal.cardTitle}
      </figcaption>
      <div
        className="font-display text-[34px] font-bold leading-[38px]"
        style={{ color: `var(${token})` }}
      >
        {COPY.reveal.classNames[outcome.class]}
      </div>
      <div className="text-[13px] text-ink-muted">{COPY.reveal.cardSeat(outcome.entryIndex)}</div>
      <div className="font-mono text-[11px] text-ink-muted opacity-70">
        {truncateAddress(outcome.asset)}
      </div>
    </figure>
  );
}
