/**
 * The two truncations every service applies before an identifier reaches a
 * log line or an alert.
 *
 * Both existed three times over — the review server, the entry gate and the
 * entry-signer selector each carried a copy — and the copies had drifted in
 * their placeholders. On 2026-09-16, under the founder's data-minimisation
 * ruling of 2026-09-15, the alerts that still carried a whole wallet were
 * made to use the same rule as the request logs, and the rule moved here so
 * that there is exactly one.
 *
 * Neither function is a secrecy measure: wallets and pool addresses are
 * public on chain. They keep a pasted log or a forwarded alert from being a
 * directory of who played, which is what a log that outlives its purpose
 * turns into.
 */

/** First 6 and last 4 characters of an identifier; short values unchanged. */
export function short(v: string | undefined | null, absent = '<none>'): string {
  if (!v) return absent;
  return v.length <= 12 ? v : `${v.slice(0, 6)}…${v.slice(-4)}`;
}

/**
 * First two octets of a v4 address, or the first hextet of a v6 — enough to
 * correlate one caller across lines during an incident, never a whole
 * address. The same truncation is what reaches the durable sanctions
 * refusal record (B-36), so no store holds more of an address than a log.
 */
export function ipPrefix(ip: string | undefined | null, absent = 'unknown'): string {
  if (!ip) return absent;
  if (ip.includes(':')) return `${ip.split(':')[0]}:…`;
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.x.x` : 'unparsed';
}

/**
 * A URL with its query string and any userinfo removed, for a log line.
 *
 * UNLIKE the two functions above, this one IS a secrecy measure, and the
 * distinction matters: a wallet is public on chain and truncating it only
 * keeps a pasted log from becoming a directory, but an RPC url carries its
 * API key in the query string and printing it publishes a credential.
 *
 * Written after `review` logged the whole Helius devnet url — key included —
 * on every boot (devnet, 2026-09-24). One line, but it ran at every start, so
 * the key sat in the platform's log ring indefinitely; and the founder-facing
 * `backend-status` workflow copies four hundred log lines per app into a
 * GitHub Actions log, which is retained and readable by anyone with
 * repository access. Every run of that diagnostic re-published it.
 *
 * It FAILS CLOSED. An input that will not parse returns a placeholder rather
 * than the original string, because the case where a url is malformed is
 * exactly the case where nobody has checked what is in it.
 */
export function urlForLog(raw: string | undefined | null, absent = '<unset>'): string {
  if (!raw) return absent;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return '<unparseable url>';
  }
  // The host and the path are the operationally useful parts — they say which
  // provider and which cluster. The query string is where every provider this
  // project uses puts its key, so it goes in whole: a partial key is still
  // more than a log needs, and a scheme that redacted per-parameter would
  // leak the next provider that names its key something unexpected.
  const auth = u.username || u.password ? '…@' : '';
  const query = u.search ? '?…' : '';
  return `${u.protocol}//${auth}${u.host}${u.pathname}${query}`;
}
