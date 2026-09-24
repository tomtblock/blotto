import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { COPY } from "@/copy";
import { AuthProvider } from "@/wallet/auth-provider";
import { QueryProvider } from "@/query/query-provider";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";
import { SiteAntics } from '@/components/blott/SiteAntics';
import { SkipLink } from '@/components/shell/skip-link';
import { RouteFocus } from '@/components/shell/route-focus';
import { ForgetBlottStills } from '@/storage/ForgetBlottStills';

// SELF-HOSTED, NOT FETCHED (2026-09-22). These three were `next/font/google`,
// which downloads the font files from Google at BUILD TIME. That made every
// build depend on a third-party fetch succeeding, and it failed in the way
// network dependencies fail — intermittently, and never reproducibly: PR 159
// saw `cea3128` build clean and `0c77466` die eleven minutes later on
// identical app code, with `next/font/google queries have exactly one entry`.
// The same flake red-failed `app-lighthouse` on main. A build that can break
// because a CDN was slow eventually breaks a DEPLOY, not just a check.
//
// The files in ../fonts are the latin-subset VARIABLE woff2 Google itself
// serves, downloaded once and committed (~99 KB total). Each ships with its
// SIL Open Font License 1.1 text alongside, which is what self-hosting
// requires; see ../fonts/README.md for the exact source URL of each.
//
// The rendered result is unchanged: same families, same weights, same CSS
// variable names, so no consumer of --font-* needs to know.

// The display face (D1): Big Shoulders — a condensed athletic family built
// for scoreboards and stadium signage, which is exactly what prize amounts,
// ranks and countdowns are. Weighted heavy; used with restraint.
const bigShoulders = localFont({
  src: "../fonts/big-shoulders-latin-var.woff2",
  variable: "--font-big-shoulders",
  display: "swap",
  // The variable axis this file carries; the design uses 600-800 of it.
  weight: "600 800",
  // No fallback metrics exist for this family, so pin an explicit
  // condensed-ish stack rather than let a generated one be skipped.
  adjustFontFallback: false,
  fallback: ["Arial Narrow", "Arial", "sans-serif"],
});

const spaceGrotesk = localFont({
  src: "../fonts/space-grotesk-latin-var.woff2",
  variable: "--font-space-grotesk",
  display: "swap",
  weight: "300 700",
});

const jetbrainsMono = localFont({
  src: "../fonts/jetbrains-mono-latin-var.woff2",
  variable: "--font-jetbrains-mono",
  display: "swap",
  weight: "100 800",
});

// The page title and description are the FIRST user-facing strings a search
// engine or a link preview will quote — squarely inside the PID §8.7 language
// rule. Both come from the copy module (v3 D-UI-3).
export const metadata: Metadata = {
  title: `${COPY.shell.title} — ${COPY.shell.tagline}`,
  description: COPY.shell.metaDescription,
};

export const viewport: Viewport = {
  // Literal required here (meta tag config, not component styling);
  // keep in sync with --color-base in src/styles/tokens.css.
  themeColor: "#5E1B40",
};

// Typed explicitly rather than with Next's generated `LayoutProps` global: that
// type only exists after `next typegen` has run, so a bare `tsc --noEmit` — which
// is what `npm run typecheck` and any CI lane would call — would not see it.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${bigShoulders.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* First in the tab order on every page (2026-09-13). */}
        <SkipLink />
        <AuthProvider>
          <QueryProvider>
            <ToastProvider>
              {children}
              <SiteAntics />
              <RouteFocus />
              <ForgetBlottStills />
            </ToastProvider>
          </QueryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
