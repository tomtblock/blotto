'use client';

/*
 * Toggle (V2, founder 2026-09-27): the one segmented control. The home
 * card switches Easy / Hard with it, the pool page switches Plays / Pays,
 * and the tier filter is a row of them. One shape everywhere so a player
 * learns it once.
 *
 * `size="sm"` with `layout="stacked"`: the landing's entry-price row,
 * seven prices with "SOL" under each, narrow enough to sit on one line of a
 * 375 px card; it grows to the `md` keys from the `sm` width.
 *
 * `layout="stacked"` (D-E19, founder brief 2026-11-05): the landing's size
 * toggle — "8 · 16 · 32 · 64" with each size's live fill under it — puts
 * the detail BELOW the label instead of beside it, so the row stays four
 * narrow keys at 375 px. `layout="responsive"` is stacked on a phone and
 * inline from the `sm` width: the landing's board toggle, whose two
 * inline options ("EASY 100 per battle · HARD 700 anywhere") are wider
 * than a 375 px card and used to wrap inside their own pill.
 *
 * Accessibility: a radiogroup — one option is always chosen, arrow keys
 * move between options, the chosen one carries `aria-checked`. A disabled
 * option stays in the row (the founder's greyed-out tiers) but cannot be
 * chosen, and says why through `title`.
 */

import { useId, type KeyboardEvent } from 'react';

export interface ToggleOption<T extends string> {
  value: T;
  label: string;
  /** A second, quieter word beside the label (a subtitle). */
  detail?: string;
  /** Present but unchoosable — greyed, with the reason as a tooltip. */
  disabled?: boolean;
  disabledReason?: string;
  /** The option's accessible name, where the visible text is terse ("16", "5/16"). */
  ariaLabel?: string;
}

export interface ToggleProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly ToggleOption<T>[];
  /** The group's accessible name. */
  label: string;
  /** `cream` on a dark (plum) surface; `berry` on the pink field or a cream card. */
  tone?: 'cream' | 'berry';
  /** `sm` is the stacked entry-price row: compact on a phone, `md` from the `sm` width. */
  size?: 'sm' | 'md' | 'lg';
  /** `inline`: the detail beside the label. `stacked`: under it.
   * `responsive`: under it on a phone, beside it from `sm`. */
  layout?: 'inline' | 'stacked' | 'responsive';
  className?: string;
  'data-testid'?: string;
}

const TRACK: Record<NonNullable<ToggleProps<string>['tone']>, string> = {
  cream: 'border-white/25 bg-black/20',
  berry: 'border-brand-berry/40 bg-brand-cream',
};
const ON: Record<NonNullable<ToggleProps<string>['tone']>, string> = {
  cream: 'bg-brand-cream text-brand-berry',
  berry: 'bg-brand-berry text-brand-cream',
};
const OFF: Record<NonNullable<ToggleProps<string>['tone']>, string> = {
  cream: 'text-brand-cream hover:bg-white/10',
  berry: 'text-brand-berry hover:bg-brand-berry/10',
};

export function Toggle<T extends string>({
  value,
  onChange,
  options,
  label,
  tone = 'cream',
  size = 'md',
  layout = 'inline',
  className = '',
  'data-testid': testId,
}: ToggleProps<T>) {
  const id = useId();
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = options.filter((o) => !o.disabled);
    const at = enabled.findIndex((o) => o.value === value);
    if (at === -1 || enabled.length < 2) return;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (at + 1) % enabled.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (at - 1 + enabled.length) % enabled.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = enabled.length - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(enabled[next]!.value);
  };
  const stacked = layout === 'stacked';
  const responsive = layout === 'responsive';
  const pad = stacked
    ? size === 'lg'
      ? 'min-w-[56px] px-3.5 py-1.5 text-[17px]'
      : size === 'sm'
        ? 'min-w-[36px] px-1.5 py-1 text-[13px] sm:min-w-[48px] sm:px-3 sm:text-[15px]'
        : 'min-w-[48px] px-3 py-1 text-[15px]'
    : responsive
      ? size === 'lg'
        ? 'px-4 py-1.5 text-[15px] sm:px-5 sm:py-2.5'
        : 'px-3 py-1 text-[13px] sm:px-3.5 sm:py-1.5'
      : size === 'lg'
        ? 'px-5 py-2.5 text-[15px]'
        : 'px-3.5 py-1.5 text-[13px]';
  const shape = stacked
    ? 'flex-col items-center gap-0 rounded-[18px] leading-tight'
    : responsive
      ? 'flex-col items-center gap-0 rounded-[18px] leading-tight sm:flex-row sm:items-baseline sm:gap-1.5 sm:rounded-full sm:leading-normal'
      : 'items-baseline gap-1.5 rounded-full';
  const track = stacked ? 'rounded-[22px]' : responsive ? 'rounded-[22px] sm:rounded-full' : 'rounded-full';
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-testid={testId}
      onKeyDown={onKey}
      className={`inline-flex max-w-full flex-wrap gap-1 border p-1 ${track} ${TRACK[tone]} ${className}`}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            id={`${id}-${o.value}`}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.ariaLabel}
            aria-disabled={o.disabled || undefined}
            title={o.disabled ? o.disabledReason : undefined}
            tabIndex={on ? 0 : -1}
            onClick={() => {
              if (!o.disabled && !on) onChange(o.value);
            }}
            data-testid={testId ? `${testId}-${o.value}` : undefined}
            className={
              `flex ${shape} font-display font-bold uppercase tracking-wide ` +
              `transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-cream ${pad} ` +
              (o.disabled ? 'cursor-not-allowed opacity-40 ' : 'cursor-pointer ') +
              (on ? ON[tone] : OFF[tone])
            }
          >
            <span>{o.label}</span>
            {o.detail ? (
              <span
                className={`font-body font-medium normal-case tracking-normal opacity-80 ${stacked ? 'tnum text-[11px] leading-4' : 'text-[11px]'}`}
                data-testid={testId ? `${testId}-${o.value}-detail` : undefined}
              >
                {o.detail}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
