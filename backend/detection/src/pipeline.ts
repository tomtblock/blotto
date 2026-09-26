/**
 * The detection pipeline (R11): run all five signals over a revealed pool
 * and compute two lists — the players two independent signals agree on, and
 * the players R11's two conclusive signals name (exact-duplicate battle sets,
 * same-device multi-entry).
 *
 * ── NOTHING HERE ACTS. THIS IS A REPORT. ──────────────────────────────────
 *
 * Founder ruling D-E9 (2026-09-12, `docs/architecture/DECISIONS.md`): detection
 * is MANUAL. Every report is persisted (`reports.ts`, migration 0021) and
 * surfaced to the reviewer before the review window closes (`GET /detection`
 * in `server.ts`); no signal takes an automatic action. A flag is a
 * reviewer's signed decision through the review path, never the daemon's,
 * and `hardBlocks` is a list of players R11 WOULD block if the founder ever
 * ratified the automatic path — it is published to the reviewer and read by
 * no code that moves anything.
 *
 * THE DOC THIS HEADER USED TO CARRY WAS STALE (audit 2026-09-11, A-18 /
 * D-36). It said the full-escrow tier "sits behind
 * `Config.detection_hard_block` — the on-chain admin switch". That switch
 * exists on chain and `scripts/admin.ts set-detection-hard-block` can still
 * flip it, but NOTHING OFF-CHAIN READS IT: `fullEscrowTier` is passed
 * `false` by the daemon's one call site, as a constant. Flipping the on-chain
 * switch today changes nothing at all, and a comment that says otherwise is
 * worse than no comment — it describes a control the operator does not have.
 * R11's automatic path waits for ten settled pools of quiet shadow data and
 * stays a signed founder decision (plan §2b).
 *
 * Non-hard-block recommendations require TWO INDEPENDENT SIGNALS
 * (TECH-ARCH §9's thin-sample rule): one noisy signal alone never
 * recommends a flag.
 */

import {
  allocationEntropy,
  deviceIpCorrelation,
  duplicateSets,
  populationScore,
  timingProfile,
  type Finding,
  type RevealedEntry,
  type SignalName,
} from './signals';

export interface DetectionConfig {
  /**
   * The full-escrow tier: escalate ANY strong single signal.
   *
   * The on-chain `Config.detection_hard_block` is this switch's PUBLISHED
   * form, but no off-chain reader mirrors it onto this field — the daemon
   * passes `false`, a constant (header, D-36). Turning the automatic path on
   * is a founder decision that needs a reader written first, not a flag
   * flipped.
   */
  fullEscrowTier: boolean;
}

export interface DetectionReport {
  pool: string;
  /** Every finding from every signal — the whole record, persisted as-is. */
  findings: Finding[];
  /**
   * Players R11's two conclusive signals name. REPORTED, NOT ACTED ON
   * (ruling D-E9): the reviewer sees this list; nothing flags on it.
   */
  hardBlocks: string[];
  /** Players recommended for human review (two independent signals). */
  reviewRecommended: string[];
}

/** True when this finding alone justifies a hard block (R11). */
function isHardBlockFinding(f: Finding): boolean {
  if (f.signal === 'duplicate_sets') {
    return f.severity === 'strong'; // exact duplicate only — near-dupes go to review
  }
  if (f.signal === 'device_ip_correlation') {
    return f.severity === 'strong' && f.detail.startsWith('device fingerprint');
  }
  return false;
}

export function detectPool(
  pool: string,
  entries: RevealedEntry[],
  config: DetectionConfig
): DetectionReport {
  const findings: Finding[] = [
    ...allocationEntropy(entries),
    ...timingProfile(entries),
    ...duplicateSets(entries),
    ...deviceIpCorrelation(entries),
    ...populationScore(entries),
  ];

  const hardBlocks = new Set<string>();
  const signalsByPlayer = new Map<string, Set<SignalName>>();
  const strongByPlayer = new Map<string, number>();

  for (const f of findings) {
    if (isHardBlockFinding(f)) hardBlocks.add(f.player);
    const set = signalsByPlayer.get(f.player) ?? new Set<SignalName>();
    set.add(f.signal);
    signalsByPlayer.set(f.player, set);
    if (f.severity === 'strong') {
      strongByPlayer.set(f.player, (strongByPlayer.get(f.player) ?? 0) + 1);
    }
  }

  const reviewRecommended: string[] = [];
  for (const [player, signals] of signalsByPlayer) {
    if (hardBlocks.has(player)) continue;
    // Two independent signals — or, on the full-escrow tier, any strong one.
    if (signals.size >= 2 || (config.fullEscrowTier && (strongByPlayer.get(player) ?? 0) >= 1)) {
      reviewRecommended.push(player);
      if (config.fullEscrowTier) hardBlocks.add(player);
    }
  }

  return {
    pool,
    findings,
    hardBlocks: [...hardBlocks].sort(),
    reviewRecommended: reviewRecommended.sort(),
  };
}
