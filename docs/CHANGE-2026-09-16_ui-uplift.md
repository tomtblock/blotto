# UI uplift — founder feedback 2026-09-16 (back pages · homepage locks · pool card · pool page rails · the blender seal)

**Produced:** 2026-09-16 evening, on `claude/clever-rubin-uyyns0` from `fb56dbb` (the merge of #135).
**Status of this document:** §A is the PLAN, written for the founder's approval and then handed to an
executor agent running unattended overnight. §B is the REPORT the executor appends when the work is
done. Until §B exists, nothing below has shipped.
**Scope:** the founder's feedback doc of 2026-09-16 (Drive folder `1jozpFVHqmAUFzPTlkHcrqELu9FjHqijn`,
"Feedback" plus seven reference screenshots) and the four rules that came with it. Nothing here
touches the program, the backend, `config/*.json`, any PID value, the dial rule, or the entry path.

---

# §A — The plan

## A0. The headline, in plain language

Eight asks. Seven are built tonight. One — a red flashing seal button — is built as a two-tone switch
with pink as the default, and the founder flips it in the morning if they still want red (A3, D3).

Three things the feedback did not ask for but the work found:

| Found | Why it matters | What the plan does |
|---|---|---|
| The dial lock the founder wants on the homepage **already exists** in the machine (`StatDials`, `rebalanceLocked`, founder 2026-09-13). The landing demo simply never passes it in | The ask is a wiring change, not a feature. `rebalance.ts` and `allocation.ts` are not touched, so the frozen §F-21 drag table stands | A4 |
| The moment "the transactions are signed" is **observable outside `app/src/entry/**`**: the signer object is handed in by `play-client.tsx`, so a thin observer wrapped around it reports `message-signed` and `transaction-signed` without the entry path knowing | The blender can start on the real event, and the seal-lockout code under test tonight is never edited | A8 |
| The founder's Blott source clips and the two character reference stills are **already in the Higgsfield account** as reusable media ids (the hero montage and every pose sprite were made from them) | New loops can reference the exact same character and material, and the pool card can reuse an existing clip for zero credits | A10 |

The four rules the founder set are hard constraints on the executor (A12): the dial logic and the
entry path are read-only; nothing is deployed to blotto.gg; the work stays on this branch.

**On the reference images.** The Drive connector lists all seven and returns their text, but not
their pixels, and the direct download is behind Google sign-in. Rather than stop, the plan was built
from full-resolution renders of the same screens (the app in fixture mode at 1440, 1024 and 390, and
at 90 % zoom), the founder's flow mockups in `docs/design/flows/`, and the Blott reference stills.
The one thing this cannot see is a hand-drawn mark on a screenshot; if any image carried one that
changes an ask, the founder should say so in the morning and it is a small correction.

## A1. Ground truth on the branch (verified, not assumed)

- **"The glowing box style of Blotto Cup"** is `.cab-marquee` in `app/src/components/blot/cabinet.css`:
  a cream-to-yellow backlit plaque, 2 px pink ring, yellow outer glow, berry uppercase display word
  with a yellow text-shadow. **"The boxing on the pink background"** is `.cab`: a plum panel with a
  triple pink neon ring and a berry drop, standing on `bg-brand-pink`. Both are tokens-only recipes.
- Back pages today: `/rules`, `/fair-play`, `/verify`, `/custody` render on the plum `base` with a
  plain `PageIntro` h1 and plain h2 sections (`app/src/app/{rules,fair-play,custody}/page.tsx`,
  `verify/verify-client.tsx`). The journey lane asserts the h1 text on each (`app/e2e/journey.spec.ts`
  lines 89–98): `Rules`, `Who holds which keys`, `Verify a pool`. Heading TEXT must not change.
- Locks: `StatDials` takes `locks` + `onToggleLock` and renders the padlock column; `rebalance()` is
  literally `rebalanceLocked(alloc, k, target, NO_LOCKS)` (`rebalance.ts:48`). `LiveDemo.tsx` calls
  `rebalance` and passes no locks.
- The homepage "Open now" card is the reference "Pool Card" (OCR: OPEN NOW · OF 64 · PRIZE POOL · 4
  SOL · POOL CLOSES FOR ENTRIES IN). It lives inline in `app/src/app/page.tsx` (~lines 200–245).
- The pool page `app/src/app/pools/[pool]/page.tsx` is the reference "Enter Pool": `Verify this pool`
  sits in the header `ml-auto`; the §8.6 line renders above the Enter link (legal requirement — keep).
- The seal screen is the `review` phase of `app/src/battle/components/battle-flow.tsx` (~lines 388–
  455): crescendo heading, `SevenTiles`, `Playground`, the `SealLock` card, then the TWO-STEP seal
  (arm → confirm) with `COPY.pool.decisionsFinal` above BOTH controls (PID §8.6 — keep both steps and
  both lines). `dispatch({type:'confirm'})` → `onConfirm` → `startSubmit` → `RevealHost` takes the
  screen (`play-client.tsx:519`) with beats `entry` (a `PendingPanel`) → `card` (`PassCard`) or
  `failed` / `stalled`; `SettledExit` hands back `entered | pending | not-entered`.
- The signing order inside the (read-only) entry path: `putCiphertext` → `requestPacket`
  (`signer.signMessage`, the Privy "Sign message" iframe in the reference image) → `sendRegister` →
  `executeTrade` (`signer.signTransaction`, then `rpc.sendTransaction`, then confirmation). The
  signer is built in `play-client.tsx` `startSubmit` and passed to `makeLiveEntryServices({signer})`.
  `TxSigner` (`app/src/tx/types.ts`): `address`, `kind`, `label`, `signTransaction`, optional
  `signMessage`.
- The refusal copy at `app/src/copy/index.ts:524` (`tx.entryRefused`; the founder's "line 508" moved
  with #135) is mapped for the generic `entry-refused` failure in `app/src/tx/errors.ts:162`. The
  ciphertext store's 409 "already sealed" (one seal per wallet per pool — `battle-test/LOG.md`
  2026-09-16 00:19) surfaces through the same string, which is why it points at the Rules page.
- Video convention: `HeroClip` (mp4 + webm sources, poster, muted/loop/playsInline, poster-only under
  reduced motion) and the step loops under `app/public/motion/landing/steps/` (mp4 + webm + jpg).
- Fixture mode: `next dev` with no indexer URL serves `src/data/scenarios.ts`; the open pool is
  `/pools/F1XTUREPoo1111111111111111111111111111111111`. `/play` stops at the geo gate in fixture
  mode, so the seal screen is exercised by unit tests and by the founder's devnet review, not by the
  journey lane.
- Tooling verified in this sandbox: the app builds and serves on `:3005` after installing the seven
  backend sibling packages; a screenshot harness (`playwright-core` + the installed Chromium 1194)
  captures every page at 1440 / 1440 @ 90 % / 1024 / 390; `ffmpeg-static` 7.0.2 with libx264 and
  libvpx-vp9 installs and runs; Higgsfield result URLs (`d8j0ntlcm91z4.cloudfront.net`) are
  fetchable with curl; Higgsfield balance 2,926 credits; cost preflights: `gpt_image_2_5` still = 1
  credit, `minimax_h3` 8 s 16:9 at 2K = 16 credits, `flux_3_video` 8 s 1080p = 72 credits.

## A2. Desktop looks better at 90 % — what is actually wrong, and the fix

At 1440 wide every page is a phone layout scaled up: the header centres its wordmark in a 448 px
box (`max-w-md`), content sits in a 768 px column, the tab bar is a bottom-fixed phone bar, and the
display sizes were tuned for 390 px. At 90 % the same layout simply takes less of the screen, which
is what the founder is seeing.

**Recommendation (D1, default):** ship the literal observation as a standard CSS rule, plus the one
structural fix that is obviously safe.

```css
/* app/src/app/globals.css — desktop scale (founder 2026-09-16) */
@media (min-width: 1280px) and (pointer: fine) {
  html { zoom: 0.9; }
}
```

