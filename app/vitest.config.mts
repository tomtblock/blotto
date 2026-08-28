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
      // The monorepo aliases (E2): one place knows where the shared packages
      // live — mirrored from tsconfig.json "paths" (Next resolves those
      // natively; vitest needs them restated here).
      "@blotto/scoring": fileURLToPath(
        new URL("../backend/scoring/src", import.meta.url),
      ),
      "@blotto/sealing": fileURLToPath(
        new URL("../backend/sealing/src", import.meta.url),
      ),
      "@blotto/shared": fileURLToPath(
        new URL("../backend/_shared/src", import.meta.url),
      ),
      "@blotto/packet": fileURLToPath(
        new URL("../backend/packet/src", import.meta.url),
      ),
      "@blotto/reveal": fileURLToPath(
        new URL("../backend/reveal/src", import.meta.url),
      ),
      "@blotto/detection": fileURLToPath(
        new URL("../backend/detection/src", import.meta.url),
      ),
      "@config": fileURLToPath(new URL("../config", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
