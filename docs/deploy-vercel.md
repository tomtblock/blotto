# Deploying the app to Vercel (E2)

The app lives in `app/` but bundles TypeScript straight from six sibling
packages (`backend/_shared`, `scoring`, `sealing`, `packet`, `reveal`,
`detection`) and reads the founder-owned files in `config/`. That is why a
default "Root Directory = app" deployment fails: the parent files are
outside the build root, and the backend sources' own dependencies
(`@noble/hashes`, `tweetnacl`, `@types/pg`, …) resolve from THEIR
directories, not the app's.

## Project settings (one-time, in the Vercel dashboard)

1. **Root Directory** = `app`.
2. Enable **"Include source files outside of the Root Directory"** (in the
   Root Directory setting) — without it the `../backend` and `../config`
   sources are not in the build container at all.
3. Environment variables per `app/.env.example`.

Everything else is committed: `app/vercel.json` sets the framework and an
`installCommand` that installs the six backend packages (dev deps included
— Next's typecheck needs their type packages) before the app itself.

## Verifying locally

Verified two ways on a clean clone (2026-08-28):

```bash
# 1. The raw commands vercel.json runs, from a fresh checkout:
for d in backend/_shared backend/scoring backend/sealing backend/packet backend/reveal backend/detection; do (cd $d && npm ci --no-audit --no-fund); done
cd app && npm ci --no-audit --no-fund && npm run build

# 2. The Vercel builder itself (writes .vercel/output, Build Output v3):
printf '{"projectId":"x","orgId":"x","settings":{"framework":"nextjs","rootDirectory":"app"}}' > .vercel/project.json
npx vercel build        # from the repository root
```

Both must pass before changing anything about the app's imports or the
install command. (On a linked project the Vercel CLI's settings-sync
subcommand writes the real `.vercel/project.json`; the hand-written one
above only stands in for local verification.)

## Where the parent paths live

All cross-package imports go through the aliases in `app/tsconfig.json`
("paths") — `@blotto/scoring`, `@blotto/sealing`, `@blotto/shared/*`,
`@blotto/packet/*`, `@blotto/reveal/*`, `@blotto/detection/*`,
`@config/*` — mirrored for the test runner in `app/vitest.config.mts`.
Never add a raw `../../..` import in `app/src`; add or reuse an alias so
the monorepo layout is written down in exactly two files.
