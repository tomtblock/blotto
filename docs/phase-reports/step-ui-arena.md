# Step report — UI arena overhaul (master prompt v3, Phase D)

**Scope:** D1 design system · D2 journey screens · D3 retention · D4 quality bar.
**PR chain:** #20 (D1) → #21 (D2) → #22 (D3) → #23 (D4), stacked on the E2/E1 pair (#18, #19).
**State when done:** every screen in the arena idiom, every string real and gate-clean, the
retention surfaces built strictly inside the mastery/standing frame, and the quality bar
green: Lighthouse performance 99 / accessibility ≥ 95 on Play and Pool, the fixture-backend
Playwright journey passing at 375 px and 1280 px.

## Before / after

Committed under `screenshots/step-ui-arena/`:

| Screen | Before (main at #17) | After (this chain) |
| --- | --- | --- |
| Landing 375 | `before-landing-mobile-375.png` | `landing-mobile-375.png` |
| Landing 1280 | `before-landing-desktop-1280.png` | `landing-desktop-1280.png` |
| Pool 375 | `before-pool-mobile-375.png` | `pool-mobile-375.png` |
| Pool 1280 | `before-pool-desktop-1280.png` | `pool-desktop-1280.png` |
| Entry path (fail-closed), rules, verify, profile | — | `play-fail-closed-*`, `rules-*`, `verify-*`, `profile-signed-out-*` |

Before: `TODO_COPY` placeholders on every surface, the predecessor's violet accent, unstyled
bordered lists. After: the arena — navy-black surfaces, Big Shoulders scoreboard face, one
floodlight-blue action accent, one molten-amber prize accent, the seat-ring motif and the
light sweep on live surfaces only.

## D1 — the system (PR #20)

Canonical tokens in `app/src/design/tokens.ts`, mirrored to CSS in
`app/src/styles/tokens.css`, with a parity test that fails when the two disagree (including
"no hex in the CSS that tokens.ts does not know"). Reservation rules are structural: prize
amber = paid amounts only; rarity gold = top-class art only; priceUp/priceDown = win–loss
semantics only; class hues are founder-owned placeholders. Motion is a four-word vocabulary
(reveal / settle / pulse-once / rise) that celebrates and never nags;
`prefers-reduced-motion` collapses all of it globally. Nine components; `/dev/components`
previews everything and 404s in production (journey-asserted).

## D2 — the moments (PR #21)

The nine v3 moments, in screen order, with all copy through `app/src/copy` and zero
`TODO_COPY` anywhere (the placeholder-pinning tests were inverted to enforce absence).
Legal-position anchors kept in place and now asserted by the journey: §8.6 renders above the
enter control; the R9 timer is visible and calm; the 18+/territory line is on the landing
viewport without scrolling at 375 px.

Judgement calls (all marked `PHASE-D2-REVIEW` in code):

- **"Remaining points big"** — the allocation always sums to exactly 100 by construction
  (the pentagon redistributes; it never spends a budget), so a remaining counter would
  permanently read 0. The five stat integers are the hero numbers, with a fixed "= 100"
  invariant marker.
- **"Battles → rank → prize table" reveal** — battle allocations and rank labels live in
  the published bundle (D3-B), not the indexer. The results page stages what is served and
  never invents a rank; the bundle-honest battle view landed in D3 as what-beat-you.
- **`rules.detection`** — R4 requires the criteria stated; the wording is a mechanical
  description of the five implemented signals and the two-signal rule. Founder/counsel may
  re-voice; the substance must stay identical to `backend/detection/src/signals.ts`.

## D3 — retention on mastery and standing (PR #22)

Built: the fixture list with the treasury projection (covered vs short, factually), the
career page (prize-record chart + rivals off `player_history`), post-reveal
**what-finished-above-you** (browser-side decrypt of the post-reveal ciphertexts with the
on-chain secret, re-scored head-to-head by the same engine the crank runs — R20), the
restyled share card, and notifications (factual in-app state changes + a wallet-signed
email opt-in stored by the packet service; the address itself never stored).

Not built, by design, and now CI-enforced: `check-language.sh` gained the v3 do-not-build
vocabulary as `PATTERN_D3` (the seven pressure/chance-framing terms the prompt names; two
were already §8.7) — building a forbidden retention mechanic now trips CI by its own
vocabulary. Nothing in the chain required a stop-and-ask.

`PHASE-D3-REVIEW`: the career chart is the **prize record** (paid outcome per tournament,
on-chain and player-verifiable), not literal ranks — rank labels are deliberately unindexed
per D3-B.

New read surface: `GET /profiles/:player/history`, `GET /profiles/:player/rivals`, and
`GET /pools/:pool/sealed-entries` — the last anonymised by seat and **served only after the
pool secret is on-chain** (403 before; spec-pinned). Post-reveal this exposes nothing the
published bundle does not already carry.

## D4 — the bar (PR #23)

- **Lighthouse** (`app/scripts/lighthouse-gate.mjs`, `npm run lighthouse`, threshold 90 on
  performance and accessibility, production build in fixture mode):
  Play **99 / 96** · Pool **99 / 95**.
  The performance win came from restructuring auth: the provider SDK now loads as a lazy
  client-side bridge feeding the app's own AuthContext (`src/wallet/privy-bridge.tsx`), so
  it left the first-load bundle of every page — before the split, Play scored 68 and Pool
  57. The page tree never remounts when the SDK arrives, and only the bridge file imports
  the SDK (D-08 unchanged).
- **Journey** (`app/e2e/journey.spec.ts`, `npm run journey`, fixture backend, Chromium at
  375 px and 1280 px): 14 checks — the D2 contract assertions above, every public page
  rendering, the production 404 of `/dev/components`, and no horizontal scroll on any
  asserted page. Screenshots regenerate into this report's folder on every run. The
  credentialed seven-battle run remains in `tests/rehearsal/playwright/` — a fixture
  backend cannot sign or pay.
- Two D1-era misses caught here: the Privy modal still carried the predecessor's violet
  (now `#3d8bff`), and the header's sign-in pill failed WCAG contrast (light ink on brand;
  now the dark base ink, like every money button).

## Open items for the founder

- Re-voice any copy: brand voice is founder-reserved; everything ships plain and factual.
  `rules.detection` is the one string counsel should also read.
- The email dispatch vendor (Resend / Postmark / SES — your pick): the signed opt-in store
  and endpoint exist; sending is deliberately not pretended. E5's hosting docs carry it.
- Class hues remain placeholders pending art direction (PID D2).
