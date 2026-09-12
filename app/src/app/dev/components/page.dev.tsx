/*
 * /dev/components (D1): the design-system preview page. DEV ONLY — in a
 * production build this route is a hard 404 (`notFound()`), so nothing here
 * is ever a public surface and no copy on it needs founder sign-off.
 */
import { notFound } from "next/navigation";
import { Gallery } from "./gallery";

export const metadata = { title: "Components — dev preview" };

export default function ComponentsPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Gallery />;
}
