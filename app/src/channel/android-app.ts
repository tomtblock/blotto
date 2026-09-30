/*
 * The Android package's identity, as the site publishes it (2026-09-30).
 *
 * A mobile wallet app verifies WHO is asking before it re-authorizes without
 * a prompt (Mobile Wallet Adapter, "dapp identity verification"): it reads
 * the calling app's package name, fetches `/.well-known/assetlinks.json` on
 * the identity URI's host — this site — and checks that the package and its
 * signing certificate are listed there. A browser is exempt (the wallet
 * trusts the page's origin); the shell is an app, and without this file the
 * wallet logs `not verified`, tolerates the first connect because the
 * player approves it on screen, and refuses every silent re-authorization
 * after it — so no signature ever completes (MOBILE.md §9).
 *
 * Read from Solana Mobile's own verifier (`digital-asset-links-android`
 * 1.0.4), which every MWA wallet is expected to use: the relation must be
 * `delegate_permission/common.handle_all_urls`; the document must come back
 * `200` with content type exactly `application/json`, with no redirect
 * followed; the fingerprint is the SHA-256 of the signing certificate as 32
 * colon-separated hex bytes. `app/src/app/.well-known/assetlinks.json/
 * route.ts` serves it; `src/proxy.ts` lets it through the gate, since the
 * wallet's fetch carries no cookie.
 *
 * Both values are the owner's: the package id is the permanent identity of
 * the store listing, and the fingerprint is that of the store signing key
 * (MOBILE.md §4). Neither is secret — both are readable from the published
 * package.
 */

/** The Android package id (`--application-id` at `webshell init`; MOBILE.md §3). */
export const ANDROID_PACKAGE_ID = 'gg.blotto.app';

/**
 * SHA-256 fingerprints of the certificates the package may be signed with,
 * as `apksigner verify --print-certs` prints them (64 hex digits, or the
 * colon form). More than one only while a key is being rotated.
 */
export const ANDROID_SIGNING_CERT_SHA256: readonly string[] = [
  // FILLED FROM THE OWNER'S KEYSTORE — see MOBILE.md §3 step 6.
];

export const ASSET_LINKS_RELATION = 'delegate_permission/common.handle_all_urls';

/** 64 hex digits, or 32 colon-separated hex bytes. */
const FINGERPRINT = /^(?:[0-9a-f]{64}|(?:[0-9a-f]{2}:){31}[0-9a-f]{2})$/i;

/**
 * A fingerprint in the form the verifier parses: upper-case hex bytes
 * separated by colons. Throws on anything that is not a SHA-256.
 */
export function normalizeFingerprint(raw: string): string {
  const s = raw.trim();
  if (!FINGERPRINT.test(s)) throw new Error(`not a SHA-256 certificate fingerprint: ${raw}`);
  const hex = s.replace(/:/g, '').toUpperCase();
  return hex.match(/.{2}/g)!.join(':');
}

export interface AssetLinkStatement {
  relation: string[];
  target: {
    namespace: 'android_app';
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
}

/** The Digital Asset Links document: one statement for the package. */
export function assetLinks(
  packageId: string = ANDROID_PACKAGE_ID,
  fingerprints: readonly string[] = ANDROID_SIGNING_CERT_SHA256,
): AssetLinkStatement[] {
  return [
    {
      relation: [ASSET_LINKS_RELATION],
      target: {
        namespace: 'android_app',
        package_name: packageId,
        sha256_cert_fingerprints: fingerprints.map(normalizeFingerprint),
      },
    },
  ];
}
