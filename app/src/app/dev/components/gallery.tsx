"use client";

/*
 * The D1 gallery: every token, type-scale step, motion and component in one
 * scrollable page, so a change to the system is reviewed by eye here before
 * it ships on a real screen. Dev-only (see page.tsx).
 */
import { useState } from "react";
import { TIER_POT_LAMPORTS } from "@blotto/scoring";
import { COPY } from "@/copy";
import { palette, type as typeTokens, motion, elevation } from "@/design/tokens";
import { lamportsToSol } from "@/data/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Countdown } from "@/components/ui/countdown";
import { ProgressRing } from "@/components/ui/progress-ring";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { Sheet } from "@/components/ui/sheet";
import { NeonSection } from "@/components/ui/neon-section";
import { NotificationsPanel, itemFor } from "@/components/shell/notifications";
import { FIXTURE_CAREER, SCENARIOS } from "@/data/scenarios";
import { BlotMorph } from "@/components/blot/BlotMorph";
import { SHAPE_REFERENCES } from "@/components/blot/blotGeometry";
import { EVEN_SPLIT, type Allocation } from "@/battle/allocation";
import { STOP_ACTIONS, StopCard } from "@/components/ui/stop-card";
import { EnteredPanel } from "@/app/play/entered-panel";
import { SigningOverlay } from "@/app/play/signing-overlay";

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

/* Every SOL figure on this page is the tier-0 pot — the smallest of the seven
 * fixed pots, funded from the treasury before entries open. Derived from the
 * shared table (backend/scoring/src/prizes.ts) rather than typed, so the
 * gallery cannot drift from the founder’s numbers. Renders as "4". */
const DEMO_POT_SOL = lamportsToSol(TIER_POT_LAMPORTS[0].toString());

