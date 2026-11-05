/*
 * TestNetworkNotice (2026-11-05): one line at the top of every page saying
 * the site runs on the test network.
 *
 * Until today the site was behind a code gate and only invited people saw
 * it. With the gate gone, anyone can arrive from a shared link, and nothing
 * on the page said that the SOL involved is test SOL with no value. This is
 * that sentence, on every page, from the root layout.
 *
 * Keyed on the build's cluster (src/chain/cluster.ts), never on a host or a
 * flag someone has to remember: a mainnet build renders nothing here, by
 * construction, so the notice cannot leak onto the real-money site and cannot
 * be forgotten on the test one.
 *
 * Server component, no state, no script: it adds one short paragraph to the
 * first paint and nothing to the client bundle.
 */
import { COPY } from "@/copy";
import { isMainnet } from "@/chain/cluster";

export function TestNetworkNotice() {
  if (isMainnet()) return null;
  return (
    <p
      role="note"
      data-testid="test-network-notice"
      className="w-full border-b border-overlay bg-raised px-4 py-1.5 text-center font-mono text-[11px] tracking-[0.04em] text-ink-muted"
    >
      {COPY.shell.testNetworkNotice}
    </p>
  );
}
