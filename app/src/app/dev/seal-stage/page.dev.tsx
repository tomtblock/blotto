'use client';

/*
 * /dev/seal-stage — the seal stage in every phase, without a wallet. DEV
 * ONLY: `page.dev.tsx` is a route only outside a production build
 * (next.config.ts pageExtensions), so this compiles to nothing on a deploy.
 * The controls are dummies; nothing here signs, sends or reads an allocation.
 * Round three (§D): a stand-in review is portalled into the stage's widget
 * the way BattleFlow does it, so the layout can be seen without a run.
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { COPY } from '@/copy';
import { Button } from '@/components/ui/button';
import { SevenTiles } from '@/battle/components/seven-tiles';
import { EVEN_SPLIT } from '@/battle/allocation';
import { SealStage, type SealKeyTone } from '../../play/seal-stage';
import { EnteredPanel } from '../../play/entered-panel';
import type { SealStagePhase } from '../../play/seal-stage-machine';

const PHASES: SealStagePhase[] = ['made', 'armed', 'signing', 'locked', 'blending', 'done', 'failed'];
const DEMO_TILES = Array.from({ length: 7 }, () => ({ allocation: EVEN_SPLIT, stillUrl: null }));

function DemoReview({ expired }: { expired: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-[30px] leading-[32px] font-extrabold text-ink">{COPY.battle.crescendo}</h2>
        <p className="text-[15px] leading-6 text-ink-muted">{COPY.battle.crescendoLine}</p>
      </div>
      {expired && <p className="text-[14px] leading-5 text-ink-muted">{COPY.battle.expiredNote}</p>}
      <SevenTiles locked={DEMO_TILES} />
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static asset at a fixed size */}
        <img src="/candy/lock.webp" alt="" aria-hidden width={64} height={64} className="h-16 w-16 shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-[14px] leading-5 text-ink">{COPY.battle.sealWhat}</p>
          <p className="text-[13px] leading-5 text-ink-muted">{COPY.battle.sealAfter}</p>
        </div>
      </div>
    </div>
  );
}

export default function SealStagePreview() {
  const [phase, setPhase] = useState<SealStagePhase>('made');
  const [tone, setTone] = useState<SealKeyTone>('action');
  const [expired, setExpired] = useState(false);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const inReview = phase === 'made' || phase === 'armed';
  const controls =
    phase === 'made' ? (
      <>
        <p className="seal-stage-line text-[15px] leading-6">{COPY.pool.decisionsFinal}</p>
        <Button size="lg" className="seal-stage-key" onClick={() => setPhase('armed')}>
          {COPY.battle.seal}
        </Button>
      </>
    ) : phase === 'armed' ? (
      <>
        <p className="seal-stage-line text-[15px] leading-6">{COPY.pool.decisionsFinal}</p>
        <div className="seal-stage-keys">
          <Button intent="quiet" className="seal-stage-back" onClick={() => setPhase('made')}>
            {COPY.battle.sealCancel}
          </Button>
          <Button size="lg" className="seal-stage-key" onClick={() => setPhase('signing')}>
            {COPY.battle.sealConfirm}
          </Button>
        </div>
      </>
    ) : null;
  const status =
    phase === 'signing' || phase === 'locked'
      ? COPY.battle.sealing
      : phase === 'blending'
        ? COPY.reveal.confirming
        : null;
  return (
    <div className="play-field flex-1 bg-brand-pink">
    <main id="main" className="mx-auto w-full max-w-xl px-4 py-8">
      {/* Above the stage in z-order: the stage rises over the column's top padding. */}
      <div className="relative z-10 mb-4 flex flex-wrap gap-2 pb-8" data-testid="seal-stage-preview-controls">
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
        <button
          type="button"
          data-testid="expired-toggle"
          onClick={() => setExpired((e) => !e)}
          className="rounded-full border border-line px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted"
        >
          expired: {expired ? 'yes' : 'no'}
        </button>
      </div>
      <SealStage
        phase={phase}
        tone={tone}
        controls={controls}
        status={status}
        busy={phase === 'signing' || phase === 'locked' || phase === 'blending'}
        widgetRef={setHost}
        side={
          phase === 'done' ? (
            <EnteredPanel
              entryIndex={0}
              asset="97t2ZFh3xkQ1mNpR4sT6uV8wX9yZ2aB3cD4eF5gH6iJ7"
              poolNumber={16}
              poolAddress="F1XTUREPoo1111111111111111111111111111111111"
              wallet="F1XTUREWa11et11111111111111111111111111111111"
              signer={undefined}
              email={null}
              apiBase={undefined}
              notifyOffered
            />
          ) : null
        }
      />
      {inReview && host ? createPortal(<DemoReview expired={expired} />, host) : null}
    </main>
    </div>
  );
}
