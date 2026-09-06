import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
