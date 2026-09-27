'use client';

/*
 * The signing hold (V2, founder 2026-09-27): from the one "Confirm, Seal &
 * Submit" press until the network answers, the whole viewport is this —
 * a graphic and one sentence, over the board's record. No hash, no
 * signature, nothing a player could be asked to act on beyond the wallet's
 * own prompts. It replaced the seal-stage scene (the conveyor and the
 * blender), which is deleted.
 *
 * The three steps are the ones the page can actually observe (observed-
 * signer.ts): the wallet has not yet signed the sealed entry, has signed it
 * but not the payment, or has signed both and the chain is confirming.
 */

import { COPY } from '@/copy';
import { AmbientClip } from '@/components/ui/ambient-clip';

export type SignStep = 'seal' | 'pay' | 'network';

const CLIP = [{ mp4: '/motion/v2/sign.mp4', webm: '/motion/v2/sign.webm' }];
const POSTER = '/motion/v2/sign.jpg';

export function SigningOverlay({ step }: { step: SignStep }) {
  const r = COPY.reveal;
  const line = step === 'seal' ? r.signingSeal : step === 'pay' ? r.signingPay : r.confirming;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="signing-title"
      data-testid="signing-overlay"
      data-step={step}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-game-base/85 p-4 backdrop-blur-sm"
    >
      <div className="animate-rise flex w-full max-w-sm flex-col items-center gap-5 text-center">
        <div className="relative aspect-[4/5] w-full max-h-[52vh] overflow-hidden rounded-[28px] border-[3px] border-brand-cream bg-game-base shadow-[0_18px_50px_rgba(42,16,48,0.45)]">
          <AmbientClip tiers={CLIP} poster={POSTER} preload="auto" className="absolute inset-0 h-full w-full object-cover" />
        </div>
        <h2 id="signing-title" className="font-display text-[32px] leading-9 font-extrabold text-brand-cream">
          {r.signingTitle}
        </h2>
        <p aria-live="polite" className="flex items-center justify-center gap-3 text-[15px] leading-6 text-brand-cream/90">
          <span
            aria-hidden="true"
            className="inline-block h-4 w-4 shrink-0 animate-[rotate-once_1s_linear_infinite] rounded-full border-2 border-brand-cream border-t-transparent"
          />
          {line}
        </p>
      </div>
    </div>
  );
}
