/*
 * THE pass visual — shared shell language for every surface that draws the
 * pass (extracted from the predecessor repository, where this
 * shipped in 10.B Step 4d).
 *
 * ONE implementation on purpose: every surface that shows a pass shares this
 * static passes, and the 10.C reveal takeover all render THIS shape and THIS
 * shell treatment — visual continuity from the trade surface into the
 * takeover is the point of the motif, and a forked pass that can drift is a
 * named defect class. If a surface needs a different treatment, it
 * parameterizes here; it does not copy.
 *
 * Everything below moved VERBATIM from the predecessor (which re-exported the
 * glyphs so its own consumers and import allowlist were untouched; that
 * allowlist and the test it named do not exist in this repository). Colour
 * rules unchanged: violet/magenta family only, tokens via color-mix, no raw
 * hex, no gold.
 * (as amended in 4d).
 */

/** The pass silhouette — the one shape, shared by every pass render so the
 * art language cannot drift. 200×250 viewBox, 4:5. */
export const EGG_PATH =
  "M100 8 C 148 8 184 78 184 152 C 184 212 146 244 100 244 C 54 244 16 212 16 152 C 16 78 52 8 100 8 Z";

/**
 * Shell + sheen gradients (the RESTORED pre-4c body, Step 4d — the 4c
 * outline-first rework replaced a good silhouette to fix what was actually
 * a geometry bug). Id-parameterized so multiple passes coexist in one
 * document (SVG ids are document-global).
 *
 * Colours are token-derived via color-mix — no raw hex (the pre-4c
 * gradient's one genuine defect WAS its too-dark hex values): the shell is
 * LIFTED so the body reads as a solid violet object, clearly lighter than
 * the near-black page, at arm's length on a dim phone. Violet family only —
 * no gold anywhere (D-04). Legibility is judged on DEVICE, not by any
 * automated contrast number.
 */
export function PassShellDefs({
  shellId,
  sheenId,
}: {
  shellId: string;
  sheenId: string;
}) {
  return (
    <defs>
      <radialGradient id={shellId} cx="38%" cy="30%" r="80%">
        <stop
          offset="0%"
          style={{
            stopColor: "color-mix(in srgb, var(--color-brand) 52%, var(--color-base))",
          }}
        />
        <stop
          offset="55%"
          style={{
            stopColor: "color-mix(in srgb, var(--color-brand) 30%, var(--color-base))",
          }}
        />
        <stop
          offset="100%"
          style={{
            stopColor: "color-mix(in srgb, var(--color-brand-deep) 40%, var(--color-base))",
          }}
        />
      </radialGradient>
      <linearGradient id={sheenId} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="var(--color-brand-hot)" stopOpacity="0.35" />
        <stop offset="45%" stopColor="var(--color-brand)" stopOpacity="0.08" />
        <stop offset="100%" stopColor="var(--color-brand-deep)" stopOpacity="0" />
      </linearGradient>
    </defs>
  );
}

/** The restored pass body: gradient shell + defined brand rim + sheen. The
 * BODY carries the shape (this is not a wireframe); the rim holds the
 * silhouette where the body meets the page. */
export function PassBody({
  shellId,
  sheenId,
  rimWidth,
}: {
  shellId: string;
  sheenId: string;
  rimWidth: number;
}) {
  return (
    <>
      <path
        data-testid="pass-body"
        d={EGG_PATH}
        fill={`url(#${shellId})`}
        stroke="var(--color-brand)"
        strokeWidth={rimWidth}
      />
      <path d={EGG_PATH} fill={`url(#${sheenId})`} />
    </>
  );
}

/** PLACEHOLDER ART SLOT — swapped for the collection's pass art when an art
 * pipeline exists (V2-004 territory; none invented here). Kept deliberately
 * abstract: violet speckle, no motif. Shared so the reveal pass IS the same
 * pass, speckle and all. */
export function PassSpeckle() {
  return (
    <g opacity="0.5">
      <circle cx="72" cy="110" r="5" fill="var(--color-brand)" />
      <circle cx="128" cy="90" r="3.5" fill="var(--color-brand-hot)" />
      <circle cx="112" cy="160" r="6" fill="var(--color-brand-deep)" />
      <circle cx="66" cy="176" r="3" fill="var(--color-brand-hot)" />
      <circle cx="140" cy="140" r="4" fill="var(--color-brand)" />
    </g>
  );
}
