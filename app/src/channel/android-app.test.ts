import { describe, expect, it } from 'vitest';
import {
  ANDROID_PACKAGE_ID,
  ANDROID_SIGNING_CERT_SHA256,
  ASSET_LINKS_RELATION,
  assetLinks,
  normalizeFingerprint,
} from './android-app';
import { GET } from '@/app/.well-known/assetlinks.json/route';

// The verifier's own pattern (digital-asset-links-android 1.0.4,
// AssetLinksGrammar.SHA256_CERT_FINGERPRINT_PATTERN): upper-case, colons.
const VERIFIER_PATTERN = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;

const HEX = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const COLONS = 'A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90';

describe("the Android package's published identity (2026-09-30)", () => {
  it('normalizes a fingerprint from either form into the form the verifier parses', () => {
    expect(normalizeFingerprint(HEX)).toBe(COLONS);
    expect(normalizeFingerprint(COLONS.toLowerCase())).toBe(COLONS);
    expect(normalizeFingerprint(` ${COLONS} `)).toBe(COLONS);
    expect(normalizeFingerprint(HEX)).toMatch(VERIFIER_PATTERN);
  });

  it('refuses anything that is not a SHA-256', () => {
    expect(() => normalizeFingerprint(HEX.slice(0, 40))).toThrow(/not a SHA-256/);
    expect(() => normalizeFingerprint('zz' + HEX.slice(2))).toThrow(/not a SHA-256/);
    expect(() => normalizeFingerprint('')).toThrow(/not a SHA-256/);
  });

  it('publishes one android_app statement with the relation the verifier requires', () => {
    expect(assetLinks('gg.example', [HEX])).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: 'gg.example', sha256_cert_fingerprints: [COLONS] },
      },
    ]);
    expect(ASSET_LINKS_RELATION).toBe('delegate_permission/common.handle_all_urls');
  });

  it('the live values: the package id, and every fingerprint in the verifier form', () => {
    expect(ANDROID_PACKAGE_ID).toBe('gg.blotto.app');
    // Empty means a wallet cannot verify the shell and refuses to re-authorize
    // it — the whole point of the file (MOBILE.md §3 step 6).
    expect(ANDROID_SIGNING_CERT_SHA256.length).toBeGreaterThan(0);
    for (const fp of assetLinks()[0]!.target.sha256_cert_fingerprints) expect(fp).toMatch(VERIFIER_PATTERN);
  });

  it('the route answers 200, content type exactly application/json, the document itself', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual(assetLinks());
  });
});
