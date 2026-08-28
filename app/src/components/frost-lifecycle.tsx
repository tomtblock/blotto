/*
 * The FROST lifecycle diagram (UI constitution 6.9 §3): the sealing story
 * as four steps — encrypted on-device → hash on-chain → secret published →
 * checkable — teaching the seal without a paragraph. The full SUBSTANCE
 * FIXED sentence (COPY.rules.sealing) is the authority; these are its
 * step labels. Static by design on the fair-play page: it appears once
 * (the caller wraps it in a scroll-entry fade) and then rests, like sworn
 * testimony.
 */
import { COPY } from '@/copy';
import { Frost } from '@/components/ui/frost';
import { PentagonMini } from '@/components/ui/pentagon-mini';

/* An unremarkable, varied shape — never a suggestion (constraint 4). */
const EXAMPLE: readonly number[] = [23, 19, 21, 16, 21];

function HashChip() {
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-line bg-raised font-mono text-[10px] text-ink-muted">
      sha256
    </div>
  );
}

function KeyChip() {
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-brand/50 bg-raised">
      <svg viewBox="0 0 24 24" className="h-6 w-6 text-brand" aria-hidden>
        <circle cx="9" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 12h8m-3 0v3m3-3v2.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export function FrostLifecycle() {
  const steps = COPY.rules.sealingSteps;
  return (
    <ol className="grid gap-4 sm:grid-cols-4">
      {[
        <Frost key="sealed" frosted className="w-fit rounded-xl border border-line bg-raised p-2">
          <PentagonMini allocation={EXAMPLE} size={40} />
        </Frost>,
        <HashChip key="hash" />,
        <KeyChip key="key" />,
        <div key="clear" className="w-fit rounded-xl border border-line bg-raised p-2">
          <PentagonMini allocation={EXAMPLE} size={40} />
        </div>,
      ].map((glyph, i) => (
        <li key={i} className="flex flex-col items-start gap-2">
          <div className="flex items-center gap-2">
            <span className="tnum font-display text-[15px] font-bold text-brand">{i + 1}</span>
            {glyph}
          </div>
          <span className="max-w-[22ch] text-[12px] leading-4 text-ink-muted">{steps[i]}</span>
        </li>
      ))}
    </ol>
  );
}
