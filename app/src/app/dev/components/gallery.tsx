"use client";

/*
 * The D1 gallery: every token, type-scale step, motion and component in one
 * scrollable page, so a change to the system is reviewed by eye here before
 * it ships on a real screen. Dev-only (see page.tsx).
 */
import { useState } from "react";
import { palette, type as typeTokens, motion, elevation } from "@/design/tokens";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Countdown } from "@/components/ui/countdown";
import { ProgressRing } from "@/components/ui/progress-ring";
import { RankBadge } from "@/components/ui/rank-badge";
import { PrizeTable } from "@/components/ui/prize-table";
import { showToast } from "@/components/ui/toaster";
import { Sheet } from "@/components/ui/sheet";
import { SeatRing } from "@/components/ui/seat-ring";
import { Frost } from "@/components/ui/frost";
import { PentagonMini } from "@/components/ui/pentagon-mini";
import { EntrySplit } from "@/components/entry-split";
import { SettledCounter } from "@/components/ui/settled-counter";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorSurface } from "@/components/ui/error-surface";
import {
  EVEN_RAW,
  dragTo,
  normalize,
  type Allocation,
  type RawWeights,
} from "@/battle/allocation";
import { PentagonRadar } from "@/battle/components/pentagon-radar";

/* Grammar demos: state lives here so the components animate real changes. */
function SeatRingDemo() {
  const [entrants, setEntrants] = useState(23);
  return (
    <div className="flex flex-wrap items-center gap-8">
      <SeatRing entrants={entrants} riser yourSeat={4} />
      <SeatRing entrants={entrants} size={96} />
      <div className="flex flex-col items-start gap-2">
        <Button intent="secondary" onClick={() => setEntrants((n) => Math.min(64, n + 1))}>
          Simulate an entry event
        </Button>
        <p className="max-w-[36ch] text-[13px] leading-5 text-ink-muted">
          Fill sweep + one LIGHT pass + digit slide + &quot;+1 entered&quot; riser per real event.
          The resting glow (WARMTH) scales with occupancy and never loops.
        </p>
      </div>
    </div>
  );
}

const DEMO_ALLOCATION: Allocation = [31, 17, 24, 9, 19];

/* The full allocation instrument, wired to the real normalisation — the
 * perf-budget surface (60fps during a drag at 4× CPU throttle). */
function PentagonDemo() {
  const [raw, setRaw] = useState<RawWeights>(() => [...EVEN_RAW]);
  const display = normalize(raw);
  return (
    <div className="max-w-[380px]" data-testid="pentagon-demo">
      <PentagonRadar
        display={display}
        onDrag={(stat, value) => setRaw((r) => dragTo(r, stat, value))}
      />
    </div>
  );
}

function FrostDemo() {
  const [frosted, setFrosted] = useState(true);
  return (
    <div className="flex flex-wrap items-center gap-8">
      <Frost frosted={frosted} className="rounded-xl border border-line bg-raised p-3">
        <PentagonMini allocation={DEMO_ALLOCATION} size={96} />
      </Frost>
      <div className="flex flex-col items-start gap-2">
        <Button intent="secondary" onClick={() => setFrosted((f) => !f)}>
          {frosted ? "De-frost" : "Frost"}
        </Button>
        <p className="max-w-[36ch] text-[13px] leading-5 text-ink-muted">
          FROST: the only blur on the site. Sealed objects are present but unreadable; de-frost
          is always simultaneous for every object in a pool.
        </p>
      </div>
    </div>
  );
}

function SettledCounterDemo() {
  const [paid, setPaid] = useState(128.4);
  return (
    <div className="flex flex-wrap items-end gap-8">
      <SettledCounter
        value={paid.toFixed(1)}
        unit="SOL"
        label="Paid to players to date"
        deltaText={(prev, next) => `+${(Number(next) - Number(prev)).toFixed(1)} SOL`}
      />
      <Button intent="secondary" onClick={() => setPaid((v) => v + 4.1)}>
        Simulate a payout event
      </Button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-14">
      <h2 className="mb-5 border-b border-line pb-2 font-display text-[24px] font-bold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Swatch({ name, hex }: { name: string; hex: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-10 w-10 shrink-0 rounded-lg border border-line"
        style={{ backgroundColor: hex }}
      />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-ink">{name}</div>
        <div className="font-mono text-[12px] uppercase text-ink-muted">{hex}</div>
      </div>
    </div>
  );
}

