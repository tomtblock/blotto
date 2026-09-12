/*
 * /dev/components (D1): the design-system preview page. DEV ONLY.
 *
 * THE FILENAME IS THE GATE. `page.dev.tsx` is a route only while
 * `pageExtensions` includes `dev.tsx`, which next.config.ts does outside a
 * production build and never inside one — so a production build compiles no
 * route here and emits no chunk for the gallery. Before 2026-09-12 the only
 * guard was the `notFound()` below, which 404s the REQUEST while the 39 KB
 * client chunk still sat in /_next/static (audit 2026-09-11, A-30).
 *
 * The runtime guard stays as the second layer: if `pageExtensions` ever
 * loses `dev.tsx`'s production exclusion, this page refuses to render rather
 * than quietly becoming a public surface. Nothing here is a public surface,
 * so no copy on it needs founder sign-off.
 */
import { notFound } from "next/navigation";
import { Gallery } from "./gallery";

export const metadata = { title: "Components — dev preview" };

export default function ComponentsPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Gallery />;
}
