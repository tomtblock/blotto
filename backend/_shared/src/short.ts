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