function MotionDemo({ name, animateClass }: { name: string; animateClass: string }) {
  const [runId, setRunId] = useState(0);
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        className="rounded-md border border-line px-3 py-1 text-[13px] text-ink-muted hover:border-brand hover:text-brand"
        onClick={() => setRunId((n) => n + 1)}
      >
        run {name}
      </button>
      <div
        key={runId}
        className={`${animateClass} flex h-16 w-40 items-center justify-center rounded-xl border border-line bg-raised text-[14px] text-ink`}
      >
        {name}
      </div>
    </div>
  );
}

/* Static example rows for the PrizeTable demo — amounts are display strings
 * by design (the component does no arithmetic; see prize-table.tsx). */
const DEMO_PRIZE_ROWS = [
  { position: "1st", amountSol: "1.44", rank: 1 },
  { position: "2nd", amountSol: "0.88", rank: 2 },
  { position: "3rd", amountSol: "0.56", rank: 3 },
  { position: "4th", amountSol: "0.40", rank: 4 },
  { position: "5th–8th", amountSol: "0.24", rank: 5 },
  { position: "9th–16th", amountSol: "0.12", rank: 9 },
];

function ToastDemoButtons() {
  
  return (
    <div className="flex flex-wrap gap-3">
      <Button intent="secondary" onClick={() => showToast("Allocation sealed")}>
        Show ink toast
      </Button>
      <Button intent="secondary" onClick={() => showToast("Prize paid to your wallet", "prize")}>
        Show prize toast
      </Button>
    </div>
  );
}

