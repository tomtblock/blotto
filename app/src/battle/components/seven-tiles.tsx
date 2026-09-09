'use client';

/*
 * <SevenTiles /> — the rack under the machine (founder 2026-09-09): "a
 * still image of the final shape is taken, the stats are logged and one
 * tile is filled at the bottom of the screen to show a locked-in Blot."
 *
 * Seven slots in battle order. A locked slot shows the lock-in still (the
 * same 1024² shapes-only PNG the montage uses, as an object URL) and the
 * five integers in the fixed stat order; an unmade slot shows its number.
 * The locked face of a slot is keyed separately from its empty face, so it
 * MOUNTS the moment the battle locks and its one settle animation plays
 * then — no render-time bookkeeping. Stills are pictures of the allocation
 * and stay on the device like the allocation (render-still.ts) — this
 * strip never uploads.
 */

import { COPY } from '@/copy';
import type { Allocation } from '../allocation';
import { BATTLES } from '../machine';
import './seven-tiles.css';

export interface TileEntry {
  allocation: Allocation;
  /** Object URL of the lock-in still, or null while it renders. */
  stillUrl: string | null;
}

export interface SevenTilesProps {
  /** Locked battles so far, in order (length 0..7). */
  locked: readonly TileEntry[];
  /** True on the review screen — every tile lifts together. */
  crescendo?: boolean;
}

export function SevenTiles({ locked, crescendo = false }: SevenTilesProps) {
  return (
    <ol
      className={`seven-tiles${crescendo ? ' is-crescendo' : ''}`}
      aria-label={COPY.battle.tilesLabel}
    >
      {Array.from({ length: BATTLES }, (_, k) => {
        const entry = locked[k];
        const stats = entry ? entry.allocation.join(' · ') : '';
        return (
          <li
            key={k}
            className={`seven-tile${entry ? ' is-locked' : ''}`}
            aria-label={entry ? COPY.battle.tileLocked(k + 1, stats) : COPY.battle.tileEmpty(k + 1)}
          >
            {entry ? (
              <div key="locked" className="seven-tile-still" aria-hidden="true">
                {entry.stillUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- object URL of a canvas render
                  <img src={entry.stillUrl} alt="" />
                ) : (
                  <span className="seven-tile-number">{k + 1}</span>
                )}
              </div>
            ) : (
              <div key="empty" className="seven-tile-still" aria-hidden="true">
                <span className="seven-tile-number">{k + 1}</span>
              </div>
            )}
            <span className="seven-tile-stats tnum" aria-hidden="true">
              {entry ? stats : ' '}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
