/**
 * The mirrored OFAC SDN list — the fallback that keeps screening answering
 * when a vendor does not.
 *
 * Contract verified against the LIVE file on 2026-09-07 (downloaded from
 * this repository's build environment and read, not recalled):
 *
 *   GET https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML
 *     → 302 to a short-lived S3 URL → ~29 MB XML
 *   <sdnList><publshInformation><Publish_Date>MM/DD/YYYY</Publish_Date>...
 *     <sdnEntry><uid/><lastName/><firstName/><sdnType/>
 *       <programList><program>…</program></programList>
 *       <idList><id><uid/><idType>Digital Currency Address - SOL</idType>
 *                       <idNumber>42RLPACw…</idNumber></id>…
 *
 * Sixteen tickers appear under "Digital Currency Address - <TICKER>" today
 * (XBT, ETH, TRX, USDT, LTC, XMR, DASH, ZEC, USDC, SOL, DOGE, BCH, XVG, ETC,
 * BTG, BNB). Every one is mirrored, not only SOL: a listed address is a
 * listed address whatever ledger it was designated on, and the cost of
 * over-matching a Solana-shaped string against another chain's set is nil.
 * (The legacy treasury.gov/ofac/downloads URLs now return empty bodies;
 * the CSV on the new host is the header-less legacy format, so the XML is
 * the one parsed.)
 *
 * Two properties are load-bearing:
 *
 *   1. A STALE MIRROR DOES NOT ANSWER. Past `maxAgeMs` since the last
 *      successful refresh the mirror throws instead of saying "not listed";
 *      the composite records it as failed and the vendors decide. A
 *      designation published this morning must not be missed because a
 *      refresh job died last week.
 *   2. A FAILED REFRESH KEEPS THE LAST GOOD SET. Nothing is cleared on error,
 *      so a transient outage of the Treasury host does not turn a working
 *      mirror into an empty one.
 *
 * The parse is a streaming split on `<sdnEntry>` boundaries with regexes
 * over each entry — deliberately no XML library, so the package stays
 * dependency-free and the parse cannot be wrong in a way a fixture would not
 * catch. `test/ofac-sdn.spec.ts` runs it over a VERBATIM excerpt of the live
 * file (`fixtures/ofac-sdn-excerpt.xml`).
 */

import { readFile } from 'fs/promises';
import type { SanctionsCheck, SanctionsMatch, SanctionsVerdict } from './seam';

export const OFAC_SDN_XML_URL =
  'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML';

const ID_TYPE_PREFIX = 'Digital Currency Address - ';

export interface OfacListing {
  /** The SDN entry's uid. */
  readonly uid: string;
  readonly name: string;
  readonly programs: readonly string[];
  /** The ticker after "Digital Currency Address - ". */
  readonly ticker: string;
}

export interface OfacMirrorSnapshot {
  readonly publishDate: string | null;
  readonly entries: number;
  readonly addresses: number;
  readonly loadedAt: Date;
}

export interface OfacSdnOptions {
  /** Where to fetch the XML; default the Sanctions List Service export. */
  url?: string;
  /** A local file to read instead of fetching — an offline mirror, or the fixture. */
  path?: string;
  fetchImpl?: typeof fetch;
  /** Answer only while the last successful load is younger than this. Default 36 h. */
  maxAgeMs?: number;
  /**
   * Abort the download after this long. Default 2 minutes.
   *
   * The fetch had NO bound until 2026-09-08. It runs in a required boot path in
   * both callers — the packet service will not listen until it returns, and the
   * daemon budgets it — so an endpoint that accepts the connection and then
   * stalls hung the boot with no deadline and no log line. A bound turns that
   * into a named failure at a known time. It is generous on purpose: the
   * document is ~29 MB and a slow transfer is not a fault.
   */
  timeoutMs?: number;
  now?: () => Date;
}