and `AppHeader`'s container `max-w-md` → `max-w-md lg:max-w-5xl lg:px-6`, so the wordmark lines up
with the content's left edge instead of floating mid-screen.

Why `zoom` and not `transform: scale`: `zoom` reflows layout (standardised in the CSS Viewport
module; Chromium 128+, Safari, Firefox 126+); `scale` does not. Why it is safe for the dials: they
are native `<input type="range">` elements — the browser maps the pointer, no custom coordinate
maths exists to break, and the rule is excluded on coarse pointers anyway. The journey lane runs at
375 and 1280 and asserts text, not pixels.

**Rejected:** (b) a full desktop type scale and a top navigation for ≥ lg. It is the right long-term
answer and is listed as follow-up (§A13); it touches every page in one night before a money test.

## A3. Back pages — `/rules`, `/fair-play`, `/verify`, `/custody`

**The module.** One new presentation component pair, tokens only, in `app/src/components/ui/`:

- `marquee-heading.tsx` + `marquee.css`: `<MarqueeHeading as="h1"|"h2" id status?>` — the
  `.cab-marquee` recipe copied into `.marquee` / `.marquee-word` / `.marquee-status` (cream→yellow
  backlit plaque, pink ring, yellow glow, berry uppercase display). The heading element is a REAL
  `h1`/`h2` whose accessible name is exactly its text (the journey lane reads it). Sizes: h1 word
  30/34 px, h2 word 20/22 px, 18 px at ≤ 390.
- `neon-section.tsx`: `<NeonSection id heading>` — a plum candy panel (`Card`'s gradient +
  `--elevation-candy`) with the `.cab` triple-pink neon ring and berry drop, 24 px radius, 20–24 px
  padding, `scroll-mt-20`; the `MarqueeHeading as="h2"` sits overlapping the panel's top edge by
  ~14 px like a sign on a cabinet. Body typography unchanged (ink / ink-muted on plum). Tables keep
  their current markup.

Why copy the recipe rather than import `cabinet.css`: the cabinet is the play machine; a shared
class would make a rules-page tweak a play-route change. ~40 duplicated lines, noted as follow-up.

**The pages.** Each becomes: `<div className="bg-brand-pink">` wrapping `<main>` (the landing's
pattern), `PageIntro` gains `tone="marquee"` (h1 in a plaque; back link and lead in berry on pink),
every section → `NeonSection`. Footer and tab bar stay outside the pink wrapper, on plum, exactly as
the landing does.

- `/rules`: `rulesSections()` map → `NeonSection` per section; the tier table and the availability
  list unchanged inside. `PageIntro back` stays.
- `/fair-play`: the local `Section` helper → `NeonSection`. The skill table keeps `data-testid`.
- `/verify`: `VerifyClient`'s h1 (line 166) → `MarqueeHeading as="h1"`; its "How to use this page"
  h2 → marquee; the form and report `Card`s already read as plum boxes on pink.
- `/custody`: same treatment. **Keep it public (D4, default).** It is the C13 custody disclosure the
  Fair-play page promises ("See who holds which keys, and what each cannot do") and one of the three
  "look for yourself" pages; every value on it is public on-chain anyway. Hiding it trades away
  checkability (tradeoff order #3) for nothing. Unset values already render "not yet set".

Mobile: plaques wrap; panels go edge-to-edge with 16 px gutters; no horizontal scroll (the tier
table keeps `overflow-x-auto`).

**Done when:** all four pages render on pink with marquee headings and neon panels at 390 / 1024 /
1440; every journey assertion on them passes; contrast: berry on cream ≥ 10:1, ink on plum ≥ 10:1.

## A4. Homepage practice machine — the lock

`app/src/components/landing/LiveDemo.tsx` only:

```ts
const [locks, setLocks] = useState<Locks>(NO_LOCKS);
// onDrag:      setTarget((a) => rebalanceLocked(a, k, t, locks));
// onToggleLock: setLocks((l) => l.map((v, i) => (i === k ? !v : v)));
// onEvenSplit:  setTarget(EVEN_SPLIT); setLocks(NO_LOCKS);   // rule 4 of CHANGE-2026-09-13 §4
```

Pass `locks` and `onToggleLock` to `StatDials`; the padlock column, the shaded unreachable range,
`aria-valuemax`, and the `locksHint` line all appear with no CSS work. No clock on the landing, so
the lock-starts-the-clock rule (§6.3) does not apply here. `rebalance.ts` and `allocation.ts` are
not opened. Copy: `landing.demoHint` gains one sentence about the padlock as a `PHASE-N-REVIEW`
proposal (A11).

Test: a journey step on `/` — `lock-0` is visible, pressing it disables the Strength dial
(`aria-valuetext` reads "Strength is locked"), Even split re-enables it.

## A5. Homepage pool card — a looping Blott

The "Open now" card in `app/src/app/page.tsx` gains a video well: at ≥ 640 px a rounded (20 px)
window on the card's right, ~40 % of the card width, aspect 4:3; below 640 px a 16:9 band across the
top of the card. The well is masked into the plum (`mask-image: linear-gradient(...)` on the side
facing the numbers; a berry inner shadow) so the clip sits IN the card rather than on it. Numbers
never share the frame with the Blott (tokens.ts: the prize amount and the Blot are both yellow and
must never be in one frame) — the well is its own frame.

Playback: extract `HeroClip` into a general `AmbientClip` (same props, plus `playWhenVisible`): the
card clip plays only while ≥ 60 % in view, and the hero reel pauses while ≤ 20 % visible, so the
"one ambient loop per viewport" rule holds during the scroll (`PHASE-N-REVIEW`: the two can overlap
for a beat mid-scroll). Poster-only under reduced motion.

Asset (D7, default): choose from the founder's existing clips in the Higgsfield library
(`show_generations type=video`; the 4K results of 2026-09-09 are the hero-montage series), pick the
one that loops cleanly, trim to a loop point with a 400 ms crossfade, encode to
`app/public/motion/pool/blott-card.{mp4,webm,jpg}` at 720 px, ≤ 1.5 MB per format. Generate a new
one (A10 prompt P1) only if no existing clip loops cleanly.

## A6. Pool page — yellow field, conveyor rails, a page that wants you in

**Field colour (D2, default = as asked, with a caveat named).** The page wraps in
`bg-brand-yellow` with berry text. The caveat: `tokens.ts` reserves yellow-as-prize for amounts a
player is paid, and the v4 brand layer names hot pink as THE page surface. A yellow page does not
break the reservation — every number stays on plum cards, the prize amount stays the only yellow
object inside a card — but it does spend some of yellow's exclusivity. If the founder would rather
keep pink and let yellow stay the celebration colour, it is one class name.

**Layout at ≥ 1024 px:** three columns — left rail · centre column (`max-w-2xl`, the existing
content) · right rail. Each rail is `position: sticky; top: 56px; height: calc(100vh - 56px)`, holds
ONE portrait loop (`AmbientClip`, 9:16), masked top and bottom and toward the centre so the belt
reads as running INTO the page behind the card. The right rail is the same asset with
`transform: scaleX(-1)` — the two belts converge on the centre where the Enter control is, and the
page ships one video, not two. Below 1024 px: no rails; one 16:9 strip (the same clip, cropped) sits
between the header and the pool card, 140 px tall, masked.

**Content:** marquee h1 (`Pool #15` + the state pill), the fixture `Card` unchanged, the three rule
paragraphs move into a `NeonSection` (heading text proposed under A11), §8.6 line + Enter control
unchanged and still last.

**Verify link (D5, default = hide while Open).** `/verify` recomputes a result from the published
bundle and the on-chain record; an Open pool has neither, so today the link leads to "nothing to
check yet". Render it only when `!open` (Sealed, Scored, Paid, Refunding, Closed). While Open the
page already says what is verifiable and when.

**Done when:** rails play on desktop, mirror correctly, are poster-only under reduced motion; the
journey assertions on the pool page pass (prize pool text, no table, the §8.6 line, the Enter link).

## A7. Copy — the refusal that points at the wrong explanation (D6)

`COPY.tx.entryRefused` today: "… Trying again will not change the answer — the Rules page explains
who can enter, and you can ask us about your own entry." For a wallet locked out by the 409 (a first
attempt stored its ciphertext; the retry is refused before anything is signed) that is accidentally
true and points at eligibility, which is not the reason.

