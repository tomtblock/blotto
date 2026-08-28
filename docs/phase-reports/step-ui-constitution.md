# Step report — the UI constitution rebuild (Level 3 master prompt)

**Scope.** Full rebuild of the frontend's motion and UI per the founder's Level 3
"Motion & UI Constitution" (2026-08-28): the five-word motion grammar (LIGHT ·
FROST · WEIGHT · WARMTH · TRAVEL), the shared component library (PART 5), and
every page surface (PART 6), with the emilkowalski/skills design-engineering
skill set governing craft (installed at build time via `npx skills add`,
gitignored, excluded from the language gate as third-party tooling — the same
category as `node_modules`).

## What was built

- **Grammar layer** — `app/src/design/grammar.ts` (the word ↔ meaning binding),
  tokens.ts/tokens.css rewritten to three durations (150/250/400ms), exactly two
  curves site-wide (a strong ease-out; a strong ease-in-out), one
  gesture-release spring. Parity pinned by `tokens.test.ts` + `grammar.test.ts`
  (which also asserts no grammar animation loops, and that FROST is the site's
  only blur — implemented as a static pre-blurred veil crossfaded by opacity).
- **Shared components** — three-tier Button (+`buttonClasses` for anchor CTAs),
  SeatRing (64 segments; per-real-entry fill sweep, one LIGHT pass, digit
  slide, "+1 entered" riser; WARMTH resting glow = true occupancy; polite
  aria-live), PentagonMini (+field-overlay), Frost, EntrySplit (the 80/20
  TRAVEL, integer-lamport amounts, labeled endpoints, once-per-view), winners
  cards + drift, SettledCounter + DigitSlide, Skeleton, ErrorSurface, Sonner
  toasts. Dev gallery covers all of them with state-driven demos.
- **Pages** — landing (hero explainer driven by one progress value:
  scroll-scrubbed / autoplay / static three-panel under reduced motion; proof
  band; live door), lobby + pool page (LivePoolRing polling real entries,
  digit-crossfade countdown with a final-hour tone shift only), gate
  (near-silence; tick draw-in; WEIGHT stamp on the recorded acceptance),
  allocation screens (charge feedback strictly rate-of-change; keyboard path
  with identical normalisation; lock-in stamp→frost→slide; arc timer), review
  (frosted cards, owner-only de-frost) and the sealed confirmation (split +
  live ring + quiet pass card), results cascade, Verify instrument panel
  (?pool deep links), profile (badge case, film room, footer ring), fair-play
  page (mini explainer, entry split, FROST lifecycle, per-section Verify
  links).

## Judgement calls and open flags (founder attention marked ⚑)

1. **Landing act order.** The constitution reads explainer → proof → door; the
   ratified v3 D2 contract (e2e-asserted) pins the 18+/territory line and the
   one enter CTA into the first mobile viewport. The page therefore runs
   door → explainer → proof. Cold-visitor test still passes.
2. ⚑ **Per-screen timer.** The constitution's 6.4 says "~10-second timer"; R9
   ratifies 15s and the copy says fifteen seconds. 15s kept — the number is
   founder-owned with published consequences. Say the word if 6.4 was meant as
   a change.
3. **"Winners drift".** The constitution's own name for the drifting row of
   completed tournaments contains a PID §8.7 word; the language gate is law
   (constitution PART 3.1), so component, classes and copy say "drift".
4. **Verify row colours.** 6.7 asks for rows settling "amber → green"; prize
   amber is reserved for paid amounts by the ratified token rules, so rows
   settle dim-ink → the verdict green (LIGHT unchanged). Reservation rules
   outrank a page's palette note.
5. **WARMTH's hue** is the brand floodlight, not amber, for the same
   reservation reason — the room warms with the arena's own light.
6. **Entry-time reveal theatre deleted.** The predecessor's tap-to-crack
   sequence (beat machine, jolts, fragments, shell, count-up, their tests and
   the stage-discipline source scan) is gone per 6.5/6.6: the entry moment is
   sealed → 80/20 split → live ring, with the pass as a quiet material-finish
   card afterwards (rank-before-rarity; the top class's sheen is hover-driven
   only). The stall/failed/retry lifecycle survives in the new host;
   `stage-discipline.test.ts` was removed WITH its subject, deliberately.
7. ⚑ **Fair-play naming.** The former "Rules" page is retitled "Fair play &
   availability" per 6.9 (short link form: "Fair play"); the e2e heading
   assertion was updated deliberately. Title wording is founder-reserved —
   ratify or re-voice. The ratified D-B6 section ORDER is kept (6.9's ordering
   differs slightly); the three instruments are interleaved instead.
8. **Badge case.** Placement derives only from committed amounts equal to an
   exact prize band (bigint-exact; tie splits shown as "shared placement",
   never rounded to a rank) — rank labels stay bundle-only (D3-B). The
   constitution's "consistency" badge is omitted: its name is D3-gate
   vocabulary and no honest source exists for it.
9. **Winners cards carry no date** — the read API has no settled-at timestamp.
   Add one to the indexer if dates are wanted; the card will not invent one.
   Likewise Act II's optional "refunded from unfilled pools" counter is
   deferred until an indexer aggregate can state it exactly.
10. **Act II paid-to-date** = Σ `pot_lamports` over Paid pools (bands sum to
    exactly 1024, so a Paid pool has paid its whole pot) — zero extra
    requests, recomputable by anyone.

## Definition-of-done evidence (PART 7)

- Language gate + standing rules clean on every commit; the gate caught and
  forced two renames during the build (the drift, and a variable in the badge
  case) — working as designed.