/** Parse the SDN XML into address → listings. Exported for the fixture test. */
export function parseSdnXml(xml: string): {
  publishDate: string | null;
  entries: number;
  byAddress: Map<string, OfacListing[]>;
} {
  const publishDate = xml.match(/<Publish_Date>([^<]*)<\/Publish_Date>/)?.[1] ?? null;
  const byAddress = new Map<string, OfacListing[]>();
  let entries = 0;
  const entryRe = /<sdnEntry>([\s\S]*?)<\/sdnEntry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(xml)) !== null) {
    entries++;
    const e = m[1];
    const uid = e.match(/^\s*<uid>([^<]*)<\/uid>/)?.[1] ?? '';
    const last = e.match(/<lastName>([^<]*)<\/lastName>/)?.[1] ?? '';
    const first = e.match(/<firstName>([^<]*)<\/firstName>/)?.[1] ?? '';
    const name = [first, last].filter((s) => s.length > 0).join(' ') || '(unnamed)';
    const programs = [...e.matchAll(/<program>([^<]*)<\/program>/g)].map((p) => p[1]);
    const idRe = /<id>[\s\S]*?<idType>([^<]*)<\/idType>\s*<idNumber>([^<]*)<\/idNumber>[\s\S]*?<\/id>/g;
    let id: RegExpExecArray | null;
    while ((id = idRe.exec(e)) !== null) {
      const idType = decodeEntities(id[1]);
      if (!idType.startsWith(ID_TYPE_PREFIX)) continue;
      const address = decodeEntities(id[2]).trim();
      if (address.length === 0) continue;
      const listing: OfacListing = {
        uid,
        name: decodeEntities(name),
        programs,
        ticker: idType.slice(ID_TYPE_PREFIX.length),
      };
      const list = byAddress.get(address);
      if (list) list.push(listing);
      else byAddress.set(address, [listing]);
    }
  }
  return { publishDate, entries, byAddress };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export class OfacSdnMirror implements SanctionsCheck {
  private byAddress: Map<string, OfacListing[]> | null = null;
  private snapshot: OfacMirrorSnapshot | null = null;
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  /** Past this age since `loadedAt`, `screen` refuses. Public so a caller can pace `refresh()` under it. */
  readonly maxAgeMs: number;
  private readonly now: () => Date;

  constructor(private readonly o: OfacSdnOptions = {}) {
    this.url = o.url ?? OFAC_SDN_XML_URL;
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.timeoutMs = o.timeoutMs ?? 120_000;
    this.maxAgeMs = o.maxAgeMs ?? 36 * 60 * 60 * 1000;
    this.now = o.now ?? (() => new Date());
  }

  /** What is loaded, for the startup line and the health payload. */
  status(): OfacMirrorSnapshot | null {
    return this.snapshot;
  }

  /**
   * How stale the loaded list is, in ms, or `null` when nothing is loaded.
   * The staleness watch (`wire.ts`) reads it; `screen` applies it.
   */
  ageMs(): number | null {
    if (!this.snapshot) return null;
    return this.now().getTime() - this.snapshot.loadedAt.getTime();
  }

  /**
   * Load or refresh. Throws on failure and KEEPS the previous set (property
   * 2). Call once at startup, then on a schedule; `screen` never fetches.
   *
   * `timeoutMs` overrides this instance's download deadline for THIS call
   * only. The boot loader uses it to spend a retry budget across several
   * attempts instead of letting the first one consume all of it — the
   * default (two minutes) is sized for one unhurried 29 MB transfer, not for
   * three of them (audit 2026-09-11, C-18).
   */
  async refresh(opts: { timeoutMs?: number } = {}): Promise<OfacMirrorSnapshot> {
    const xml = this.o.path
      ? await readFile(this.o.path, 'utf8')
      : await this.download(opts.timeoutMs ?? this.timeoutMs);
    const parsed = parseSdnXml(xml);
    if (parsed.entries === 0) throw new Error('ofac-sdn: the document holds no <sdnEntry> — not the SDN list');
    this.byAddress = parsed.byAddress;
    this.snapshot = {
      publishDate: parsed.publishDate,
      entries: parsed.entries,
      addresses: parsed.byAddress.size,
      loadedAt: this.now(),
    };
    return this.snapshot;
  }

  async screen(address: string): Promise<SanctionsVerdict> {
    if (!this.byAddress || !this.snapshot) {
      throw new Error('ofac-sdn: mirror not loaded — call refresh() first');
    }
    const age = this.now().getTime() - this.snapshot.loadedAt.getTime();
    if (age > this.maxAgeMs) {
      // Property 1: a stale mirror is a failed source, never a clean answer.
      throw new Error(
        `ofac-sdn: mirror is ${Math.floor(age / 3_600_000)} h old (limit ${Math.floor(
          this.maxAgeMs / 3_600_000
        )} h) — refusing to answer from a stale list`
      );
    }
    const listings = this.byAddress.get(address.trim()) ?? [];
    const matches: SanctionsMatch[] = listings.map((l) => ({
      source: 'ofac-sdn',
      listName: l.programs.length > 0 ? l.programs.join(',') : 'SDN',
      entityName: l.name,
      entityId: l.uid,
      addressMatched: address,
    }));
    return {
      address,
      listed: matches.length > 0,
      matches,
      consulted: ['ofac-sdn'],
      failed: [],
      checkedAt: this.now().toISOString(),
    };
  }

  private async download(timeoutMs: number): Promise<string> {
    // fetch follows the 302 to the presigned S3 URL by default.
    //
    // The signal covers the WHOLE exchange, redirect and body included, because
    // `res.text()` is where a ~29 MB transfer actually spends its time — a
    // timeout that stopped at the response head would bound the part that never
    // hangs and leave the part that does.
    const signal = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        headers: { accept: 'application/xml' },
        signal,
      });
    } catch (err) {
      throw signal.aborted
        ? new Error(`ofac-sdn: timed out after ${timeoutMs}ms fetching ${this.url}`)
        : err;
    }
    if (!res.ok) throw new Error(`ofac-sdn: HTTP ${res.status} fetching ${this.url}`);
    try {
      return await res.text();
    } catch (err) {
      throw signal.aborted
        ? new Error(`ofac-sdn: timed out after ${timeoutMs}ms reading ${this.url}`)
        : err;
    }
  }
}
