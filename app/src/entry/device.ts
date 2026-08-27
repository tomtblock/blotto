/*
 * The device marker (C11, R19's slot) — what `deviceHash()` in the sealed
 * payload carries.
 *
 * R19 planned "the Privy device fingerprint"; the installed Privy SDK
 * exposes NO device or fingerprint surface (checked against
 * @privy-io/react-auth's types, 2026-08-27), so that plan cannot be built
 * as written. What ships instead is honest about what it is: 32 random
 * bytes generated once per browser profile and persisted in localStorage.
 * Two entries from the same browser carry the same marker (the same-device
 * multi-entry signal works); a cleared profile or private window yields a
 * fresh marker (the signal is best-effort, exactly as TECH-ARCH §9 treats
 * every detection signal). Where storage is unavailable the marker is
 * ALL ZEROS, which detection explicitly ignores — absence, never a fake.
 *
 * Raised for the founder in the step report: a stronger fingerprint means
 * a fingerprinting vendor, which is a privacy-posture decision, not a
 * drop-in.
 */

const KEY = 'blotto:device-marker:v1';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** The persisted 32-byte device marker; all-zeros when storage is closed. */
export function deviceMarker(): Uint8Array {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing && /^[0-9a-f]{64}$/.test(existing)) return unhex(existing);
    const fresh = new Uint8Array(32);
    crypto.getRandomValues(fresh);
    localStorage.setItem(KEY, hex(fresh));
    return fresh;
  } catch {
    return new Uint8Array(32);
  }
}
