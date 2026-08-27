# Step report — vendor adapters + verify auto-fetch + device marker (`step/c11-adapters`, C11)

**Status: delivered** — with the live-credential caveats §5 of the master
prompt anticipates, each listed below. Every vendor call shape was verified
against the INSTALLED SDK types (@turnkey/sdk-server 8.2.1, @turnkey/crypto
2.11.3, @irys/upload 0.0.15 + @irys/upload-solana 0.1.8, the installed
Privy SDK), never recalled.

**Stacks on C10** (`step/c10-review-service`).

## What was built

- **`TurnkeyCustody`** (`backend/sealing/src/custody-turnkey.ts`) — the
  production `PoolKeyCustody`. Two vendor facts shaped it, both discovered
  against the real types: Turnkey has NO X25519 curve, and the on-chain
  `sealing_secret_hash` must exist at `open_pool`, before any export. So
  the X25519 keypair is generated in-process, its public half + hash
  captured for publication, the 32-byte secret HPKE-imported into the
  sub-org (stored under the ED25519 label — a 32-byte scalar is a valid
  seed; the key only ever exports, never signs) and the local copy wiped.
  Export runs the adapter's `ExportPolicy` (the chain-state check — the
  sealing property, same as `LocalCustody`) BEFORE Turnkey is asked, then
  decrypts the export bundle to a fresh P256 target key and verifies the
  bytes against BOTH the published hash and the published public key —
  a corrupted vault answer fails loudly, never silently. Published halves
  ride a `PublishedKeyStore` so a restarted daemon republishes the SAME
  key. The HPKE envelope is an injected seam (`turnkeyEnvelope()` is the
  real @turnkey/crypto one) because the real functions verify enclave
  signatures no offline fake can produce.
- **The live export-refusal test** (`test/turnkey-live.spec.ts`) — runs
  the real enclave round-trip and the refusal-before-seal ONLY when the
  founder's credentials are in the environment; otherwise visibly pending,
  never silently green. Credentials needed (playbook §4):
  `TURNKEY_API_BASE_URL`, `TURNKEY_API_PUBLIC_KEY`,
  `TURNKEY_API_PRIVATE_KEY`, `TURNKEY_ORGANIZATION_ID`, `TURNKEY_USER_ID`.
- **`TurnkeyPacketSigner`** (`backend/packet/src/signer-turnkey.ts`) —
  the production `PacketSigner`: sign-only `signRawPayload`
  (hex encoding, no hash function — ed25519 hashes internally), r‖s
  assembled and length-checked. The public key is config
  (`Config.entry_signer` is public by definition); a mismatch fails at the
  program's Ed25519 check. Spec verifies the assembled signature against a
  REAL tweetnacl signature, so ordering/truncation cannot pass.
- **`IrysPublisher`** (`backend/reveal/src/publisher-irys.ts`) — one
  method, as roadmap 2.4 says: bundle JSON → permanent Irys transaction →
  `https://gateway.irys.xyz/<id>`, tagged for discovery
  (App-Name/Blotto-Pool/version). `irysUploaderFromEnv` builds the live
  uploader (`IRYS_UPLOAD_KEY` — the funded Solana wallet, `IRYS_NETWORK`);
  the SDK loads lazily so offline suites never touch it.
- **Verify page auto-fetch**: a pool address fetches the on-chain record
  from the indexer's `/verify-record`; a bundle URI fetches the published
  bundle. Pasting both JSONs stays, and always will — verification must
  work against a hostile or absent operator.
- **The device marker** (`app/src/entry/device.ts`, wired into
  `deviceHash()`): 32 random bytes persisted per browser profile;
  all-zeros when storage is closed (absence — detection ignores zeros,
  unchanged).

## Judgement calls

1. **R19's "Privy device fingerprint" does not exist.** The installed
   Privy SDK exposes no device or fingerprint surface at all. Shipped
   instead: the honest local marker above — same-device multi-entry still
   binds entries from one browser profile; a cleared profile evades it,
   like every best-effort signal in TECH-ARCH §9. FOUNDER DECISION
   OUTSTANDING: a stronger fingerprint means engaging a fingerprinting
   vendor (a privacy-posture call), or accepting the marker.
2. **Turnkey policies gate WHO, not WHEN.** Turnkey cannot read Solana
   state, so R21's "export before seal refused by Turnkey policy" splits
   into two enforced layers: the adapter's chain-state `ExportPolicy`
   (the sealing property, tested offline and live) and the sub-org policy
   restricting `exportPrivateKey` to the settlement service's API key
   (configured at provisioning; asserting that API error needs a second,
   unprivileged key — noted in the live spec).
3. **The X25519-under-ED25519-label import** is storage-label reuse,
   documented in the adapter; the credentialed live run confirms Turnkey
   round-trips the bytes exactly (the hash check makes any deviation loud).

## Tests

Sealing 13 + 1 pending (the live spec, credential-gated): refusal before
seal, real-envelope-free round-trip, wiped local copy, same-key resume,
loud hash mismatch on a corrupted vault, duplicate-create refusal. Packet
40 (3 new): activity shape + r‖s assembly verified against real Ed25519,
malformed answers refused. Reveal 22 (2 new): bundle JSON round-trip with
tags, id-less answer refused. App 176 vitest (3 new device-marker cases);
typecheck/lint/build clean; all three gates clean.

## For the founder — credentials this step is waiting on (§5 list)

| Credential | Used by |
|---|---|
| Turnkey sub-org (`TURNKEY_*`, five values above) | pool-key custody + entry-packet signer + the live refusal test |
| Entry signer key in that sub-org (`ENTRY_SIGNER_KEY_ID`, `ENTRY_SIGNER_PUBLIC_KEY_HEX`) | packet signer |
| Funded Irys upload wallet (`IRYS_UPLOAD_KEY`, `IRYS_NETWORK`) | bundle publisher |

Everything runs today on the local stubs (LocalCustody, LocalPacketSigner,
MemoryPublisher) exactly as before; the adapters swap in via the C12
deploy wiring the moment the credentials exist.
