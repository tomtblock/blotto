# Step report — geo-blocking (`step/b3-geo-blocking`, D-B3)

**Status: delivered.** Item B3 of the 2026-08-27 master build prompt. The
decision row (D-B3) is in the register via the A2 PR.

## What was built

- **`config/territories.json`** — the founder-owned availability schedule:
  `{ version, allowed, blocked, updated }`. Committed contents are R2's
  launch policy exactly: `allowed: [GB, IE, DE]`, `blocked: []`. Listed in
  `docs/INDEX.md` as founder-owned — the lists never change without a
  founder instruction.
- **`backend/packet/src/territories.ts`** — schema validation
  (`parseTerritorySchedule` throws on ANY malformation), `loadTerritorySchedule`
  for deployment wiring, and the one decision function `territoryAllowed`:
  fail-closed on missing/unknown/malformed country, ambiguous region,
  explicit block (country or `US-NY`-style region, always winning), or
  absence from the allowed list.
- **Packet service** — `PacketServiceConfig.territoryAllowlist` replaced by
  `territories: TerritorySchedule`; `GeoLookup` results gain an optional
  `region`; issuance refuses through the existing single generic rejection.
  New `geoVerdict(deps, ip)` answers only a boolean for the pre-flight.
- **`GET /geo`** on the entry server — the client pre-flight endpoint,
  `{ allowed: boolean }`, nothing else disclosed.
- **Vendor seam + stub** (`geo-adapters.ts`) — `VendorHttpGeoLookup`
  (injected fetch, minimal HTTP contract, throws on every bad answer) and
  `StubGeoLookup` (constructor values or `GEO_STUB_*` env; throws when
  unconfigured — an unconfigured stub blocks, never admits). The server also
  accepts per-request `x-geo-*` stub headers ONLY behind an explicit
  `trustGeoStubHeaders` dep that defaults off and is documented test/dev-only.
- **Client gate** — `app/src/entry/geo-gate.ts` (pure, fetch-injected):
  'allowed' only on an explicit `{ allowed: true }`; no configured entry
  API, network failure, non-200, malformed body all answer 'blocked'.
  `play-client.tsx` renders the territory line from the copy module and
  withholds everything — attestation included — until the verdict is
  'allowed'.

## Judgement calls

1. **The schedule carries `allowed` as well as the D-B3 schema's `blocked`.**
   R2's posture is an allowlist (everything unlisted is unavailable); a
   blocked-list-only file would default a newly seen country to OPEN, which
   contradicts both R2 and D-B3's fail-closed instruction. `blocked` always
   wins over `allowed` and supports region granularity, so the founder's
   future levers (blocking a US state if the US ever enters the allowlist)
   are in place. Additive to the given schema, not a replacement.
2. **`blocked` ships empty.** The allowlist already excludes every
   non-listed territory; seeding explicit blocks would be inventing
   founder-owned legal content. The mechanism is tested with non-empty
   lists; the committed list waits for founder/counsel names.
3. **An unconfigured entry API blocks the play flow.** Fail-closed applies
   to the client too: with no `NEXT_PUBLIC_ENTRY_API_URL` the pay path
   cannot render. Development sets the env var and the stub. (Previously the
   flow rendered and failed at submit; that window is now closed.)
4. **The `/geo` answer is one boolean.** Which check decided — territory,
   VPN, lookup failure — is never disclosed, same posture as the packet
   service's single generic rejection.

## Tests

`backend/packet` 29 specs (was 8): schedule parse rejects nine
malformations; a fail-closed decision table over `territoryAllowed`;
blocked-region and lookup-failure issuance both landing on the one generic
rejection; `geoVerdict` false on every failure; both adapters (stub throws
unconfigured; vendor seam throws on non-200/malformed/empty-country); the
`/geo` route; stub headers honoured ONLY behind the opt-in; the committed
`config/territories.json` parsing and matching R2 exactly. App: 2 new
vitest specs for the client gate (144 total), typecheck + lint + production
build clean.

## For the founder

- The blocked list is yours: names go into `config/territories.json`
  (`blocked`, country or `US-NY`-form region codes) with counsel; no code
  change needed.
- The geo vendor of record (R2) is still needed for production — the
  HTTP adapter seam is ready; I need the vendor name, endpoint and key to
  finish C11-adjacent wiring. Until then the stub serves dev/tests only.
