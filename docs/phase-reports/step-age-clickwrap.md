# Step report — age attestation clickwrap (`step/b4-age-clickwrap`, D-B4)

**Status: delivered.** Item B4 of the 2026-08-27 master build prompt. Age and
identity policy is a self-attestation clickwrap ONLY — no KYC provider, no
age-verification vendor; the program's KYC-at-claim switch stays built, OFF,
untouched (checked: nothing in this step touches it).

**Stacks on B3** (same packet-service files): the PR's base is
`step/b3-geo-blocking`; it retargets to `main` once PR #5 merges.

## What was built

- **The versioned clickwrap** (play page, before any paid action, after the
  geo gate and sign-in): two explicit unchecked checkboxes — the 18+
  attestation line and terms acceptance naming the version — with the accept
  button disabled until both are ticked. On accept the wallet SIGNS the
  canonical attestation message and the record is stored server-side. The
  gate is a wallet-keyed component; its device cache key carries the terms
  version, so a version bump re-prompts every wallet.
- **The canonical message** (`backend/_shared/src/attestation-message.ts`,
  one browser-bundleable definition used by both the app and the service):
  human-readable text naming the version, the 18+ statement and the wallet —
  wallets display what is being signed. Any wording change is a new terms
  version by definition.
- **The attestation store** (`backend/packet/src/attestations.ts`):
  `{ wallet, termsVersion, attested18: true, timestamp, walletSignature }`,
  persisted ONLY after the Ed25519 signature verifies against the wallet's
  own key for the CURRENT version (`config/terms.json`, founder-owned).
  `POST /attestation` on the entry server (204 / a reasonless 403);
  deliberately NO read endpoint — the client re-prompts from its device
  cache and issuance is the authority.
- **Issuance requires the record.** The old per-request `ageAttested`
  boolean is gone from the `/packet` API; the service looks the wallet up in
  the store and refuses (the one generic rejection) unless a record exists
  at the current version.
- **`terms_version` in the entry packet** — the canonical packet grows from
  83 to 85 bytes (u16 LE at offset 83). The on-chain verifier
  (`entry_packet.rs`) parses it, refuses 0 (`PacketTermsVersionMissing`,
  6046), and `EntryRegistered` emits it — the durable program-side record
  tying every entry to an accepted version. Python packet oracle, TS issuer,
  LiteSVM harness and the event decoders all carry the new layout; the
  cross-language fixture is regenerated from real emitted bytes; migration
  `0005_terms_version.sql` adds the column to the derived `entries` table.
- **`TxSigner.signMessage?`** (optional) with the Privy adapter implementing
  it via the SDK's `useSignMessage` (verified against the installed types).
  An adapter without message signing cannot attest — fail-closed, like the
  geo gate and the unconfigured-API case.

## Judgement calls

1. **The program checks `terms_version >= 1`, not `== current`.** The chain
   cannot know the service's current version and should not: version
   currency is issuance policy; the program's job is the durable record
   (packet + event). Bumping the version therefore needs no program change.
2. **No attestation read endpoint.** A public `GET` would let anyone probe
   whether a wallet ever attested. The device cache decides only whether to
   SHOW the clickwrap; a stale cache just means a harmless re-prompt.
3. **The refusal on `/attestation` is reasonless** (wrong version and bad
   signature answer identically), matching the packet service's
   single-generic-rejection posture.
4. **The message lives in `backend/_shared`** so the app signs byte-for-byte
   what the service verifies — pinned by a parity test importing both.

## Tests

- Program: policy unit test for the 6046 refusal; round-trip at 85 bytes;
  LiteSVM 19/19 including a real terms=0 transaction refused by the compiled
  artifact.
- `backend/packet` 37 specs: acceptance stores only a wallet-signed,
  current-version submission; wrong-key/wrong-version/malformed all refuse
  storing nothing; issuance refuses without a record and after a version
  bump, and a re-attestation restores it; the `/attestation` route; the
  85-byte oracle pin (new `terms_v2` vector).
- App 149 vitest (5 new): message parity with the service, fail-closed
  submission, version-keyed cache; typecheck, lint, production build clean.
- Indexer 28 + _shared 42 against the regenerated real-bytes fixture;
  reveal 8; rehearsal 3; `cargo fmt`/`clippy -D warnings`/workspace tests
  clean.

## For the founder

- `config/terms.json` is yours: bump `version` when the terms change and
  every wallet re-attests before entering again. No code change needed.
- The actual terms document the clickwrap references is Phase 6 founder +
  counsel prose (R4); the mechanism records acceptance of whatever version
  you publish.
