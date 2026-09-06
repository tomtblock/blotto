import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
  },
};

export default nextConfig;