Proposed wording, `PHASE-N-REVIEW`, correct for both the eligibility decline and the lockout, and
still generic as PID §8 requires:

> This entry was not accepted, so nothing was signed and nothing was charged this time. Trying
> again will not change the answer. If this wallet already made one attempt at this pool, that
> attempt is the one that stands — the pool page shows whether a seat was taken, and you can ask
> us about your own entry.

The 409-specific sentence stays a proposal in §B unless the founder's own "part 4" lands first; if
it does, the executor leaves this string alone. No file under `app/src/entry/` is touched to tell
the two cases apart.

## A8. The seal — the blender

**The journey the founder described, mapped onto the code that exists:**

| Beat | What the player sees | Where it comes from |
|---|---|---|
| Seven made | Full-width scene: seven Blotts of varying proportions ride a conveyor in from the back and drop off its end into a big glass blender (looping). Under the scene: the seven tiles (the player's record), then the §8.6 line, then a big **SEAL MY ALLOCATION** button on the blender's base | `battle-flow.tsx` review phase; the scene is a new `SealStage` |
| Armed | The button becomes **Confirm — seal and submit** with **Go back**; §8.6 line above it again; the blender lid lowers, a slow glow pulse on the button | `sealArmed` (unchanged two-step seal) |
| Confirm | The Privy "Sign message" iframe opens OVER the scene; the belt keeps running behind it | `dispatch confirm` → `onConfirm` → `startSubmit`; the modal is Privy's |
| Message signed | Lid locks with a soft clunk of light | observer: `signMessage` resolved |
| Transaction signed | **The blender runs**: the Blotts churn into glossy yellow, the jar fills, while the network confirms. Status line: "Sealing your battles…" then "Confirming your entry with the network…" | observer: `signTransaction` resolved; `RevealHost` beat `entry` |
| Confirmed | The blend settles, the stage fades, the pass card rises (the existing `PassCard`), then `SealedPanel` | beat `card` → `SettledExit('entered')` |
| Failed / stalled | The belt stops; the blender does NOT run (nothing landed); the existing failure or stalled copy and the retry/dismiss controls render over the scene; retry rewinds to "Seven made" | beats `failed` / `stalled` |

**Architecture (UI only; `entry/**` and `battle/machine.ts` untouched):**

1. `app/src/app/play/seal-stage.tsx` + `seal-stage.ts` (pure): a stage phase reducer
   `made → armed → signing → locked → blending → done | failed`, events `arm | disarm | confirm |
   message-signed | transaction-signed | confirmed | failed | retry`. Rendered as a fixed
   full-viewport layer under the content (`position: fixed; inset: 0; z-index` below the header),
   holding two clips: `blender-idle` (seamless loop) and `blender-run` (one-shot, holds its last
   frame), crossfaded 300 ms at the switch; a `blender-done.jpg` poster; poster + CSS glow only
   under reduced motion. The stage is mounted by `play-client.tsx` from the moment `BattleFlow`
   reports `review` (a new optional `onReview` callback, one line in `battle-flow.tsx`) until the
   `card` beat, so it survives the `BattleFlow → RevealHost` swap that would otherwise unmount it.
2. `app/src/app/play/observed-signer.ts` (pure, tested): `observeSigner(signer, on)` returns a
   `TxSigner` that delegates by method call (never by spread — a wallet adapter may be a class
   instance), keeps `signMessage` undefined when the source has none (fail-closed, as today), and
   reports `message-signed` / `transaction-signed` after each resolves. `startSubmit` wraps the
   signer it already has before `makeLiveEntryServices({ signer })`. Nothing else changes.
3. `RevealHost`'s `entry` beat renders a slim status line instead of the `PendingPanel` when a stage
   is present (prop `quiet`); the blender IS the in-progress indicator. `stalled`, `failed`, `card`
   render as today, over the stage.
4. `battle-flow.tsx` review phase: `Playground` is replaced by the stage's presence (the Blotts are
   in the scene now); `SevenTiles`, the `SealLock` card, the §8.6 lines and the two-step buttons
   stay, restyled onto the blender base (`Button size="lg"` full width, `h-16`, `.key-action`).

**The button colour (D3).** The founder asked for a big flashing red button. Recommendation: the
action pink, oversized, with a slow 1.2 s glow pulse until pressed. Reasons: `tokens.ts` reserves
red (`priceDown`) for loss semantics only, and `button.tsx` makes the action pink "the colour a
player learns for 'this spends'" — the seal is the one step that spends; and "flashing" on a money
step reads as alarm (WCAG 2.3.1 caps flashes at three per second regardless). Built as a single
constant `SEAL_KEY_TONE: 'action' | 'red'` so the founder can flip it in the morning; if flipped,
the exception is recorded beside the reservation in `tokens.ts`.

**Sealing guard.** The scene's Blotts are generic — seven varied silhouettes from the prompt, never
derived from the player's allocation. A Blott's silhouette IS its allocation (`warp.ts`; the leak
closed on 2026-09-13), so the stage reads `review.battles` for nothing.

**Tests:** `seal-stage.test.ts` (every transition, failure rewinds to `made`, `confirmed` only from
`blending` or `locked`), `observed-signer.test.ts` (delegation, event order, fail-closed
`signMessage`, rejection passes through untouched). Existing `machine.test.ts` and
`reveal/machine.test.ts` unchanged and green.

**Done when:** the founder can run the devnet flow on the PR preview and see: scene → sign → lid →
blend during confirmation → pass card, with no new copy on screen beyond the proposals in A11.

## A9. Figma — prototype before code, time-boxed

Create `Blotto Cup — UI uplift 2026-09-16` (Design, plan `team::1669240224739880472`, the founder's
one plan) after loading `figma-create-new-file`, `figma-use` and `figma-generate-design`. Frames:

1. Back-page module — marquee heading + neon section on pink, 1440 and 390.
2. `/rules` composed, 1440.
3. `/pools/[pool]` with rails on the yellow field, 1440 and 390 (strip variant).
4. The seal stage in five states (made · armed · signing · blending · done), 1440 and 390, with the
   generated stills placed (`upload_assets`).
5. The homepage card with the video well, 1440 and 390.

Tokens from `app/src/design/tokens.ts` as variables. Time-box 75 minutes, after the stills exist
and before A6/A8 code. If the Figma MCP fails or rate-limits, note it in §B and continue — the code
is the deliverable; the file is the founder's morning review aid.

## A10. Higgsfield — assets, prompts, budget

