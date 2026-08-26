import Link from "next/link";

/*
 * The explicit back affordance the founder's Step 3 device pass ratified: a
 * full 44px-target pill, not a text link — the one obvious exit. Extracted
 * extracted from a page header in the predecessor repository so that every
 * reinventing it.
 */
export function BackPill({
  href,
  label,
  testid = "back-pill",
  iconOnly = false,
}: {
  href: string;
  label: string;
  testid?: string;
  /** Compact variant: the 44px target stays, the label
   * moves to the accessible name — the affordance must not dominate the
   * row. The founder device-pass fix (an explicit back) is unchanged. */
  iconOnly?: boolean;
}) {
  if (iconOnly) {
    return (
      <Link
        href={href}
        data-testid={testid}
        aria-label={label}
        className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-overlay font-display text-sm text-ink active:bg-raised"
      >
        <span aria-hidden>←</span>
      </Link>
    );
  }
  return (
    <Link
      href={href}
      data-testid={testid}
      className="flex min-h-11 items-center gap-1 rounded-full bg-overlay px-4 font-display text-xs font-bold tracking-widest text-ink uppercase active:bg-raised"
    >
      <span aria-hidden>←</span> {label}
    </Link>
  );
}
