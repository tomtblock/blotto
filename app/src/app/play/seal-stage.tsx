'use client';

/*
 * The seal stage (founder 2026-09-16, CHANGE-2026-09-16_ui-uplift.md §A8):
 * the seven Blotts ride a conveyor into a blender; the seal key sits on the
 * blender's base; the blender runs once the transaction is signed, while
 * the network confirms; the pass rises when it has.
 *
 * Pure presentation over `sealStageVisual` (seal-stage.ts). Two clips:
 * the idle loop and the one-shot run, both cut from the same still, so the
 * switch is a crossfade onto a matching frame. The generic Blotts in the
 * scene are the prompt's, never the player's seven — a Blott's silhouette
 * is its allocation (components/blott/warp.ts), and this stage reads no
 * allocation at all.
 *
 * The box has the clip's exact aspect (seal-stage.css), so the controls
 * land on the painted button on a wide screen and drop below the scene on
 * a phone. Reduced motion: a still of the right moment and no <video>.
 */

import type { ReactNode } from 'react';
import { COPY } from '@/copy';
import { AmbientClip } from '@/components/ui/ambient-clip';
import { usePrefersReducedMotion } from '@/components/blot/springs';
import { sealStageVisual, type SealStagePhase } from './seal-stage-machine';
import './seal-stage.css';

const IDLE = [{ mp4: '/motion/seal/blender-idle.mp4', webm: '/motion/seal/blender-idle.webm' }];
const RUN = [{ mp4: '/motion/seal/blender-run.mp4', webm: '/motion/seal/blender-run.webm' }];
const POSTER_IDLE = '/motion/seal/blender-idle.jpg';
const POSTER_DONE = '/motion/seal/blender-done.jpg';

export type SealKeyTone = 'action' | 'red';

export function SealStage({
  phase,
  tone = 'action',
  controls,
  status,
  busy = false,
}: {
  phase: SealStagePhase;
  /** D3: the founder's call on the key's colour; `action` is the default. */
  tone?: SealKeyTone;
  /** The seal controls (§8.6 line + the key), rendered on the blender's base. */
  controls?: ReactNode;
  /** A one-line hold under the scene while the network works. */
  status?: ReactNode;
  /** Show the in-progress ring beside the status line. */
  busy?: boolean;
}) {
  const v = sealStageVisual(phase);
  const reduced = usePrefersReducedMotion();
  return (
    <section
      className="seal-stage"
      data-phase={phase}
      data-belt={v.beltRunning ? 'running' : 'stopped'}
      data-lid={v.lidDown ? 'down' : 'up'}
      data-pulse={v.keyPulse ? '1' : '0'}
      data-tone={tone}
      aria-label={COPY.battle.sealStageAria}
    >
      <div className="seal-stage-box">
        {reduced ? (
          // eslint-disable-next-line @next/next/no-img-element -- poster swap for a video; next/image adds nothing here
          <img
            src={v.clip === 'run' ? POSTER_DONE : POSTER_IDLE}
            alt=""
            aria-hidden="true"
            className="seal-stage-clip"
          />
        ) : (
          <>
            <AmbientClip
              tiers={IDLE}
              poster={POSTER_IDLE}
              preload="auto"
              paused={!v.beltRunning}
              className="seal-stage-clip"
            />
            {v.clip === 'run' && (
              <AmbientClip
                tiers={RUN}
                poster={POSTER_IDLE}
                preload="auto"
                once
                className="seal-stage-clip is-run"
              />
            )}
          </>
        )}
      </div>
      {controls ? <div className="seal-stage-controls">{controls}</div> : null}
      {status ? (
        <p className="seal-stage-status" aria-live="polite">
          {busy ? <span className="seal-stage-status-ring" aria-hidden="true" /> : null}
          {status}
        </p>
      ) : null}
    </section>
  );
}
