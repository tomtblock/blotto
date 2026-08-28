'use client';

/*
 * EntrySplit (UI constitution PART 5.6) — the 80/20 TRAVEL animation: the
 * business model rendered honestly, built once and used at submit
 * confirmation and on the fair-play page.
 *
 * One entry produces exactly one 80-piece and one 20-piece, visibly, both
 * labeled, moving along VISIBLE paths with origin and destination on
 * screen. Money never teleports and never multiplies. The amounts are
 * computed in integer lamports from the real entry price — 80% to the
 * prize treasury, the remainder to the operator — and formatted by the
 * same formatter every other surface uses.
 *
 * Choreography (~1.4s total, the TRAVEL leg 800ms ease-in-out):
 *   1. The entry chip enters at the origin (250ms ease-out).
 *   2. It splits: two labeled pieces, sized in proportion (80 vs 20),
 *      crossfade in as the chip fades (150ms).
 *   3. Both pieces TRAVEL their paths simultaneously over 800ms.
 *   4. Each endpoint receives its piece with a single LIGHT rise; the
 *      settled amounts remain, labeled. Then the scene rests.
 *
 * Plays once when scrolled into view (or immediately via `playOnMount`),
 * then rests — no idle motion. Reduced motion: no travel; the final scene
 * renders immediately with both endpoints labeled.
 *
 * WAAPI (element.animate on transform/opacity only) — hardware-accelerated,
 * interruptible, no library needed.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from '@/design/tokens';
import { travel } from '@/design/grammar';
import { lamportsToSol } from '@/data/format';
import { usePrefersReducedMotion } from '@/design/use-reduced-motion';

export interface EntrySplitProps {
  /** The tier's entry price in lamports (decimal string, chain state). */
  entryLamports: string;
  /** Start immediately instead of on scroll-entry (submit confirmation). */
  playOnMount?: boolean;
  /** Called when the choreography settles (used to sequence submit UI). */
  onSettled?: () => void;
  className?: string;
}

type Phase = 'idle' | 'playing' | 'settled';

/* Scene geometry (percent of the stage). */
const ORIGIN = { x: 50, y: 12 };
const TREASURY = { x: 22, y: 78 };
const OPERATOR = { x: 78, y: 78 };