**Reference set (already in the account; use as medias, never re-upload):**
- character stills, role `image` / `image_references`: `e9f687e5-d07f-4837-bce9-4d48a1c99e0c`,
  `7ebafb7a-dfa9-48c7-8a41-e9a669d85445` (the founder's two Blott-in-a-display-case frames);
- a source clip, role `video_references` where the model accepts one:
  `7cef8e35-c04d-4e96-a779-da2b166b3f41`.

**House prompt base** (the wording the founder's own pose pipeline uses): *"the identical original
toy character from the reference images: a plump inflatable glossy yellow vinyl creature with a
rounded pentagon body, soft stitched seam lines like a beach ball, two small stubby yellow horn
nubs on top, one wide glossy black wraparound visor, a soft pink glowing blush on its belly-face,
short stubby arms and legs, no mouth. Premium 3D render, soft warm studio product lighting with a
gentle pink rim light, ultra sharp, high-end toy photography look. No text, no watermark, no logo."*
Variation is proportion, never colour: *"seven of them of varying proportions — tall and narrow,
wide and squat, top-heavy, one perfectly even."*

**Stills** (`gpt_image_2_5`, 1 credit each, 2 candidates each; the chosen still is BOTH the start
and the end frame of its loop, which is what makes the loop seamless):
- P1 *card*: one Blott idling on a lit disc inside a candy display case, hot pink behind, 4:3.
- P2 *rail*: a pink candy-factory conveyor belt, low three-quarter view, running from the bottom of
  the frame away to a smooth plum wall at the top-centre where it enters a rounded dark slot; plum
  belt, cream rollers, neon-pink light strips; a line of Blotts of varying proportions standing on
  it, evenly spaced; 9:16.
- P3 *strip*: the same scene, belt running left to right into a slot at the right edge; 16:9.
- P4 *blender*: a wide candy-factory scene — the belt enters from the back-centre and runs toward
  the front-left, ending above a giant glossy cream-and-plum blender with a clear jar standing
  centre-right on a hot pink floor; a large round push button on the blender's base (pink; a second
  candidate red, for D3); seven Blotts of varying proportions ride the belt toward the drop; two
  already in the jar looking up; 16:9.

**Videos** (`minimax_h3`, 2K, 8 s, 16 credits each; `start_image` = `end_image` = the still for
every loop; `seedance_2_0_mini` as the cheap fallback; never `flux_3_video` at 72):
- V1 *rail loop* (from P2, 9:16): the belt carries the Blotts steadily toward the wall slot; each
  disappears through it as the next enters from the bottom; constant speed; locked camera; seamless.
- V2 *strip loop* (from P3, 16:9): same, left to right.
- V3 *blender idle loop* (from P4): the belt runs; Blotts ride forward and hop off the end into the
  jar one at a time; the jar's contents bob; lid open; locked camera; seamless.
- V4 *blender run* (start = P4, no end frame): the lid closes, the blender runs at full speed, the
  Blotts churn into a smooth glossy yellow liquid with a pink glow, the jar fills, the machine
  settles and stops; locked camera; ends on a held frame.
- V5 *card loop* only if A5 finds no reusable clip.

Loop check: with ffmpeg-static, compare the first and last frames (SSIM ≥ 0.97); below that, take
the better of two variants or apply a 400 ms tail-to-head crossfade — always seamless in the end.

**Encode** (ffmpeg-static, in the scratchpad, then copy in): H.264 `-crf 23 -preset slow -movflags
+faststart` and VP9 `-crf 33 -b:v 0`, no audio, poster jpg at q 82; rails 720×1280, strips and
blender 1280×720, card 720 px. Budget: ≤ 2.5 MB per file, ≤ 14 MB added to `app/public/motion/`
in total. Files: `motion/pool/blott-card.*`, `motion/pool/rail.*`, `motion/pool/strip.*`,
`motion/seal/blender-idle.*`, `motion/seal/blender-run.*`, `motion/seal/blender-done.jpg`.

**Credits (D9):** expected ~110 (8 stills, 4 loops, 2 variants); hard cap **300**. At the cap, stop
generating, ship what exists, and record the gap in §B. The founder's balance is 2,926.

## A11. Copy proposals — every one marked `PHASE-N-REVIEW` in `app/src/copy/index.ts`

| Key | Proposal | Why |
|---|---|---|
| `landing.demoHint` | "Drag a dial — the other four give way. Press a padlock to hold a stat where it is. Nothing to sign, nothing to pay: this one is just to feel it." | A4 |
| `pool.aboutHeading` (new) | "How this pool pays" | A6 neon section over the three rule paragraphs |
| `tx.entryRefused` | the A7 wording | A7 |
| `battle.sealStageAria` (new, aria only) | "Seven Blotts on a conveyor dropping into a blender; the blender runs once your entry is signed." | A8 accessibility |

Nothing else changes wording. The seal buttons keep `battle.seal`, `battle.sealConfirm`,
`battle.sealCancel`; the holds keep `battle.sealing` and `reveal.confirming`.

## A12. Rules for the executor — read before the first edit

1. **Never edit** `app/src/components/blot/rebalance.ts`, `app/src/battle/allocation.ts`, anything
   under `app/src/entry/`, or `app/src/battle/machine.ts`. Read them freely. If a task seems to
   need a change there, stop that task, note it in §B, and continue with the others.
2. **Never deploy.** Pushes to `claude/clever-rubin-uyyns0` are allowed all night (a branch push
   only creates a Vercel preview; production follows `main`). Never merge, never touch `main`,
   never run a Vercel deploy, never change environment values, never edit `config/*.json`.
3. **Branch (D8).** Stay on `claude/clever-rubin-uyyns0`. Do not open a PR unless the founder's
   approval names the branch to rename to (CONTRIBUTING renames a machine-generated branch BEFORE
   its PR exists); with a name, rename at the very end and open a **draft** PR using
   `.github/pull_request_template.md`, verification evidence filled in.
4. **Copy discipline.** Every new or changed string lives in `app/src/copy/index.ts` with a
   `PHASE-N-REVIEW` comment; never inline text in a component. Heading TEXT the journey asserts
   does not change.
5. **Language gate.** `./scripts/check-language.sh` after every commit; the pattern list is in the
   script. Identifiers, comments and prompts included — the blender *runs*, *churns*, *blends*.
6. **Next.js.** This repo's Next is newer than training data: read the guide under
   `app/node_modules/next/dist/docs/` before Next-specific code (`app/AGENTS.md`).
7. **Do not commit** `app/next-env.d.ts` (rewritten by `next dev`) — `git checkout` it first.
8. **Commit per work package**, message says what and why, ending with the session's attribution.
9. **Credits cap** 300 (A10). Reference medias by id; never upload the Drive files.
10. **When something is unclear**, prefer the smaller change, mark it `PHASE-N-REVIEW`, and write
    it up in §B — never a silent judgement call.

**The run, in order (≈ 11 h):** preflight (baseline gates, dev server on `:3005`, harness "before"
set) → A2 → A4 → A6-verify-link → A7 → A3 (four pages) → A10 stills (batch) → A9 Figma (75 min) →
A10 videos (batch, wait, download, check, encode) → A5 → A6 → A8 → full gates + journey + harness
"after" set → §B written → INDEX row → commit, push.

**Gates before each push:** `npm run typecheck`, `npm run lint`, `npm test` (vitest), `npm run
build` in fixture mode, `npm run journey`, `./scripts/check-language.sh`,
`./scripts/check-standing-rules.sh`, `scripts/check-env-examples.sh` if any env name is read.

**Visual QA:** the harness at `scratchpad/shoot.js` (paths in §B) captures every page at 1440,
1440 @ 90 %, 1024 and 390; six "after" captures go to `docs/design/uplift-2026-09-16/` as JPEG
≤ 300 KB each for the founder's morning review.

## A13. Deliberately not done tonight

- The full desktop type scale and a desktop top navigation (A2 (b)).
- Making `Cabinet` consume the shared marquee classes (A3) — a play-route change.
- A verify-page mode for OPEN pools (checking the sealing key and entry hashes) — a real feature,
  not a link.
- The 409-specific refusal string (A7) — waits on the founder's part-4 fix.
- Restyling `/pools` (the list) and `/profile` — not asked.

## A14. What the founder decides (defaults apply if the approval says nothing)

| # | Decision | Default | Alternative |
|---|---|---|---|
| D1 | Desktop scale | `zoom: 0.9` ≥ 1280 + header width | full desktop type scale (follow-up) |
| D2 | Pool page field | brand yellow, as asked | keep pink |
| D3 | Seal button | action pink, slow glow pulse | red (recorded exception) |
| D4 | `/custody` | keep public, restyled | unlist from the footer |
| D5 | Verify link on an Open pool | hidden while Open | keep |
| D6 | `tx.entryRefused` | A7 wording, `PHASE-N-REVIEW` | leave for part 4 |
| D7 | Pool-card clip | reuse an existing library clip | generate new |
| D8 | Branch / PR | stay on the working branch, no PR | name the branch; draft PR at the end |
| D9 | Credits cap | 300 | — |

---

# §B — The report

**Produced:** 2026-09-16 evening, unattended, on `claude/clever-rubin-uyyns0` from `a56ac9a` (the
plan) — nine code commits, `3ed949c` through `bfdc1fa`, then one docs commit carrying this report, the
`docs/INDEX.md` row and the review captures. The founder approved §A with every default (D1–D9) at 19:58 UTC.
**Status:** built and on the branch; nothing deployed, nothing merged; no PR opened (D8: the branch
keeps its machine name until the founder names the real one). Every new or changed string is a
`PHASE-N-REVIEW` proposal in `app/src/copy/index.ts`. The dial rule, the entry path and the run
machine were not opened for editing.

## B0. The headline

Seven of the eight asks are built; the eighth (a red flashing seal button) is built as a one-line
switch with pink as the default (D3, `SEAL_KEY_TONE` in `app/src/app/play/play-client.tsx`).
Four loops and one one-shot clip were generated in the founder’s Blott style and closed into seamless loops;
a Figma file holds the prototype frames; the local gates and the journey lane are green.

Two things worth reading first:

| Found | What was done |
|---|---|
| The run clip's first generation drifted its whole palette to teal — unusable behind a crossfade from the pink scene | A second still pins the END frame (the full jar, lid on, empty belt, same pink room); the run was regenerated with both frames pinned. §B3 |
| `seal-stage.ts` and `seal-stage.tsx` cannot coexist — the `.ts` wins module resolution | The machine is `seal-stage-machine.ts`; the component keeps `seal-stage.tsx` |

## B1. What was asked, and what was done

| # | The ask | Done | Where |
|---|---|---|---|
| 1 | Desktop looks better at 90 % | `zoom: 0.9` at ≥ 1280 px with a fine pointer; the header's container widens to the landing column at lg | `app/src/app/globals.css`, `components/shell/app-header.tsx` |
| 2 | Back pages: the boxing on pink, headings as the glowing Blotto Cup box | `MarqueeHeading` + `NeonSection` (the cabinet's two recipes, copied, tokens only); `/rules`, `/fair-play`, `/verify`, `/custody` on the pink field; heading text unchanged | `components/ui/marquee.css`, `marquee-heading.tsx`, `neon-section.tsx`, `page-intro.tsx`, `back-link.tsx`, the four pages |
| 3 | Is `/custody` necessary on a public URL | Kept public, restyled (D4): it is the C13 disclosure Fair play promises, and every value on it is on-chain anyway | `app/src/app/custody/page.tsx` |
| 4 | The lock on the homepage dial | The machine's existing padlocks wired into the landing demo; Even split clears them; no clock, so a lock starts nothing; `rebalance.ts` and `allocation.ts` untouched | `components/landing/LiveDemo.tsx`; journey step in `e2e/journey.spec.ts` |
| 5 | A looping Blott in the pool card | A 4:3 well on the right (a 16:9 band on top below sm), masked into the plum; `AmbientClip` with play-when-visible keeps the one-loop-per-viewport rule; the hero pauses once mostly scrolled away | `app/src/app/page.tsx`, `components/ui/ambient-clip.tsx`, `public/motion/pool/blott-card.*` |
| 6 | Pool page: yellow, dynamic, conveyor rails converging on Enter | Yellow field (D2, caveat kept: every number stays on plum); two sticky rails from ONE portrait loop, the right one mirrored; a strip below lg; marquee title; the rule paragraphs in a neon box; §8.6 line and Enter unchanged and last | `app/src/app/pools/[pool]/page.tsx`, `pool-page.css`, `public/motion/pool/rail.*`, `strip.*` |
| 7 | Is "Verify this pool" needed on an open pool | Hidden while Open (D5): the Verify page recomputes a result from a bundle an open pool does not have yet | `app/src/app/pools/[pool]/page.tsx` |
| 8 | The success page: seven Blotts on a conveyor into a blender; a big button on its base; the Privy prompt; the blender runs once signed, while the network confirms; then the new page | The seal stage (§B2): belt loop → the two-step seal on the blender's base → the Privy prompt over the scene → lid on the message signature → the blender runs on the transaction signature → the pass card over the settled jar | `app/src/app/play/seal-stage*.{ts,tsx,css}`, `observed-signer.ts`, `play-client.tsx`, `reveal-host.tsx`, `battle/components/battle-flow.tsx`, `public/motion/seal/*` |
| — | Copy line 508 (`tx.entryRefused`) | Reworded so it is true for the eligibility decline AND the ciphertext-store 409 lockout, still generic, pointing at the pool page (D6, `PHASE-N-REVIEW`) | `app/src/copy/index.ts` |

## B2. The seal stage — how it is wired, and why nothing forbidden moved

- **`seal-stage-machine.ts`** (pure, 17 tests): `made → armed → signing → locked → blending → done`,
  with `failed` reachable from any in-flight phase and `retry` / `reset` back. `sealStageVisual`
  is the only thing the component reads: which clip, whether the belt runs, whether the lid is
  down, whether the key pulses. The blender runs ONLY on `transaction-signed` — the founder's
  "once the transactions are signed" — and a failure from any in-flight phase stops the belt and
  never blends (nothing landed, so nothing was blended).
- **`observed-signer.ts`** (3 tests): the signer `play-client.tsx` already hands to
  `makeLiveEntryServices` is wrapped so that `signMessage` (the packet — the Privy "Sign message"
  prompt in the reference image) and `signTransaction` (the money step) each report after they
  resolve. Delegation is by method call on the original, never by spread; `signMessage` stays
  absent when the adapter has none, so the fail-closed path in `services.ts` is unchanged; a
  rejection passes through untouched. `app/src/entry/**` is not edited.
- **`seal-stage.tsx` + `seal-stage.css`**: a full-bleed 16:9 box with the clip's exact aspect, so the
  painted button is a fixed fraction of the box and the seal controls sit on it at ≥ 768 px; below
  that the controls drop under the scene. Two clips — the idle loop and the one-shot run — cut from
  the same still, crossfaded 300 ms. Reduced motion: a still of the right moment, no `<video>`.
  The generic Blotts in the scene are the prompt's, never the player's seven (a Blott's silhouette
  is its allocation; the stage reads no allocation).
- **Where it is mounted** — `play-client.tsx`, outside the flow and the takeover, so the loop
  survives the swap from `BattleFlow` to `RevealHost`; `stageOn` is sticky from the first review
  until the flow resets or is done. `BattleFlow` gains `onReviewApi` (the confirm handle; with it
  set it draws no seal buttons and no playground); `RevealHost` gains `onBeat` (card → done,
  failed → stopped) and `quiet` (its entry beat renders nothing; the blender is the wait). The
  two-step seal, its wording, and the §8.6 line above each step are unchanged — the surface moved,
  the order did not.
- **The button (D3)**: action pink, oversized, a 1.2 s glow pulse (0.83 Hz, under WCAG 2.3.1's
  three flashes a second) until pressed. `SEAL_KEY_TONE = 'red'` is the founder's flip; the CSS for
  it exists (`.seal-stage[data-tone='red']`) and the exception would be recorded in `tokens.ts`.
- **`/dev/seal-stage`** (`page.dev.tsx`, dev builds only): every phase with dummy controls, so the
  stage can be reviewed without a wallet. The credentialed run stays on the founder's devnet review.

## B3. Assets — what was generated, with what, for how much

Reference set (already in the Higgsfield account): character stills `e9f687e5…` and
`7ebafb7a…`; the prompt base is the founder's own pose-pipeline wording.

| Asset | Still (gpt_image_2_5, high/2k) | Clip (minimax_h3, 2K) | Shipped as |
|---|---|---|---|
| Card loop | `03c35866…` (cabinet window) | `b59524cc…` 8 s 4:3, start = end | `motion/pool/blott-card.{mp4,webm,jpg}` 720×540 — 190 KB / 151 KB |
| Rail loop | `c5010a69…` (neon arch tunnel) | `1abd65b7…` 8 s 9:16, start = end | `motion/pool/rail.*` 720×1280 — 834 KB / 530 KB |
| Strip loop | `0e8dc647…` (pink wall, seven varied) | `98253892…` 8 s 16:9, start = end | `motion/pool/strip.*` 1280×720 — 712 KB / 393 KB |
| Blender idle | `d65da4a8…` (pink button, Blott mid-drop) | `8bfe2468…` 8 s, start = end (`cdabc7e8…` a calmer spare) | `motion/seal/blender-idle.*` 1280×720 — 1.22 MB / 1.13 MB |
| Blender run | start `d65da4a8…`, end `e6aa6a82…` (full jar, lid on, empty belt) | minimax `4139f9ea…` and `0d8a315e…` both drifted to a teal room from 3 s (the second shipped provisionally in `360def1`); `seedance_2_0_mini` `3ba78a83…` 8 s holds the pink room throughout and is the one shipped | `motion/seal/blender-run.*` 1280×720, 8.04 s, one-shot — 1.46 MB / 1.12 MB, plus `blender-done.jpg` 97 KB (its last frame) for the settled state, swapped in by `bfdc1fa`. One blemish stays: around 2 s a grey mechanical hand lowers the lid, which reads as part of the machine |

Loop closure: first-versus-last-frame SSIM was 0.958–0.972 on the raw loops, so every loop was
closed with a 0.4 s tail-to-head crossfade (ffmpeg `xfade`; `fps=24` must follow `trim`, or the
filter refuses the input as variable-rate). Encodes: H.264 crf 23 slow + faststart, VP9 crf 33,
poster JPEG q3. Total added under `app/public/motion/`: 8.2 MB (`pool/` rail, strip, blott-card; `seal/` blender-idle, blender-run, blender-done).

Credits: 182 of the 300 cap (balance before 2,926.66, after 2,744.66; the account's transaction list
agrees to the credit — ten stills at 3, eight minimax clips at 12–20, one seedance clip at 20). The
last minimax attempt, `4169378c…` 6 s, was started as a fallback while seedance rendered and was
neither compared nor used. Alternates kept in the account,
not the repo: stills `a07af880…`, `70fe519a…`, `9720722d…`, `9d0534a2…` (the red-button
blender), `18058443…`; clip `cdabc7e8…`.

D7 deviation: the card loop was generated (16 credits) rather than cut from a library clip — no
library clip is a loop, and closing one would have cost the same crossfade plus an hour of
browsing.

## B4. Figma

`Blotto Cup — UI uplift 2026-09-16` — https://www.figma.com/design/VBAO4nqwOSMOReAN9xfUYR
(plan `team::1669240224739880472`). One page: the reference row (the four chosen stills and two
real captures of the built pages), `Seal stage · made · 1440` and `· 390`, `Pool page · rails ·
1440`, `Home · Open-now card with Blott well · 1440`; a `Blotto tokens` variable collection (14
colours from `tokens.ts`, scoped) and seven text styles in the product's faces (Big Shoulders,
Space Grotesk, JetBrains Mono). Frames were built before the pages were coded and the code
matched to them; the time-box (75 min) held.

## B5. Judgement calls (every one is also a `PHASE-N-REVIEW` in the code)

- `landing.demoHint` gains "Press a padlock to hold a stat where it is." (§A11).
- `pool.aboutHeading` = "How this pool pays" — the marquee over the pool page's rule paragraphs.
- `battle.sealStageAria` — the stage's description for assistive tech.
- `tx.entryRefused` — the §A7 wording.
- The motion rule (one ambient loop per viewport) is kept by play-when-visible; two loops can
  overlap for a beat mid-scroll on the landing.
- The stage box is `min(100vw, 78vh × 16/9)`, so on a very wide, short screen the pink field shows
  either side of the scene; the pink field is the brand surface, so this reads as intended.
- `marquee.css` duplicates ~40 lines of `cabinet.css` rather than sharing them, so a back-page
  tweak can never be a play-route change; unifying them is a follow-up.

## B6. Deliberately not done

- The full desktop type scale and a top navigation at lg (§A2 (b)).
- A verify-page mode for OPEN pools.
- The 409-specific refusal string (waits on the founder's part-4 fix).
- `/pools` and `/profile` restyles.
- The 390-wide pool page and home card Figma frames (the built captures stand in).

## B7. Verification — on the last commit

On `bfdc1fa`, the last code commit, from `app/`: `npm run typecheck` — clean; `npm run lint` — clean;
`npm test` — 62 files, 489 tests passed; `NEXT_PUBLIC_FIXTURE_DATA=1 npm run build` — compiled, 18 static
pages. From the root: `./scripts/check-language.sh` — clean (self-test passed) and
`./scripts/check-standing-rules.sh` — rules 5 and 6 clean (self-test passed); both were run again after
this report was written, since the language gate reads the docs too.

`npm run journey` on that fixture build — 16 of 16 passed across mobile-375 and desktop-1280 (11.5 s),
the new `landing: the practice machine can hold a stat` among them. The lane's screenshot output under
`docs/phase-reports/screenshots` was restored with `git checkout` before committing, as §A requires;
`app/next-env.d.ts` likewise.

After-captures for the founder's morning review: `docs/design/uplift-2026-09-16/` — home-1440, home-390, rules-1440, fair-play-390, pool-1440, pool-390, seal-stage-1440, seal-stage-390 (JPEG, each under 300 KB, captured from the fixture-mode dev server; `/dev/seal-stage` is the dev-only preview). The harness that produced them
(`playwright-core` + the installed Chromium) lives in the session scratchpad, not the repo.

## B8. The commits

- `3ed949c` app: desktop scale — 0.9 on a wide screen, and the header lines up with the landing column
- `b3f0c6e` app: the pool page offers "Verify this pool" only once the pool has sealed
- `8d7dc2b` copy: the entry refusal no longer points a locked-out wallet at the Rules page
- `bffaab8` landing: the practice machine gets the padlocks the run already has
- `34519f2` app: the informational pages wear the landing's field — marquee headings on neon boxes, on pink
- `f295859` landing: a looping Blott in the open-pool card, and one AmbientClip for every ambient loop
- `9285946` pool page: the yellow field, conveyor rails converging on Enter, and a neon rule box
- `360def1` play: the seal stage — seven Blotts into a blender, the seal on its base, the blender runs once signed
- `bfdc1fa` play: the run clip regenerated without the palette drift
- the docs commit after it: this report (§B), the `docs/INDEX.md` row and `docs/design/uplift-2026-09-16/`
  (eight review captures)

---

# §C — Round two (founder feedback on the preview, 2026-09-16 ~21:00 UTC)

Three asks, taken in the order given. Same boundaries as §A: the dial rule, the entry path and
the run were not opened; nothing deployed, nothing merged; every new string is a `PHASE-N-REVIEW`
proposal in `app/src/copy/index.ts`.

## C1. The welcome curtain (`app/src/components/preloader/Preloader.tsx`)

- The Enter block moved from 76 % of the height (across the letters' feet) to the bottom band —
  `bottom: max(3.5rem, safe-area + 3rem)` — and the film is cover-cropped from the top
  (`object-position: 50% 85%`) so that band survives a wide, short window: at 1920×830 with the
  0.9 scale the word's feet sit at about 78 % and the block starts under them. At 1440×900 there
  is clear floor between the two; on a phone the film is letterboxed above the block as before.
- The line is set in the display face, capitals, 22 / 26 / 30 px by breakpoint, in three pieces
  that wrap whole (a phone gets two lines, split at a dot); the button grew to 26 / 30 px. Still
  words, not digits, on the brand surface.
- Wording (`preloader.line`): "Sixty-four seats · Seven battles · Winner takes the prize pool" —
  the last piece is the ratified D-E2 form (`pool.tierWinner`). Alternates if the founder wants
  it sharper still: (a) "Sixty-four seats · Seven battles · First place takes the prize pool";
  (b) "Seven battles · Sixty-four seats · One prize pool". The screen-reader intro is unchanged.

## C2. The pool page (`app/src/app/pools/[pool]/`)

- Field back to pink; the rails flush to the viewport edges (the 1440 cap on the field is gone,
  their basis `clamp(200px, 23vw, 440px)`), the column between them `max-w-3xl` (768 px) instead
  of 672; the inner-edge fades are pink.
- The card: the ring at 140, the prize, entry and clock at a new `lg` size on `Stat` and
  `Countdown` (40 px extra-bold, 13 px labels), padding 24 / 32. **The R7-b line ("Not enough
  players yet…", founder instruction 2026-09-12 §4.4) is off the card at the founder's request.**
  That reverses the 2026-09-12 instruction; the rule it restated is the last two points of the
  box below, and `pool.outcomeIfDeadlineNow` stays in the copy module because the read API still
  reports the field. Worth a conscious yes rather than a silent one.
- "How this pool pays": four bullets at 17 / 26 px in ink (was three 13 px paragraphs in muted),
  `pool.aboutPoints`. The ratified long forms `prizeRule` / `sealed` / `refundRule` stay in the
  module (`sealed` is still the sealed panel's line). Dropped from this page, not from the
  product: the lamport-remainder rule, which the Rules page carries in its ties and randomness
  sections.
- The state chip beside the marquee gets a `field` tone (cream plaque, berry ink) — on pink the
  `open` tone was pink on pink. The Enter control wears the welcome curtain's cream ring for the
  same reason; the §8.6 line is 16 px semibold and still above it (the journey test asserts the
  order).
- `e2e/journey.spec.ts`: the prize-sentence assertion follows the new first bullet.

## C3. A capture bug found on the way

Every review capture in §B was taken through `127.0.0.1`. Next 16's dev server treats that as a
cross-origin dev request and withholds the client chunks, so those captures are the server render
without hydration: the pool card's clock shows the `--:--:--` placeholder in §B's `pool-1440` /
`pool-390`, and the welcome curtain (client-mounted) could not be captured at all. Through
`localhost` both are right; this round's captures were taken that way and the two pool ones
replace §B's. Nothing in the product was affected — the journey lane runs the production build on
its own server — and the harness in the scratchpad now uses `localhost`.

## C4. Verification and captures

On `e1fefa3`, from `app/`: `npm run typecheck` — clean; `npm run lint` — clean; `npm test` — 62
files, 489 tests passed; `NEXT_PUBLIC_FIXTURE_DATA=1 npm run build` — compiled; `npm run journey` —
16 of 16 across mobile-375 and desktop-1280 (10.7 s), the pool assertion updated. From the root,
`./scripts/check-language.sh` — clean, run again after this section was written. The lane's
screenshot output and `app/next-env.d.ts` were restored before committing.

Captures (`docs/design/uplift-2026-09-16/`): `welcome-1440.jpg`, `welcome-390.jpg` and
`welcome-1920x830.jpg` (the founder's own geometry) are new; `pool-1440.jpg` and `pool-390.jpg`
are replaced. Figma was not updated this round — the founder is reviewing the built pages
directly, and the §B4 pool frame now shows the yellow field; refreshing it is a follow-up if
wanted.

## C5. Commits

- `e1fefa3` app: round two — the welcome strap under the word, and the pool page on pink
- the docs commit after it: this section and the five captures

## C6. "Not available here" on the preview — checked while the founder was out

At about 21:20 UTC the founder met the territory panel on the entry page again, signed in as UI-A.
Checked from this container at 21:30 UTC, the same way as on 2026-09-14:

| Probe | Answer |
|---|---|
| `GET blotto-packet.fly.dev/health` | `ok`, screening loaded |
| `GET …/geo` with `Origin: https://www.blotto.gg` | `200 {"allowed":true}`, `access-control-allow-origin: https://www.blotto.gg` |
| the same with `https://blotto.gg` and `https://blotto-jade.vercel.app` | allowed, header present |
| the same with a branch-preview origin (`https://blotto-git-…vercel.app`) | `200`, **no allow-origin header** — the browser discards the answer |
| `GET blotto-indexer.fly.dev/health` with the www origin | `200`, header present |

Production is healthy and answers every origin it did on the 14th. A branch preview is not one of
them: `BLOTTO_APP_ORIGINS` is an exact-match list and every preview has a different address, so on
the preview the browser refuses the `/geo` answer, `entry/geo-gate.ts` fails closed as designed and
`play-client.tsx` shows the territory panel — the 2026-09-14 mechanism with a different origin, and
the outcome §B and §C predicted for previews. No code changed and nothing was redeployed. The
backend carries one commit since the 14th (`f344903`, the data-minimisation set) and
`config/territories.json` is unchanged.

If the panel appears on `www.blotto.gg` itself, that is a different fault. Opening
`https://blotto-packet.fly.dev/geo` directly in the same browser answers for that connection with
no origin rule in the way: `{"allowed":true}` means the site's own call failed for another reason;
`{"allowed":false}` means the connection is classified as blocked — a VPN exit, or the vendor's
answer for that address — which the 2026-09-14 note's §5 discusses (the panel does not distinguish
the two, by founder instruction).

What would make previews testable end to end — a founder decision after T4, since it needs a
backend redeploy and the freeze holds while T4 runs: (a) a fixed staging deployment on a stable
address (a `staging` branch with its own Vercel alias) added once to `BLOTTO_APP_ORIGINS`; or (b)
accept the rule and test entry flows only on the production alias after a merge. (a) is the
recommendation: it keeps the exact-match list — no wildcard, which `http-hygiene.ts` deliberately
refuses — and makes every future round reviewable before it ships. Rejected: adding each preview
address by hand (a redeploy per branch) and a wildcard (the reason the list is exact-match).

---

# §D — Round three: the seal screen relaid (founder feedback on production, 2026-09-17 ~01:30 UTC)

The founder reached the seal screen on the live build (a run on pool 15, left to lapse) and
called the page "appalling": the review text sat above the scene on plum, the scene ran
edge to edge with pink showing either side, and the seal key on the blender's base crowded
the blender. The ask, in the founder's words: put all the text above the video into a
candy box that sits as a widget inside the video on the right; pink background; the video
framed nicely; the seal button somewhere that fits, still standing out.

## D1. What was built

- **The field is pink** from the header down (`.seal-stage` rises over the play column's top
  padding and fills the viewport), the footer and tab bar stay on plum outside
  it, as on every pink page.
- **The scene is framed**: a plum panel with the battle cabinet's gradient, rimmed in cream
  with a berry shade — the cabinet recipe the player has just spent seven screens in, on the
  field where the pink neon ring would vanish. The scene keeps the clip's exact 16:9 inside
  it. Its width is the column, capped at 1400 and at what leaves the §8.6 line, the key and
  a Go back inside the window (`--stage-w`), so the screen a decision is made on scrolls for
  nothing: 830 px tall at 1920 wide holds the armed state exactly.
- **The review is a candy widget over the right of the scene** (from 1024 px): heading,
  lead, the time-ran-out note when it applies, the rack of seven, and the sealing explainer
  as a row — a translucent plum card with the candy elevation and a backdrop blur, so the
  jar's edge and the pipes read through it as glass. Under 1024 px the same widget sits
  under the scene inside the frame, a card in the cabinet.
- **The widget is a slot.** `BattleFlow` keeps owning the seven and their stills and
  portals its review into the slot (`reviewHost`, handed down by `play-client.tsx` from the
  stage's `widgetRef`); when hosted it draws the compact variant and no playground or seal
  buttons. Nothing about the run's state moved. After the confirm the flow leaves review,
  the portal empties and the widget hides (`:empty`), so the blender runs alone.
- **The rack in the widget is two rows, four and three.** At seven across the tiles are
  40 px and the five numbers under each wrap one per line; at four across a still is 80 px
  and its numbers hold two lines — the rack is what F-21 screenshots as the record of the
  allocations, so its numbers have to read.
- **The §8.6 line and the seal key sit under the frame**, centred in a 560 px band: the
  line in berry, then the key — action pink, 64 px tall, 20 px type, with the cream rim
  every commit control wears on the pink field, the candy key elevation and the slow glow
  while it is the player's to press. Step two swaps it for the confirm and adds Go back. The
  order (line above key) is unchanged, and it is now impossible for the key to crowd
  anything in the scene.
- `/dev/seal-stage` portals a stand-in review into the slot the way the flow does, with an
  expired toggle, so the layout can be seen without a run.

## D2. What did not change

The two-step seal and its wording, the §8.6 line above each step, `SEAL_KEY_TONE` and the
red variant, the clips, the machine (`seal-stage-machine.ts`), the signer wrapper, and
everything under `app/src/entry/`. The seal-stage machine's tests and the flow's tests are
untouched and pass.

## D3. Rejected

- Lifting the review data (tiles, expiry) through `ReviewSealApi` so the page renders the
  widget: the stills arrive asynchronously, so the api would re-register on every change
  and its cleanup would drop the stage for a frame each time. The portal keeps ownership
  where it is and moves only the drawing.
- Keeping the key on the blender's base with the widget beside it: the founder's complaint
  exactly — two things competing for the blender.
- A wider scene on a very wide window: the height budget wins, because the key must be
  reachable without scrolling on the screen a decision is made on.

## D4. Verification and captures

On the branch head, from `app/`: `npm run typecheck` — clean; `npm run lint` — clean; `npm test` — 62
files, 489 tests passed; `NEXT_PUBLIC_FIXTURE_DATA=1 npm run build` — compiled; `npm run journey` —
16 of 16 (10.2 s). From the root, `./scripts/check-language.sh` — clean after this section was written
(it refused one word in a comment and here, both reworded). Measured on `/dev/seal-stage` through
`localhost`, in the browser's own pixels at the 0.9 scale: at 1920×830 the scene is 912×513, the
widget 337×357 with nothing hidden, and both seal states fit the window (page 830 of 830); at
1440×900 the same with room; a 1366×700 laptop moves down 62 px to reach the key.

Captures (`docs/design/uplift-2026-09-16/`): `seal-stage-1440.jpg` and `seal-stage-390.jpg`
replaced; `seal-stage-1920x830.jpg` (the founder's geometry) and
`seal-stage-armed-1920x830.jpg` (step two) new. From `/dev/seal-stage`: the tiles show
numbers because the stand-in has no stills; a real run shows the lock-in stills.

## D5. Shipping

Branch `step/seal-screen-2026-09-17`, one commit carrying the code, this section and the
captures. Merging deploys; the
merge waits until the founder is off the seal screen and no entry is in flight, per the
same reasoning as §C — a deploy cannot touch a pool, but it can reload a browser mid-run.

---

# §E — Round four A: the seal screen in two columns, and the sealed column (founder feedback on production, 2026-09-17 ~02:20 UTC)

The founder entered pool 16 on the new build — the signing wrapper's first real transaction, and
it worked: "I'm in, seat 1 of 64", the blender blended. Then three asks: the entry box as a right
column in line with the video rather than over it, the key under the box; after the transaction,
keep the blender and put the pass, the sealed note, **Post on X** (the other share gone) and
**Keep me updated when this pool ends** where the key was, with an address prompt for a sign-in
that has none; and build the workflow that sends. This section is the first two; §F is the third.

## E1. Two columns

- From 1024 px the stage is a grid: the framed scene left, a `clamp(320px, 34%, 440px)` column
  right, tops aligned, the column stretched to the frame's height so the key sits on the frame's
  bottom edge (1920×830: both end at 701 px; 1440×900: 681). The frame takes its column or what
  the window's height allows; the grid caps at 1600. A phone stacks scene, card, key.
- The widget is a solid plum candy card now, not a glass overlay, at legible sizes (30 px heading,
  15 px lead, 14 px explainer); the rack stays seven across with its numbers on two lines.
- **A defect found on the way, and worth its own line: under the 0.9 desktop scale (globals.css),
  `100vw` is 90 % of the window.** The stage broke out of the narrow play column with
  `width: 100vw; margin-inline: calc(50% − 50vw)`, so on production it sat 90 % wide with plum
  strips either side — visible in the founder's own capture. Fix: the play route's wrapper is an
  inline-size container (`.play-field`, globals.css) and the stage sizes against `100cqw`, which
  is the document's width whatever the scale. The wrapper also carries the pink field for the
  whole route, which §A2 asks for anyway. The other viewport-unit users in the app (the Blott
  antics' run-off, the confetti fall, the welcome note's max width, the pool rails' height) are
  animations or caps where 90 % is harmless; none draws a field.

## E2. The sealed column

- `RevealHost` takes `renderCard`; with it, the card beat renders the host's own column instead
  of the page-layout `PassCard`, and there is no Continue — the column is the end of the flow and
  its two links (Follow this pool, Back to homepage) the exits. `play-client.tsx` hands the
  takeover to the stage as `side`, so the blender stays on screen through the confirm and after.
- `entered-panel.tsx`: the pass (cream, the cheer Blott, "I'm in", the seat, the asset), a plum
  note with the trophy Blott, "Sealed" and the rule in two lines (`pool.checkBackShort`), then
  Post on X as the pink key and Keep me updated as a cream key, the one-message note, the links.
  The pass PNG and the X intent are `pass-card.tsx`'s, now exported (`usePassImage`,
  `openXWithPass`); the page-layout card still uses them.
- **The opt-in is offered only when the entry service advertises `notify: v2` on `/health`** —
  the page asks once the entry is in flight (`entryServiceNotifyVersion`). Until the dispatcher
  (§F) is deployed the key does not appear, so nothing on the screen is a promise with nothing
  behind it, which was the whole of the D-E11 ruling.
- The sign-in now carries `email` (`wallet/types.ts`): a Google or Apple account's address from
  the provider, null for a wallet or X sign-in. With it the key is one press and one wallet
  prompt; without it the key opens a field ("Where should the one message go?"), checked for
  shape before any prompt. Either way the wallet signs
  `blotto-cup notify v2 / wallet / pool / email / at` (`notify/pool-notify.ts`, tested) and the
  service verifies before storing.

## E3. Not changed

The two-step seal, its wording and the §8.6 order; the machine; the clips; the signer wrapper;
`app/src/entry/`; the page-layout pass card and sealed panel (unreachable while the stage hosts
the flow, kept for the reduced-layout path).

## E4. Verification and captures

On the branch head, from `app/`: `npm run typecheck` — clean; `npm run lint` — clean; `npm test` — 63
files, 495 tests passed (six new for the opt-in client); `NEXT_PUBLIC_FIXTURE_DATA=1 npm run build` —
compiled; `npm run journey` — 16 of 16 (10.4 s). From the root, `./scripts/check-language.sh` and
`./scripts/check-standing-rules.sh` — clean. Measured on `/dev/seal-stage` through `localhost` in the
browser's own pixels: 1920×830 — frame 1026×588, column 396 wide, key on the frame's bottom edge,
page 830 of 830; 1440×900 — frame 990×568, the same; 1366×700 — frame 916×526, page 700 of 700;
the sealed column 613 tall at 1920, inside the window.

Captures (`docs/design/uplift-2026-09-16/`): `seal-stage-1440.jpg`, `seal-stage-390.jpg`,
`seal-stage-1920x830.jpg`, `seal-stage-armed-1920x830.jpg` replaced; `seal-stage-sealed-1920x830.jpg`,
`seal-stage-sealed-email-1920x830.jpg` and `seal-stage-sealed-390.jpg` new (the dev preview's
stand-in: numbers for tiles, a placeholder asset).

## E5. Shipping

Branch `step/seal-columns-2026-09-17`, one commit. Pool 17 was open with no entrant at the merge;
the 62 headless seats never touch the frontend, and the founder was reviewing, not entering.
