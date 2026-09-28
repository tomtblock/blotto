import path from "node:path";
import type { NextConfig } from "next";
import { clusterGate } from "./src/chain/cluster";

/*
 * THE CLUSTER GATE (audit 2026-09-11, A-06 / E-02).
 *
 * `src/chain/cluster.ts` has stated the cluster/RPC contract as data since
 * 2026-09-08 and called itself a "build-time gate". It was not one: nothing
 * outside its own vitest file ever ran it, so a mainnet build with no RPC,
 * or with the devnet faucet or the automation signer still switched on,
 * would have built and shipped. Next evaluates this config in Node before
 * compiling anything, so this call is the gate — it fails `next build` and
 * `next dev` with the reason, against the SAME environment Next is about to
 * inline into the client bundle.
 *
 * Rejected alternatives: (a) `instrumentation.ts`, which runs at server
 * START and so lets a broken bundle be built and deployed before anything
 * complains — and says nothing at all about a statically exported page;
 * (b) a CI step, which is a second place to remember and does not protect a
 * build run by hand. This is the one path every build takes.
 *
 * `cluster.ts` imports nothing, so importing it here costs nothing and
 * cannot draw app code into the config's module graph.
 */
clusterGate();

const nextConfig: NextConfig = {
  /*
   * THE DEV-ONLY ROUTES ARE NOT BUILT AT ALL IN PRODUCTION (audit
   * 2026-09-11, A-30).
   *
   * `/dev/components` and `/dev/preview` called `notFound()` when
   * `NODE_ENV === "production"`, which made them 404 at REQUEST time but did
   * nothing about BUILD time: the routes were compiled, and the component
   * gallery's client chunk — 40,013 bytes, measured in `.next/static/chunks`
   * on the 2026-09-12 build — was served from the static path of every
   * production deploy. A 404 you can still download is not a 404.
   *
   * `pageExtensions` decides which files Next treats as routes. The four
   * defaults are listed explicitly (setting this option REPLACES them), and
   * `dev.tsx` is appended only outside a production build. The two pages are
   * named `page.dev.tsx`, so in development they are ordinary routes and in
   * a production build no route exists, nothing compiles, and nothing is
   * emitted. The journey suite's assertion that `/dev/components` returns
   * 404 against `next start` still holds — now because the route is absent
   * rather than because it refuses itself.
   *
   * Rejected: (a) deleting the gallery, which is the design-system surface
   * the screenshot script reads its route list off; (b) a dynamic import,
   * which changes which chunk is emitted, not whether one is.
   */
  pageExtensions:
    process.env.NODE_ENV === "production"
      ? ["tsx", "ts", "jsx", "js"]
      : ["tsx", "ts", "jsx", "js", "dev.tsx"],

  /*
   * Pin the workspace root instead of letting Turbopack infer it.
   *
   * Next infers the root by looking for a lockfile (pnpm-lock.yaml,
   * package-lock.json, yarn.lock, bun.lock — see the bundled docs at
   * node_modules/next/dist/docs/01-app/.../next-config-js/turbopack.md).
   * This repo has yarn.lock at the root and package-lock.json in app/, so
   * the inference is ambiguous and it says so on every start.
   *
   * Worse than the noise: on 2026-09-06 the inferred root MOVED — a stray
   * package-lock.json at the repo root had been winning, and deleting it
   * silently changed the build root to the yarn.lock directory. A build root
   * that depends on which files happen to exist is not a root.
   *
   * It must be the REPOSITORY root, not app/: pages import the backend package
   * sources directly, and Turbopack does not resolve files outside the root.
   */
  turbopack: {
    root: path.join(__dirname, ".."),
  },

  /*
   * C7 / B-e — make the test-signer flag ALWAYS defined at build time.
   *
   * Next inlines `process.env.NEXT_PUBLIC_*` only for variables that are SET
   * when the build runs. An unset one is left as a runtime lookup against a
   * bundled process shim, so a guard reading it is not dead code and the
   * minifier keeps everything behind it — measured, not assumed: the first
   * attempt at this shipped `window.__BLOTTO_TEST_SIGNER__` into a production
   * bundle with the flag unset.
   *
   * Normalising it here means the ordinary case (nobody sets anything) inlines
   * as the literal "0", the guard becomes `if ("1" !== "0") return null`, and
   * the whole automation path is eliminated. The gate holds by construction
   * rather than by someone remembering to set a variable to a falsy value in
   * every deploy — which is the class of mistake this project keeps paying for.
   */
  env: {
    NEXT_PUBLIC_ALLOW_TEST_SIGNER: process.env.NEXT_PUBLIC_ALLOW_TEST_SIGNER ?? "0",
    /*
     * Same treatment, same reason (audit 2026-09-11, A-07): the in-repo
     * fixture catalogue may only leave a production build when a build
     * DELIBERATELY asks for it — the visual journey suite screenshots a
     * real production build with no backend. Normalised so the unset case
     * inlines as the literal "0" and the branch is dead rather than a
     * runtime lookup, and refused outright on mainnet by the cluster gate
     * above.
     */
    NEXT_PUBLIC_FIXTURE_DATA: process.env.NEXT_PUBLIC_FIXTURE_DATA ?? "0",
  },

  /*
   * SECURITY RESPONSE HEADERS (audit 2026-09-11, B-54) — ONE PLACE.
   *
   * The app shipped none: no content-security policy, nothing about
   * framing. A site whose whole purpose is prompting a wallet to sign could
   * be loaded inside an attacker's iframe, over a page of their choosing,
   * and the player would be reading the attacker's words while approving
   * ours. `frame-ancestors 'none'` is the fix for that and is the least
   * negotiable line below.
   *
   * The policy is written from what the app ACTUALLY contacts, not from a
   * template:
   *
   *  - the auth provider — `auth.privy.io` for its API and the embedded
   *    wallet's iframe, `explorer-api.walletconnect.com` for the wallet
   *    list, `api.moonpay.com` for the funding flow (grepped out of the
   *    installed @privy-io/react-auth, not assumed);
   *  - a Solana RPC, an indexer, an entry service and a review service,
   *    every one of them a DEPLOYMENT VARIABLE — their hosts are not
   *    knowable when this file is written;
   *  - the published reveal bundle, at a gateway address THE PLAYER TYPES
   *    IN. The verify page must work against a hostile or absent operator
   *    (R13), so a policy that only allowed our own gateway would defeat
   *    the page's whole purpose the day it mattered.
   *
   * Those last two are why `connect-src` is `https:` rather than a list.
   * That is a deliberate, narrow weakening, and it is worth stating plainly:
   * it does not stop an injected script from calling out, and `script-src`
   * is what does the work here — no foreign script origin can load at all.
   *
   * PHASE-N-REVIEW: `connect-src https:` and `script-src 'unsafe-inline'`
   * are deliberate weakenings, taken because the alternative breaks the
   * money path (an unknown RPC/indexer host, a player-supplied bundle URI)
   * or changes how every page is rendered. Both are named below with the
   * upgrade that would close them.
   *
   * `'unsafe-inline'` in `script-src` is Next's framework bootstrap: the
   * nonce-based alternative requires a middleware that stamps every
   * response, which makes every page dynamically rendered. That is a real
   * change to how the app is served and is a separate decision, recorded
   * here rather than taken silently. `'unsafe-eval'` is added in
   * development only, where the dev overlay needs it.
   *
   * `img-src` allows `data:` (wallet-standard wallets register their icons
   * as data URIs) and `blob:` (the lock-in stills and the montage are
   * canvas blobs rendered on the device).
   */
  async headers() {
    const dev = process.env.NODE_ENV !== "production";
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
      // The three faces are next/font/local over woff2 committed in
      // src/fonts, so no font origin is contacted at build time OR at
      // runtime; the inline styles are Tailwind's and Next's.
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob:",
      "connect-src 'self' https: wss:",
      "worker-src 'self' blob:",
      "frame-src 'self' https://auth.privy.io https://*.privy.io https://*.moonpay.com",
      // The clickjacking fix. Nothing may frame this app, ever.
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");

    return [
      /*
       * THE CLIPS AND SPRITES CACHE FOR A DAY (2026-09-27, page speed). The
       * platform's default for files under public/ is `max-age=0,
       * must-revalidate`: every visit re-asks for every clip and poster,
       * a round trip each even when the answer is 304. The files change
       * rarely and by a whole re-encode; a day in the browser cache, then a
       * week of serving the old copy while the new one is fetched behind
       * it, is the right trade. A swapped clip reaches everyone within a
       * day; a renamed file reaches them at once.
       */
      {
        source: "/motion/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
      {
        source: "/blott/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          // The pre-CSP companion, for anything that honours only this.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // A pool address or a wallet address must not travel to another
          // site in a Referer header.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