function ToastDemoButtons() {
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-3">
      <Button intent="quiet" onClick={() => toast.show("Allocation sealed")}>
        Show ink toast
      </Button>
      <Button intent="quiet" onClick={() => toast.show("Prize paid to your wallet", "prize")}>
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
    <ToastProvider>
      <main id="main" className="mx-auto max-w-4xl px-5 py-10">
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
          <p className="mt-3 max-w-prose text-[13px] leading-5 text-ink-muted">
            Blot world (v4), the two-layer rule: brand tokens are surfaces, the mascot and inflated
            type; game tokens are the plum cards where every number, rule and control lives.
            gameAction is the only colour that spends or commits, and a pink pill is the only pink
            object allowed inside a plum card; gamePrize is worn only by amounts a player is paid.
            The Blot never shares a frame with a paid amount or a stat number. Arena tokens remain
            until every consumer migrates, then are deleted together.
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

        <Section title="Motion">
          <div className="flex flex-wrap gap-8">
            <MotionDemo name="reveal" animateClass="animate-reveal" />
            <MotionDemo name="settle" animateClass="animate-settle" />
            <MotionDemo name="pulse-once" animateClass="animate-pulse-once" />
            <MotionDemo name="rise" animateClass="animate-rise" />
          </div>
          <p className="mt-5 max-w-prose text-[13px] leading-5 text-ink-muted">
            Durations: reveal {motion.duration.reveal}ms · settle {motion.duration.settle}ms ·
            pulse-once {motion.duration.pulseOnce}ms · rise {motion.duration.rise}ms. All motion
            collapses under prefers-reduced-motion.
          </p>
        </Section>

        <Section title="Button">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Enter pool</Button>
            <Button intent="quiet">View rules</Button>
            <Button intent="prize">See your result</Button>
            <Button disabled>Enter pool</Button>
            <Button size="lg">{COPY.battle.seal}</Button>
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
            {/* The two prize figures are the same number on purpose: the winner’s
                prize IS the pool, so "your prize" can only ever be the whole pot
                — or an equal share of it on a tie for first. */}
            <Stat label="Prize pool" value={DEMO_POT_SOL} unit="SOL" tone="prize" />
            <Stat label="Seats filled" value="23/64" tone="brand" />
            <Stat label="Battles" value="7" />
            <Stat label="Your prize" value={DEMO_POT_SOL} unit="SOL" tone="prize" size="moment" />
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

        <Section title="Toast">
          <ToastDemoButtons />
        </Section>

        <Section title="Sheet">
          <Button intent="quiet" onClick={() => setSheetOpen(true)}>
            Open sheet
          </Button>
          <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Example sheet">
            <p className="text-[15px] leading-6 text-ink-muted">
              A bottom sheet for secondary flows. Escape closes it, backdrop click closes it, and
              focus is trapped by the native dialog element.
            </p>
          </Sheet>
        </Section>

        <Section title="Notifications (V2, sketch G)">
          {/* The sheet's body over the fixture career, which holds a paid pool:
              the clip, then the table — the win in gold, one row already
              opened, the rest New. */}
          <div className="max-w-lg">
            <NeonSection heading="Notifications" data-testid="notifications-demo">
              <NotificationsPanel
                items={FIXTURE_CAREER.flatMap((row) => {
                  const item = itemFor(row, SCENARIOS.find((s) => s.summary.pool === row.pool)?.summary.fill_deadline ?? null);
                  return item ? [item] : [];
                })}
                seen={new Set([`${FIXTURE_CAREER[1]!.pool}:${FIXTURE_CAREER[1]!.state}`])}
              />
            </NeonSection>
          </div>
        </Section>

        <Section title="Entry flow (V2): the hold, the success screen, the rejection card">
          {/* The three screens after the seal press, without a wallet or a
              chain: the signing hold (drawn fixed on the real page; pinned
              inside a frame here), the success screen, and a failure on the
              stop card. Reviewed by eye here before a real entry is risked. */}
          <div id="entry-flow" className="flex flex-col gap-8">
            <div className="relative h-[640px] overflow-hidden rounded-[28px] bg-brand-pink [&>[role=dialog]]:absolute">
              <SigningOverlay step="pay" />
            </div>
            <div className="rounded-[28px] bg-brand-pink p-4 sm:p-6" data-testid="gallery-entered">
              <EnteredPanel
                entryIndex={11}
                asset="F1XTUREpass11111111111111111111111111111111"
                poolNumber={7}
                mode="easy"
                poolAddress="F1XTUREPoo1111111111111111111111111111111111"
                wallet="F1XTUREP1ayer111111111111111111111111111111"
                signer={undefined}
                email={null}
                apiBase={undefined}
                notifyOffered
              />
            </div>
            <div className="rounded-[28px] bg-brand-pink p-4 sm:p-6">
              <StopCard
                kind="failure"
                title="Your entry did not go through"
                actions={[
                  { label: "Try again", intent: "primary" },
                  { href: "/wallet", label: "Add SOL", intent: "quiet" },
                  { ...STOP_ACTIONS.findAnotherPool(), intent: "quiet" },
                  { label: "Back to this pool", intent: "quiet" },
                ]}
              >
                <p>Your wallet could not cover the entry and the transaction cost. Nothing was charged.</p>
              </StopCard>
            </div>
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

        <Section title="The Blot — ten reference bodies">
          <p className="mb-4 max-w-2xl text-[13px] leading-5 text-ink-muted">
            The allocation made flesh: one continuous inflated outline, recomputed from the
            five stats. These ten are a READOUT vocabulary for review against the Higgsfield
            renders — never presented to a player as targets (PID §4.3).
          </p>
          <div className="grid grid-cols-2 gap-4 rounded-2xl bg-brand-pink p-5 sm:grid-cols-5">
            {SHAPE_REFERENCES.map((ref) => (
              <div key={ref.code} className="flex flex-col items-center gap-1">
                <BlotMorph
                  allocation={ref.allocation as unknown as Allocation}
                  size={110}
                  mood="focused"
                  reduceMotion
                />
                <span className="font-mono text-[11px] uppercase tracking-wide text-game-base">
                  {ref.code} · {ref.name}
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Blot moods">
          <div className="flex flex-wrap items-end gap-6 rounded-2xl bg-brand-pink p-5">
            {(["idle", "focused", "locked", "paid"] as const).map((mood) => (
              <div key={mood} className="flex flex-col items-center gap-1">
                <BlotMorph allocation={EVEN_SPLIT} size={120} mood={mood} />
                <span className="font-mono text-[11px] uppercase tracking-wide text-game-base">
                  {mood}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 max-w-2xl text-[13px] leading-5 text-ink-muted">
            idle breathes (brand surfaces only); focused never moves on its own; locked fires
            one heart pulse and one visor blink; paid raises one arm once. Reduced motion
            collapses all of it to stills.
          </p>
        </Section>

      </main>
    </ToastProvider>
  );
}
