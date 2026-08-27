/**
 * The detection pipeline (R11): run all five signals over a revealed pool,
 * log EVERYTHING (shadow mode is the launch default), and hard-block —
 * `flag_entry` before `pay_prizes` — ONLY on the two signals R11 names:
 * exact-duplicate battle sets and same-device multi-entry. Everything else
 * goes to the review queue with its evidence and needs a human (4.4).
 *
 * The "full escrow tier" (flag on ANY strong signal) sits behind
 * `Config.detection_hard_block` — the on-chain admin switch — and is OFF at
 * launch.
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
  /** `Config.detection_hard_block` mirrored from chain: the full-escrow tier. */
  fullEscrowTier: boolean;
}

export interface DetectionReport {
  pool: string;
  /** Every finding from every signal — the shadow-mode log. */
  findings: Finding[];
  /** Players the pipeline says to `flag_entry` BEFORE payout. */
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
