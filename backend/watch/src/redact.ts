/*
 * Scrub evidence before it reaches Claude, and Claude's answer before it
 * reaches Telegram.
 *
 * Removed: credentials (RPC API keys in URLs, bearer and basic auth, Postgres
 * passwords, bot tokens, GitHub tokens, keypair byte arrays), every IP
 * address or prefix of one, wallet-length base58 strings that are not on the
 * keep list, and long base64 blobs. Kept: the program id and the other
 * public addresses passed in `keep`, pool ids, timestamps, machine ids.
 *
 * The services already truncate IPs to two octets before logging
 * (`backend/_shared/src/short.ts`); a two-octet prefix is still removed here,
 * because the data inventory promises no IP fragment leaves the platform's
 * own records (docs/compliance/DATA-INVENTORY.md).
 */

export type RedactionKind =
  | 'url-secret'
  | 'auth-header'
  | 'postgres-password'
  | 'telegram-token'
  | 'github-token'
  | 'keypair'
  | 'ipv4'
  | 'ipv6'
  | 'base58'
  | 'base64';

const RULES: [RedactionKind, RegExp, string][] = [
  // ?api-key=…, &token=…, ?key=… in any URL
  ['url-secret', /([?&](?:api[-_]?key|apikey|key|token|secret|access_token)=)[^&\s"'<>]+/gi, '$1<redacted>'],
  ['auth-header', /\b(authorization|bearer|basic)(\s*[:=]?\s*)(?:bearer\s+|basic\s+)?[A-Za-z0-9._~+/=-]{8,}/gi, '$1$2<redacted>'],
  ['postgres-password', /(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, '$1<redacted>@'],
  // No \b in front: in a request URL the token follows `/bot` directly.
  ['telegram-token', /(?<!\d)\d{6,12}:[A-Za-z0-9_-]{30,}/g, '<telegram-token>'],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '<github-token>'],
  // A Solana keypair file: 64 small integers in a JSON array.
  ['keypair', /\[\s*(?:\d{1,3}\s*,\s*){31,}\d{1,3}\s*\]/g, '<keypair>'],
  // Candidates only; `isAddress` below keeps clock times like 02:06:48.
  ['ipv6', /(?<![0-9a-z:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![0-9a-z:])/gi, '<ip>'],
  // Full addresses, and the `a.b.x.x` prefix `ipPrefix` (_shared/src/short.ts) logs.
  ['ipv4', /\b(?:\d{1,3}\.){3}\d{1,3}\b|\b\d{1,3}\.\d{1,3}\.x\.x\b/g, '<ip>'],
  ['base64', /\b[A-Za-z0-9+/]{120,}={0,2}/g, '<base64>'],
];

/**
 * Whether an address-shaped match is an address. IPv4: every octet fits in a
 * byte (so 1.98.4.2-style versions with a big part survive). IPv6: it has a
 * `::`, a hex letter, or at least five groups — a clock time (02:06:48) has
 * none of those.
 */
function isAddress(kind: 'ipv4' | 'ipv6', m: string): boolean {
  if (kind === 'ipv4') return m.split('.').every((o) => o === 'x' || Number(o) <= 255);
  return m.includes('::') || /[a-f]/i.test(m) || m.split(':').length >= 6;
}

/** Wallet- and signature-length base58: 32–88 characters with no 0, O, I or l. */
const BASE58 = /\b[1-9A-HJ-NP-Za-km-z]{32,88}\b/g;

export interface Redacted {
  text: string;
  counts: Partial<Record<RedactionKind, number>>;
}

export function redact(input: string, keep: readonly string[] = []): Redacted {
  const counts: Partial<Record<RedactionKind, number>> = {};
  let text = input;
  for (const [kind, re, replacement] of RULES) {
    text = text.replace(re, (...m: string[]) => {
      if ((kind === 'ipv4' || kind === 'ipv6') && !isAddress(kind, m[0])) return m[0];
      counts[kind] = (counts[kind] ?? 0) + 1;
      return replacement.replace(/\$(\d)/g, (_, i: string) => m[Number(i)] ?? '');
    });
  }
  const keepSet = new Set(keep);
  text = text.replace(BASE58, (m) => {
    if (keepSet.has(m)) return m;
    counts.base58 = (counts.base58 ?? 0) + 1;
    return `${m.slice(0, 4)}…`;
  });
  return { text, counts };
}
