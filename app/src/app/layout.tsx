import type { Metadata, Viewport } from "next";
import { Big_Shoulders, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { AuthProvider } from "@/wallet/auth-provider";
import { QueryProvider } from "@/query/query-provider";
import "./globals.css";

// The display face (D1): Big Shoulders — a condensed athletic family built
// for scoreboards and stadium signage, which is exactly what prize amounts,
// ranks and countdowns are. Weighted heavy; used with restraint.
const bigShoulders = Big_Shoulders({
  variable: "--font-big-shoulders",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  // next/font has no fallback metrics for this family (build warns and skips
  // the generated fallback), so pin an explicit condensed-ish stack instead.
  adjustFontFallback: false,
  fallback: ["Arial Narrow", "Arial", "sans-serif"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

// TODO_COPY(layout.metadata): the page title and description are the FIRST
// user-facing strings a search engine or a link preview will quote, so they are
// squarely inside the PID §8.7 language rule and squarely inside the Phase 3
// audit (PID §10, C12). Placeholders until then.
export const metadata: Metadata = {
  title: "TODO_COPY(layout.title)",
  description: "TODO_COPY(layout.description)",
};

export const viewport: Viewport = {
  // Literal required here (meta tag config, not component styling);
  // keep in sync with --color-base in src/styles/tokens.css.
  themeColor: "#070B14",
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
        <AuthProvider>
          <QueryProvider>{children}</QueryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
