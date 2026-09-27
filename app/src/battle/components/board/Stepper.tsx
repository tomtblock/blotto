'use client';

/*
 * THE STEPPER (founder 2026-09-24): the mockup's crowd popover, widened.
 * Opened from a crowd's count chip or a field's plaque. Single points are
 * the main move — −1 / +1 are the big gold keys — with ±5, ±10, ±20 beside
 * them, reducing at the same rate as adding. Plus: fill the field with this
 * troop, send this troop back, and LOCK IN the field.
 *
 * No key ever overshoots: each disables when the step would break the field
 * (easy) or the board (hard) — the reducer would clip it anyway, but a key
 * that would do less than it says is a lie. With no troop armed the stepper
 * opens on a picker of the five, so a player who tapped a plaque first is
 * not stuck.
 */

import { STAT_NAMES } from '@/battle/allocation';
import { type BoardPlayState, canLock, fieldRemaining } from '@/battle/board/machine';
import { STEP_SIZES } from '@/battle/board/mode';
import { COPY } from '@/copy';
import { SPRITES, STAT_COLORS } from './arena/figures';

export interface StepperProps {
  state: BoardPlayState;
  field: number;
  onPlace: (field: number, stat: number, delta: number) => void;
  onFill: (field: number, stat: number) => void;
  onSendBack: (field: number, stat: number) => void;
  /** V2: every point off this field (bulk clearing). */
  onClearField: (field: number) => void;
  onLock: (field: number) => void;
  onUnlock: (field: number) => void;
  onSelect: (stat: number) => void;
  onClose: () => void;
}

export function Stepper({ state, field, onPlace, onFill, onSendBack, onClearField, onLock, onUnlock, onSelect, onClose }: StepperProps) {
  const stat = state.selected;
  const isLocked = state.locked[field] === true;
  const left = fieldRemaining(state, field);
  const fieldNo = field + 1;
  const fieldPlaced = (state.grid[field] ?? []).reduce((a, b) => a + b, 0);

  if (stat === null) {
    return (
      <div className="bb-stepper" role="dialog" aria-label={COPY.board.pickTroopTitle(fieldNo)} onPointerDown={(e) => e.stopPropagation()}>
        <div className="bb-stepper-head">
          <div className="bb-stepper-text">
            <h3>{COPY.board.pickTroopTitle(fieldNo)}</h3>
          </div>
          <button type="button" className="bb-btn bb-btn--ghost" onClick={onClose} aria-label={COPY.board.close}>
            ✕
          </button>
        </div>
        <div className="bb-picker">
          {STAT_NAMES.map((name, z) => (
            <button key={name} type="button" className="bb-btn" style={{ borderColor: STAT_COLORS[z] }} onClick={() => onSelect(z)}>
              {name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const name = STAT_NAMES[stat] as string;
  const value = state.grid[field]?.[stat] ?? 0;
  const colour = STAT_COLORS[stat];
  const lockable = canLock(state, field);
  const lockHint = isLocked
    ? COPY.board.lockedHint(fieldNo)
    : lockable
      ? null
      : state.mode === 'easy'
        ? COPY.board.lockNeedsFull
        : COPY.board.lockNeedsPlaced(left);

  return (
    <div
      className="bb-stepper"
      role="dialog"
      aria-label={COPY.board.stepperTitle(name, fieldNo)}
      style={{ ['--troop' as string]: colour }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="bb-stepper-head">
        {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size painted sprite */}
        <img src={SPRITES[stat]} alt="" draggable={false} />
        <div className="bb-stepper-text">
          <h3>{COPY.board.stepperTitle(name, fieldNo)}</h3>
          <div className="bb-stepper-sub">{state.mode === 'easy' ? COPY.board.leftHere(left) : COPY.board.leftToPlace(left)}</div>
        </div>
        <button type="button" className="bb-btn bb-btn--ghost" onClick={onClose} aria-label={COPY.board.close}>
          ✕
        </button>
      </div>
      <div className="bb-stepper-row">
        {[...STEP_SIZES].reverse().map((n) => (
          <button
            key={`-${n}`}
            type="button"
            className={'bb-btn' + (n === 1 ? ' bb-btn--primary' : '')}
            disabled={isLocked || value < n}
            onClick={() => onPlace(field, stat, -n)}
            aria-label={COPY.board.stepAria(-n, name, fieldNo)}
          >
            −{n}
          </button>
        ))}
        <span className="bb-stepper-num" aria-live="polite">
          {value}
        </span>
        {STEP_SIZES.map((n) => (
          <button
            key={`+${n}`}
            type="button"
            className={'bb-btn' + (n === 1 ? ' bb-btn--primary' : '')}
            disabled={isLocked || left < n}
            onClick={() => onPlace(field, stat, n)}
            aria-label={COPY.board.stepAria(n, name, fieldNo)}
          >
            +{n}
          </button>
        ))}
      </div>
      <div className="bb-stepper-actions">
        <button type="button" className="bb-btn" disabled={isLocked || left === 0} onClick={() => onFill(field, stat)}>
          {COPY.board.fillField(name)}
        </button>
        <button type="button" className="bb-btn" disabled={isLocked || value === 0} onClick={() => onSendBack(field, stat)}>
          {COPY.board.sendBack(name)}
        </button>
        <button
          type="button"
          className="bb-btn bb-btn--danger"
          disabled={isLocked || fieldPlaced === 0}
          onClick={() => onClearField(field)}
          data-testid="stepper-clear-field"
        >
          {COPY.board.clearField(fieldNo)}
        </button>
        {isLocked ? (
          <button type="button" className="bb-btn" onClick={() => onUnlock(field)}>
            {COPY.board.unlock(fieldNo)}
          </button>
        ) : (
          <button type="button" className="bb-btn" disabled={!lockable} onClick={() => onLock(field)}>
            {COPY.board.lock(fieldNo)}
          </button>
        )}
      </div>
      {lockHint && <p className="bb-stepper-sub" style={{ margin: 0 }}>{lockHint}</p>}
    </div>
  );
}
