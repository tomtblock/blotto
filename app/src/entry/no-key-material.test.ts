/*
 * No private key is ever written to browser, WebView or app storage.
 *
 * Why this exists: an automated security report (2026-10-11, triage item
 * pkg 5) read `localStorage.setItem(SECRET_KEY, …)` in entry/device.ts as a
 * Solana secret key in browser storage. It was a random salt for the
 * anti-abuse device marker, renamed since so that nothing reads it that way
 * again. This test makes the underlying property a standing check rather than
 * an explanation: no storage write anywhere in the app's own source may carry
 * a value whose expression names key material.
 *
 * The only keypair the client makes — the pass asset's — is generated in
 * memory per entry (`entry/services.ts`, `generateKeyPair`) and never stored.
 *
 * It scans source text, so it cannot see a key smuggled through a renamed
 * variable; what it pins is that nobody writes the obvious thing, and that
 * the names used for what IS stored stay honest.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));

/** A storage write: web storage `setItem`, or an IndexedDB `put`/`add`. */
const WRITE = /(?:localStorage|sessionStorage)\s*\.\s*setItem\s*\(([\s\S]*?)\)\s*;|\.(?:put|add)\s*\(([\s\S]*?)\)\s*;/g;
/** What a value must not be built from. */
const KEY_MATERIAL = /secretKey|privateKey|keypair|exportKey/i;

/** Every storage write in `text` whose arguments name key material. */
function keyMaterialWrites(text: string, usesIndexedDb: boolean): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(WRITE)) {
    const webStorageArgs = m[1];
    const idbArgs = m[2];
    const args = webStorageArgs ?? (usesIndexedDb ? idbArgs : undefined);
    if (args !== undefined && KEY_MATERIAL.test(args)) hits.push(m[0].replace(/\s+/g, ' ').slice(0, 160));
  }
  return hits;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

describe('no key material in client storage', () => {
  it('the scan catches what it is meant to catch (self-test)', () => {
    expect(keyMaterialWrites(`localStorage.setItem('k', JSON.stringify(kp.secretKey));`, false)).toHaveLength(1);
    expect(keyMaterialWrites(`sessionStorage.setItem(K, await exportKey('pkcs8', keypair.privateKey));`, false)).toHaveLength(1);
    expect(keyMaterialWrites(`store.put({ id: 1, value: keypair });`, true)).toHaveLength(1);
    // ...and leaves the honest ones alone.
    expect(keyMaterialWrites(`localStorage.setItem(SALT_STORAGE_NAME, hex(fresh));`, false)).toEqual([]);
    expect(keyMaterialWrites(`set.add(value);`, false)).toEqual([]);
  });

  it('no file under app/src writes key material to localStorage, sessionStorage or IndexedDB', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const hit of keyMaterialWrites(text, /indexedDB/.test(text))) {
        offenders.push(`${file.slice(SRC.length)}: ${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the device-marker salt is stored under a name that says salt', () => {
    const device = readFileSync(join(SRC, 'entry', 'device.ts'), 'utf8');
    expect(device).toContain("const SALT_STORAGE_NAME = 'blotto:device-salt:v3';");
    // The pre-2026-10-12 name survives only as the one-time migration source.
    expect(device.match(/device-secret/g) ?? []).toHaveLength(1);
  });
});
