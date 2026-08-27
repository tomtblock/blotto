import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/*
 * Offline unit suite for the decode + display-mapping layer (no DOM, no
 * network — fixtures only). `npm test` runs it; Playwright visual passes are
 * a separate, manual step-workflow concern.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The IPC cross-decoder test imports the REAL services decoder
      // (services/_shared/src/events.ts) — its `@solana/web3.js` dependency
      // is installed per-service, not resolvable from that file's location
      // in this checkout, so point the SAME specifier at apps/web's genuine
      // devDependency copy. A resolution fix, not a behavioural shim: the
      // services code runs unmodified against the real package.
      "@solana/web3.js": fileURLToPath(
        new URL("./node_modules/@solana/web3.js", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
