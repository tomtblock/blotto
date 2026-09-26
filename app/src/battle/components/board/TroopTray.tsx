'use client';

/*
 * THE TROOP TRAY — five cards along the bottom, one per stat, like the
 * troop bar in the mockup: the painted sprite on a cream card with a wood
 * outline; the armed card lifts and glows in its stat's colour. Tap a card
 * to arm it; tap it again to disarm. Arming starts nothing. In hard mode
 * each card shows how many of that stat are placed (founder 5.3).
 */

import { STAT_NAMES } from '@/battle/allocation';
import type { BoardPlayState } from '@/battle/board/machine';
import { COPY } from '@/copy';
import { SPRITES, STAT_COLORS } from './arena/figures';

export interface TroopTrayProps {
  state: Pick<BoardPlayState, 'grid' | 'mode' | 'selected'>;
  onSelect: (stat: number | null) => void;
  disabled?: boolean;
}

export function TroopTray({ state, onSelect, disabled = false }: TroopTrayProps) {
  const placedByStat = STAT_NAMES.map((_, z) => state.grid.reduce((a, row) => a + (row[z] ?? 0), 0));
  return (
    <div className={'bb-tray' + (state.selected !== null ? ' bb-tray--armed' : '')} role="toolbar" aria-label={COPY.board.trayLabel}>
      {STAT_NAMES.map((name, z) => {
        const sel = state.selected === z;
        return (
          <button
            key={name}
            type="button"
            aria-pressed={sel}
            disabled={disabled}
            className={'bb-troop' + (sel ? ' bb-troop--selected' : '')}
            style={{ ['--troop' as string]: STAT_COLORS[z] }}
            onClick={() => onSelect(sel ? null : z)}
            data-testid={`troop-${z}`}
          >
            <span className="bb-troop-art">
              {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size painted sprite; next/image adds nothing */}
              <img src={SPRITES[z]} alt="" draggable={false} />
            </span>
            <span className="bb-troop-name">{name}</span>
            {state.mode === 'hard' && <small>{COPY.board.troopPlaced(placedByStat[z] ?? 0)}</small>}
          </button>
        );
      })}
    </div>
  );
}