- Mechanical animation audit: no `transition: all`, no bare ease-in, no
  `scale(0)` entrances, no layout-property animation. Idle-motion inventory:
  the wait spinner, the skeleton breathe (period 1.4s), the winners drift
  (constant, pause-on-hover/touch, ≥3 real cards, off under reduced motion),
  and charge particles that exist only while a gesture raises a value.
  Every hover transform is gated behind `(hover: hover) and (pointer: fine)`.
- Reduced motion: global collapse plus per-component branches (explainer →
  static panels; TRAVEL → settled diagram with both endpoints labeled; ring →
  correct fill and static glow).
- Perf budget: scripted pentagon drag at 4× CPU throttle on the dev build:
  58.8fps average, p95 16.8ms, 5/346 frames over 20ms (production build is
  faster).
- e2e journey suite green throughout (14/14; one assertion updated with the
  fair-play rename). Unit suite green (161 tests; the deleted reveal-machine
  suites left with their subject, `profile/insights` and `grammar` suites
  added).

---

# Founder round 2, 2026-08-28 (post-preview review)

Nine items from the founder after looking at the deployed preview. What
changed, and what is a configuration answer rather than a code one.

## Copy and layout

1. **The hero line is three lines**, and the middle one is no longer "Seven
   battles" — it read as seven opponents rather than seven decisions. It is
   now "Choose Your Fighters." in the founder's own capitalisation, carrying
   the action accent. `COPY.shell.taglineLines` renders them; the flat
   `tagline` survives for the document title. The journey suite asserts the
   three lines individually.
2. **The countdown is gone from the landing hero.** It remains on the pool
   page, where a fill deadline is a fact a player is deciding against. ⚑ Say
   if it should come off there too.
3. **The five-step list under the explainer is gone.** Its facts did not
   vanish with it: the explainer now carries a FOURTH caption ("Top sixteen
   are paid") on the beat that shows the rankings settling, and the reduced-
   motion fallback grew to four panels for parity. The operator's 20% and
   the refund rule are stated in the proof band below. The cold-visitor
   checklist (PART 7 #9) still passes.

## Motion

4. **The captions are title cards now**: 28–34px display face over a 15–16px
   body, entering from the right over 250ms ease-out and leaving to the left
   over 150ms — bigger, clearer, sliding on and off as asked. Fixed height,
   so nothing below them shifts. Classified as micro-feedback, not a grammar
   word; the scene beneath still owns the grammar.
5. **"More exciting" was answered with scale and hierarchy, not loops**:
   arena-scale hero type, a static floor glow under the open door (depth,
   never motion), the prize pool at moment size in prize amber, the
   1st-place figure and "16 of 64 paid" beside it, a bigger seat ring, and
   the pentagon line promoted to a statement. No idle motion was added —
   the constitution's own ban still holds.

## The two bugs

6. **The geofence was the product lying, and that is fixed.** `checkGeoGate`
   answered 'blocked' for BOTH a real territory verdict and its own
   inability to ask, so a missing entry-API URL, a service that is down, or
   a CORS failure all told the player their region was blocked. It now
   answers 'unavailable' for its own failures — still fail-closed, entry
   still shut, but the panel says the location could not be checked and
   offers a retry. Only an explicit `{allowed:false}` is reported as a
   block.
   ⚑ **The founder's actual cause is configuration, not code**: the
   territory schedule blocks only BE and AU, so the block came from the
   gate's own failure. `NEXT_PUBLIC_ENTRY_API_URL` must be set on the
   deployment AND the packet service must be reachable from the browser
   (it also refuses to start without a geo lookup configured —
   `GEO_VENDOR_URL` + `GEO_VENDOR_API_KEY`, or the dev stub). The new panel
   now names which of those is happening.
7. **Social sign-in failed silently; now it says so.** The call itself is
   correct against the installed SDK (`login({loginMethods:[provider]})`
   type-checks against @privy-io/react-auth 3.37.0). What was missing was
   any handling of failure: `useLogin`'s `onError` is now wired through the
   Auth seam as `lastAuthError` (a deliberate cancel is excluded), the
   comparator behind the update-loop guard compares it so the state
   propagates, and the sign-in page renders an honest line in place.
   ⚑ **The cause is again configuration**: wallet connect is client-side and
   works, while Google/Apple/X need the provider enabled for the app AND
   the site's domain allow-listed with the provider. Both are dashboard
   settings.
   *Landmine removed on the way past*: `PrivyErrorCode` is a TYPE-ONLY
   export of that package — importing it as a value type-checks and then
   throws in the browser. The cancel code is compared as its documented
   literal instead.

## The legal pages

8. **`/privacy` and `/terms` exist**, linked from the landing legal line,
   the fair-play page, and — new — the clickwrap itself, which until now
   asked players to accept terms it did not link to.
   ⚑ **They are marked DRAFT and are not counsel-reviewed.** Every clause
   states a mechanic this repository implements (the code path is named in a
   comment beside it); everything only counsel can supply — operating
   entity, contact route, retention schedule, named sub-processors,
   liability, governing law, dispute process — renders as an explicit "not
   yet set" chip rather than a plausible invention. One flag,
   `LEGAL_DRAFT` in `src/copy/legal.ts`, removes the banner when they are
   signed off. Both pages pass the §8.7 language gate.

## Evidence

Language gate and standing rules clean; typecheck, lint, 163 unit tests,
production build and 14/14 journey tests green. One real regression was
caught by the suite on the way (the hero's floor glow overflowed the page
gutter at 375px) and fixed before commit.