export function EntrySplit({
  entryLamports,
  playOnMount = false,
  onSettled,
  className = '',
}: EntrySplitProps) {
  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = useState<Phase>(() => (playOnMount ? 'playing' : 'idle'));
  const stageRef = useRef<HTMLDivElement | null>(null);
  const chipRef = useRef<HTMLDivElement | null>(null);
  const bigRef = useRef<HTMLDivElement | null>(null);
  const smallRef = useRef<HTMLDivElement | null>(null);
  const settledCb = useRef(onSettled);
  useEffect(() => {
    settledCb.current = onSettled;
  }, [onSettled]);

  const amounts = useMemo(() => {
    const entry = BigInt(entryLamports);
    const treasury = (entry * 80n) / 100n;
    const operator = entry - treasury;
    return {
      entry: lamportsToSol(entryLamports),
      treasury: lamportsToSol(treasury.toString()),
      operator: lamportsToSol(operator.toString()),
    };
  }, [entryLamports]);

  /* Reduced motion: the scene is simply, statically, its settled truth —
   * both endpoints labeled. The settle callback still fires once. */
  const settledNotified = useRef(false);
  useEffect(() => {
    if (!reduced || settledNotified.current) return;
    settledNotified.current = true;
    settledCb.current?.();
  }, [reduced]);

  /* Arm on scroll-entry (once). */
  useEffect(() => {
    if (phase !== 'idle' || reduced) return;
    const el = stageRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          setPhase('playing');
        }
      },
      { threshold: 0.45 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [phase, reduced]);

  /* The choreography. */
  useEffect(() => {
    if (phase !== 'playing' || reduced) return;
    const stage = stageRef.current;
    const chip = chipRef.current;
    const big = bigRef.current;
    const small = smallRef.current;
    if (!stage || !chip || !big || !small) return;

    const rect = stage.getBoundingClientRect();
    const px = (p: { x: number; y: number }) => ({
      x: (p.x / 100) * rect.width,
      y: (p.y / 100) * rect.height,
    });
    const o = px(ORIGIN);
    const t = px(TREASURY);
    const op = px(OPERATOR);

    const anims: Animation[] = [];

    // 1. Chip enters, then hands off to the pieces (fast exit).
    anims.push(
      chip.animate(
        [
          { opacity: 0, transform: 'translate(-50%, -50%) translateY(-6px)' },
          { opacity: 1, transform: 'translate(-50%, -50%)', offset: 0.35 },
          { opacity: 1, transform: 'translate(-50%, -50%)', offset: 0.8 },
          { opacity: 0, transform: 'translate(-50%, -50%)' },
        ],
        { duration: 500, easing: motion.easing.out, fill: 'both' }
      )
    );

    // 2–3. The pieces appear at the origin and TRAVEL, simultaneously.
    const flight = (el: HTMLElement, dest: { x: number; y: number }) =>
      el.animate(
        [
          {
            opacity: 0,
            transform: `translate(-50%, -50%) translate(${o.x}px, ${o.y}px)`,
          },
          {
            opacity: 1,
            transform: `translate(-50%, -50%) translate(${o.x}px, ${o.y}px)`,
            offset: 0.12,
          },
          {
            opacity: 1,
            transform: `translate(-50%, -50%) translate(${dest.x}px, ${dest.y}px)`,
            offset: 0.97,
          },
          {
            opacity: 0,
            transform: `translate(-50%, -50%) translate(${dest.x}px, ${dest.y}px)`,
          },
        ],
        {
          duration: travel.splitMs + 350,
          delay: 380,
          easing: travel.easing,
          fill: 'both',
        }
      );
    anims.push(flight(big, t), flight(small, op));

    const last = anims[anims.length - 1];
    last.onfinish = () => {
      setPhase('settled');
      settledCb.current?.();
    };
    return () => anims.forEach((a) => a.cancel());
  }, [phase, reduced]);

  const settled = reduced || phase === 'settled';

  return (
    <div
      ref={stageRef}
      className={`relative h-64 w-full select-none ${className}`}
      role="img"
      aria-label={
        `Your ${amounts.entry} SOL entry splits at the program level: ` +
        `${amounts.treasury} SOL to the prize treasury, ${amounts.operator} SOL to the operator.`
      }
    >
      {/* The visible paths — origin and destinations always on screen. */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
        <path
          d={`M ${ORIGIN.x} ${ORIGIN.y + 6} C ${ORIGIN.x - 6} 45, ${TREASURY.x} 52, ${TREASURY.x} ${TREASURY.y - 10}`}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth="0.6"
          strokeDasharray="1.6 1.6"
        />
        <path
          d={`M ${ORIGIN.x} ${ORIGIN.y + 6} C ${ORIGIN.x + 6} 45, ${OPERATOR.x} 52, ${OPERATOR.x} ${OPERATOR.y - 10}`}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth="0.6"
          strokeDasharray="1.6 1.6"
        />
      </svg>

      {/* Origin: the entry chip. */}
      <div
        ref={chipRef}
        aria-hidden
        className="absolute rounded-full border border-brand/50 bg-overlay px-4 py-1.5 text-[14px] font-semibold text-ink"
        style={{
          left: `${ORIGIN.x}%`,
          top: `${ORIGIN.y}%`,
          transform: 'translate(-50%, -50%)',
          opacity: settled || phase === 'idle' ? 1 : 0,
        }}
      >
        <span className="tnum">{amounts.entry} SOL</span>
        <span className="ml-1.5 text-[12px] font-normal text-ink-muted">entry</span>
      </div>

      {/* The two traveling pieces — sized in proportion, both labeled. */}
      <div
        ref={bigRef}
        aria-hidden
        className="absolute left-0 top-0 rounded-full bg-brand px-4 py-1.5 text-[14px] font-semibold text-(--color-base)"
        style={{ opacity: 0 }}
      >
        <span className="tnum">{amounts.treasury}</span>
        <span className="ml-1.5 text-[11px] font-medium opacity-80">80%</span>
      </div>
      <div
        ref={smallRef}
        aria-hidden
        className="absolute left-0 top-0 rounded-full bg-overlay px-2.5 py-1 text-[12px] font-medium text-ink"
        style={{ opacity: 0 }}
      >
        <span className="tnum">{amounts.operator}</span>
        <span className="ml-1 text-[10px] opacity-80">20%</span>
      </div>

      {/* Endpoints — labeled glyphs; they receive with a single LIGHT rise. */}
      <Endpoint
        x={TREASURY.x}
        y={TREASURY.y}
        title="Prize treasury"
        note="held by the program"
        amount={settled ? `${amounts.treasury} SOL` : undefined}
        lit={settled && !reduced}
        emphasis
      />
      <Endpoint
        x={OPERATOR.x}
        y={OPERATOR.y}
        title="Operator"
        note="20% share"
        amount={settled ? `${amounts.operator} SOL` : undefined}
        lit={settled && !reduced}
      />
    </div>
  );
}

function Endpoint({
  x,
  y,
  title,
  note,
  amount,
  lit,
  emphasis = false,
}: {
  x: number;
  y: number;
  title: string;
  note: string;
  amount?: string;
  lit: boolean;
  emphasis?: boolean;
}) {
  return (
    <div
      aria-hidden
      className="absolute flex w-32 -translate-x-1/2 flex-col items-center gap-1 text-center"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <div
        className={
          (lit ? 'animate-light-in ' : '') +
          'flex h-11 w-11 items-center justify-center rounded-xl border ' +
          (emphasis ? 'border-brand/60 bg-overlay' : 'border-line bg-raised')
        }
      >
        {/* Vault / ledger glyphs — geometry, not iconography-by-emoji. */}
        {emphasis ? (
          <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden>
            <rect x="3" y="4" width="14" height="12" rx="2" fill="none" stroke="var(--color-brand)" strokeWidth="1.5" />
            <circle cx="10" cy="10" r="2.6" fill="none" stroke="var(--color-brand)" strokeWidth="1.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden>
            <rect x="4" y="3" width="12" height="14" rx="2" fill="none" stroke="var(--color-ink-muted)" strokeWidth="1.5" />
            <path d="M7 8h6M7 12h4" stroke="var(--color-ink-muted)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </div>
      <div className="text-[12px] font-medium text-ink">{title}</div>
      <div className="text-[11px] leading-4 text-ink-muted">{note}</div>
      {amount ? <div className="tnum text-[13px] font-semibold text-ink">{amount}</div> : null}
    </div>
  );
}
