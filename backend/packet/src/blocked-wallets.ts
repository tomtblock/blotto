/**
 * The wallet blocklist (terms clause "Refusing entry and withholding a
 * prize", 2026-09-19) — the founder-owned list of addresses the entry
 * service will not issue a packet to.
 *
 * WHY IT EXISTS. The terms say Blotto Cup may refuse to accept an entry
 * from an address on enumerated grounds. Before this module there was no
 * mechanism that could do it: the only address-level refusal was the
 * sanctions screening, which answers about published lists and about
 * nothing else. A clause with no mechanism behind it is the defect this
 * repository has been bitten by five times (`published-claims.test.ts`), so
 * the list is built before the clause is written.
 *
 * SHAPE. Deliberately the territory schedule's (`territories.ts`), down to
 * the fail-closed parse: a founder-owned JSON document at the repository
 * root, one parser, validated at service boot, and consulted inside
 * `issuePacket` alongside the territory, VPN, sanctions and attestation
 * checks — so a blocked address gets the SAME generic rejection as every
 * other refusal and the gate stays non-probeable.
 *
 *   { "version": 1, "wallets": [], "updated": "YYYY-MM-DD" }
 *
 * Addresses are base58 Solana public keys. The file ships EMPTY: the
 * mechanism exists, nobody is on it.
 *
 * WHAT IT IS NOT. It is not a sanctions list (that is `backend/sanctions/`,
 * live published sources, refreshed) and it holds no reason text. The
 * grounds relied on for each address live in `config/blocked-wallets.README.md`
 * — outside the service, because a reason is for the record and for the
 * player who asks, not for a runtime decision — and `scripts/check-blocked-wallets.ts`
 * fails the build when an address is listed without one. A blocklist
 * without recorded reasons is the first thing a regulator asks about.
 *
 * FAIL CLOSED. Any malformation throws, and the service does not start. The
 * alternative — carrying on with an empty list — would silently admit every
 * address the founder had listed, which is the same failure mode
 * `assertRegionCapability` exists to prevent for sub-national territories.
 */

import { readFileSync } from 'fs';

export interface WalletBlocklist {
  version: number;
  /** Base58 addresses refused a packet. Founder-owned; may be empty. */
  wallets: readonly string[];
  /** Founder's last-edited date, informational. */
  updated: string;
}

/** Base58, 32–44 characters — the same shape every route here validates. */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Parse + validate a blocklist document. Throws on ANY malformation — a
 * list that cannot be trusted must not silently admit everyone on it.
 */
export function parseWalletBlocklist(text: string): WalletBlocklist {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('wallet blocklist: not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('wallet blocklist: not an object');
  }
  const doc = raw as Partial<WalletBlocklist>;
  if (!Number.isInteger(doc.version) || (doc.version as number) < 1) {
    throw new Error('wallet blocklist: version must be a positive integer');
  }
  if (typeof doc.updated !== 'string' || doc.updated.length === 0) {
    throw new Error('wallet blocklist: updated must be a non-empty string');
  }
  if (!Array.isArray(doc.wallets)) {
    throw new Error('wallet blocklist: wallets must be an array');
  }
  const seen = new Set<string>();
  for (const wallet of doc.wallets) {
    if (typeof wallet !== 'string' || !BASE58.test(wallet)) {
      throw new Error(`wallet blocklist: bad address ${JSON.stringify(wallet)}`);
    }
    // A duplicate is harmless to the decision and a sign the file was edited
    // twice without reading it — which is exactly when a reason row goes
    // missing. Refuse it rather than dedupe silently.
    if (seen.has(wallet)) {
      throw new Error(`wallet blocklist: ${wallet} is listed twice`);
    }
    seen.add(wallet);
  }
  return {
    version: doc.version as number,
    wallets: [...(doc.wallets as string[])],
    updated: doc.updated,
  };
}

/** Load and validate `config/blocked-wallets.json` (deployment wiring). */
export function loadWalletBlocklist(path: string): WalletBlocklist {
  return parseWalletBlocklist(readFileSync(path, 'utf8'));
}

/**
 * The one decision function: membership, and nothing else.
 *
 * It deliberately does NOT judge the address's SHAPE. `handleEntryRoute`
 * refuses anything that is not base58 before `issuePacket` is reached, with
 * the same generic rejection (`server.ts`, the `/packet` branch), so a
 * malformed address never arrives here in production — and a second,
 * slightly different rule in this module would be the kind of drift that
 * makes two gates disagree about the same input. A blocklist answers one
 * question: is this address on the list.
 */
export function walletAllowed(list: WalletBlocklist, wallet: string | undefined | null): boolean {
  if (typeof wallet !== 'string') return true;
  return !list.wallets.includes(wallet);
}

/**
 * The committed file's contents, for tests and for a deployment with no
 * config file. EMPTY at launch: the mechanism the terms clause needs
 * exists, and nobody is on it. `blocked-wallets.spec.ts` pins this mirror
 * to the committed file, as `territories.spec.ts` does for the schedule.
 */
export const DEFAULT_WALLET_BLOCKLIST: WalletBlocklist = {
  version: 1,
  wallets: [],
  updated: '2026-09-19',
};