export function Gallery() {
  const [sheetOpen, setSheetOpen] = useState(false);
  // A stable demo deadline ~36 hours out (computed once per mount; dev page).
  const [deadline] = useState(() => Math.floor(Date.now() / 1000) + 36 * 3600 + 42 * 60 + 7);

  return (
    <>
      <main className="mx-auto max-w-4xl px-5 py-10">
        <p className="mb-2 text-[12px] uppercase tracking-[0.14em] text-ink-muted">
          dev preview — not routed in production
        </p>
        <h1 className="mb-12 font-display text-[56px] font-extrabold leading-[58px] text-ink">
          Design system
        </h1>

        <Section title="Palette">
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
            {Object.entries(palette).map(([name, hex]) => (
              <Swatch key={name} name={name} hex={hex} />
            ))}
          </div>
          <p className="mt-5 max-w-prose text-[13px] leading-5 text-ink-muted">
            Reservation rules: priceUp/priceDown carry win–loss semantics only; prize amber is worn
            by paid amounts and nothing else; rarityGold belongs to the top class&apos;s art and never
            to prizes; class hues are cosmetic placeholders (founder-owned).
          </p>
        </Section>

        <Section title="Type scale">
          <div className="flex flex-col gap-4">
            {Object.entries(typeTokens.scale).map(([name, [size, lh]]) => (
              <div key={name} className="flex items-baseline gap-4">
                <span className="w-24 shrink-0 font-mono text-[12px] text-ink-muted">
                  {name} {size}/{lh}
                </span>
                <span
                  className={
                    (size >= 34 ? "tnum font-display font-bold " : "") + "truncate text-ink"
                  }
                  style={{ fontSize: size, lineHeight: `${lh}px` }}
                >
                  {size >= 34 ? "128 240 512" : "Seven battles, five stats, one hundred points."}
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Motion — the grammar">
          <div className="flex flex-wrap gap-8">
            <MotionDemo name="LIGHT (in)" animateClass="animate-light-in" />
            <MotionDemo name="WEIGHT (stamp)" animateClass="animate-stamp" />
            <MotionDemo name="WARMTH (rise)" animateClass="animate-warmth-rise" />
            <MotionDemo name="enter" animateClass="animate-enter" />
          </div>
          <p className="mt-5 max-w-prose text-[13px] leading-5 text-ink-muted">
            Durations: fast {motion.duration.fast}ms (micro-feedback, every exit) · base{' '}
            {motion.duration.base}ms (LIGHT, enters) · slow {motion.duration.slow}ms (FROST,
            morphs). Five words — LIGHT · FROST · WEIGHT · WARMTH · TRAVEL — each bound to one
            game concept; see src/design/grammar.ts. All motion collapses under
            prefers-reduced-motion.
          </p>
        </Section>

        <Section title="Button">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Enter tournament</Button>
            <Button intent="secondary">View rules</Button>
            <Button intent="tertiary">See your result</Button>
            <Button disabled>Enter tournament</Button>
            <Button size="lg">Seal my allocation</Button>
          </div>
        </Section>

        <Section title="Card">
          <div className="grid gap-5 sm:grid-cols-2">
            <Card className="p-5">
              <div className="text-[15px] text-ink">Neutral card — depth, no glow.</div>
            </Card>
            <Card live className="p-5">
              <div className="text-[15px] text-ink">Live fixture card — signature light sweep.</div>
            </Card>
          </div>
        </Section>

        <Section title="Stat">
          <div className="flex flex-wrap items-end gap-10">
            <Stat label="Prize pool" value="3.84" unit="SOL" tone="prize" />
            <Stat label="Seats filled" value="23/64" tone="brand" />
            <Stat label="Battles" value="7" />
            <Stat label="Your prize" value="0.88" unit="SOL" tone="prize" size="moment" />
          </div>
        </Section>

        <Section title="Countdown">
          <Countdown deadlineUnix={deadline} label="Entries close" />
        </Section>

        <Section title="ProgressRing">
          <div className="flex items-center gap-8">
            <ProgressRing value={23} total={64} label="23 of 64 seats filled" />
            <ProgressRing value={64} total={64} size={64} label="All 64 seats filled" />
            <ProgressRing value={0} total={64} size={64} label="No seats filled yet" />
          </div>
        </Section>

        <Section title="RankBadge">
          <div className="flex flex-wrap items-center gap-4">
            <RankBadge rank={1} paid />
            <RankBadge rank={3} paid />
            <RankBadge rank={16} paid />
            <RankBadge rank={22} />
            <RankBadge rank={41} />
            <RankBadge rank={2} paid size="moment" />
          </div>
        </Section>

        <Section title="PrizeTable">
          <Card className="p-5">
            <PrizeTable
              rows={DEMO_PRIZE_ROWS}
              highlightRank={5}
              caption="Example prize structure with your row highlighted"
            />
          </Card>
        </Section>

        <Section title="Toast">
          <ToastDemoButtons />
        </Section>

        <Section title="Sheet">
          <Button intent="secondary" onClick={() => setSheetOpen(true)}>
            Open sheet
          </Button>
          <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Example sheet">
            <p className="text-[15px] leading-6 text-ink-muted">
              A bottom sheet for secondary flows. Escape closes it, backdrop click closes it, and
              focus is trapped by the native dialog element.
            </p>
          </Sheet>
        </Section>

        <Section title="Pentagon radar (the instrument)">
          <PentagonDemo />
        </Section>

        <Section title="Seat ring">
          <SeatRingDemo />
        </Section>

        <Section title="Frost + PentagonMini">
          <FrostDemo />
        </Section>

        <Section title="Entry split (80/20 TRAVEL)">
          <Card className="p-5">
            <EntrySplit entryLamports="100000000" />
          </Card>
          <p className="mt-3 max-w-prose text-[13px] leading-5 text-ink-muted">
            Plays once on scroll-entry, then rests. One 80-piece, one 20-piece, both labeled,
            visible paths, endpoints on screen. Reduced motion renders the settled diagram.
          </p>
        </Section>

        <Section title="Settled counter">
          <SettledCounterDemo />
        </Section>

        <Section title="Skeleton + ErrorSurface">
          <div className="flex flex-col gap-4">
            <div className="flex gap-3">
              <Skeleton className="h-10 w-40" />
              <Skeleton className="h-10 w-24" />
            </div>
            <ErrorSurface>
              The confirmation could not be recorded. Check your connection and try again.
            </ErrorSurface>
          </div>
        </Section>

        <Section title="Elevation">
          <div className="grid gap-5 sm:grid-cols-2">
            {Object.entries(elevation).map(([name, shadow]) => (
              <div
                key={name}
                className="rounded-2xl border border-line bg-raised p-5"
                style={{ boxShadow: shadow }}
              >
                <div className="text-[13px] font-medium text-ink">{name}</div>
                <div className="mt-1 font-mono text-[11px] leading-4 text-ink-muted">{shadow}</div>
              </div>
            ))}
          </div>
        </Section>
      </main>
    </>
  );
}
