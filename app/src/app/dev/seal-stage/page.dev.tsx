'use client';

/*
 * /dev/seal-stage — the seal stage in every phase, without a wallet. DEV
 * ONLY: `page.dev.tsx` is a route only outside a production build
 * (next.config.ts pageExtensions), so this compiles to nothing on a deploy.
 * The controls are dummies; nothing here signs, sends or reads an allocation.
 */

import { useState } from 'react';
import { COPY } from '@/copy';
import { Button } from '@/components/ui/button';
import { SealStage, type SealKeyTone } from '../../play/seal-stage';
import type { SealStagePhase } from '../../play/seal-stage-machine';

const PHASES: SealStagePhase[] = ['made', 'armed', 'signing', 'locked', 'blending', 'done', 'failed'];

export default function SealStagePreview() {
  const [phase, setPhase] = useState<SealStagePhase>('made');
  const [tone, setTone] = useState<SealKeyTone>('action');
  const controls =
    phase === 'made' ? (
      <>
        <p className="seal-stage-line text-[13px] leading-5">{COPY.pool.decisionsFinal}</p>
        <Button size="lg" className="seal-stage-key w-full" onClick={() => setPhase('armed')}>
          {COPY.battle.seal}
        </Button>
      </>
    ) : phase === 'armed' ? (
      <>
        <p className="seal-stage-line text-[13px] font-semibold leading-5">{COPY.pool.decisionsFinal}</p>
        <Button size="lg" className="seal-stage-key w-full" onClick={() => setPhase('signing')}>
          {COPY.battle.sealConfirm}
        </Button>
        <Button intent="quiet" onClick={() => setPhase('made')}>
          {COPY.battle.sealCancel}
        </Button>
      </>
    ) : null;
  const status =
    phase === 'signing' || phase === 'locked'
      ? COPY.battle.sealing
      : phase === 'blending'
        ? COPY.reveal.confirming
        : null;
  return (
    <main id="main" className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <div className="mb-4 flex flex-wrap gap-2" data-testid="seal-stage-preview-controls">
        {PHASES.map((p) => (
          <button
            key={p}
            type="button"
            data-testid={`phase-${p}`}
            onClick={() => setPhase(p)}
            className={`rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] ${
              p === phase ? 'border-brand text-brand' : 'border-line text-ink-muted'
            }`}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          data-testid="tone-toggle"
          onClick={() => setTone((t) => (t === 'action' ? 'red' : 'action'))}
          className="rounded-full border border-line px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted"
        >
          tone: {tone}
        </button>
      </div>
      <h2 className="font-display text-[40px] leading-[42px] font-extrabold text-ink">{COPY.battle.crescendo}</h2>
      <p className="mb-5 max-w-prose text-[15px] leading-6 text-ink-muted">{COPY.battle.crescendoLine}</p>
      <SealStage
        phase={phase}
        tone={tone}
        controls={controls}
        status={status}
        busy={phase === 'signing' || phase === 'locked' || phase === 'blending'}
      />
    </main>
  );
}
