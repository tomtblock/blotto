/**
 * The five detection signals (TECH-ARCH §9), computed over REVEALED data —
 * nothing here runs before a pool closes, so nothing here can see a sealed
 * battle. Seven battles per player is a thin sample (§9's own warning):
 * every signal returns a graded severity, and the pipeline requires TWO
 * independent signals before recommending a flag — except the two hard-block
 * signals R11 names (exact duplicates, same device), which are conclusive
 * alone.
 *
 * Every threshold in this file is an ARCHITECT PROPOSAL for the founder's
 * detection design space, marked inline; the pipeline logs the raw values so
 * thresholds can be tuned from shadow-mode data (which is the point of
 * launching in shadow mode).
 */

export interface RevealedEntry {
  player: string;
  index: number;
  /** 7×5 stat values. */
  battles: number[][];
  timingsMs: number[];
  /** Hex device fingerprint (Privy, R19) from the sealed payload. */
  deviceHash: string;
  /** Hashed IP recorded at ciphertext submission. */
  ipHash: string;
  /** Final half-point score, once scored. */
  scoreHalf: number;
}

export type SignalName =
  | 'allocation_entropy'
  | 'timing_profile'
  | 'duplicate_sets'
  | 'device_ip_correlation'
  | 'population_score';

export interface Finding {
  signal: SignalName;
  player: string;
  severity: 'note' | 'strong';
  /** Human-readable evidence for the review page — numbers, not verdicts. */
  detail: string;
  /** Correlated players, where the signal is pairwise. */
  correlated?: string[];
}

/** 1. Allocation entropy: reuse, round numbers, symmetric splits. */
export function allocationEntropy(entries: RevealedEntry[]): Finding[] {
  const findings: Finding[] = [];
  for (const e of entries) {
    const sets = e.battles.map((b) => b.join(','));
    const distinct = new Set(sets).size;
    const values = e.battles.flat();
    const roundShare = values.filter((v) => v % 10 === 0).length / values.length;
    // PROPOSED thresholds: ≥6 identical battles of 7, or ≥90% multiples of 10
    // (the even-split default is all-round, so untouched screens weigh in —
    // deliberate: an all-defaults entry IS low-entropy).
    if (distinct <= 2) {
      findings.push({
        signal: 'allocation_entropy',
        player: e.player,
        severity: 'strong',
        detail: `${distinct} distinct battle shapes across 7 battles`,
      });
    } else if (roundShare >= 0.9) {
      findings.push({
        signal: 'allocation_entropy',
        player: e.player,
        severity: 'note',
        detail: `${Math.round(roundShare * 100)}% of stat values are multiples of 10`,
      });
    }
  }
  return findings;
}

/** 2. Timing profile: scripts are uniform; humans slow on battle one. */
export function timingProfile(entries: RevealedEntry[]): Finding[] {
  const findings: Finding[] = [];
  for (const e of entries) {
    const t = e.timingsMs;
    if (t.length < 7) continue;
    const mean = t.reduce((a, b) => a + b, 0) / t.length;
    if (mean <= 0) continue;
    const variance = t.reduce((a, b) => a + (b - mean) ** 2, 0) / t.length;
    const cv = Math.sqrt(variance) / mean;
    // PROPOSED: coefficient of variation < 0.05 across seven screens is
    // machine-uniform; humans spread far wider.
    if (cv < 0.05) {
      findings.push({
        signal: 'timing_profile',
        player: e.player,
        severity: 'strong',
        detail: `uniform per-screen timings (cv=${cv.toFixed(3)}, mean=${Math.round(mean)}ms)`,
      });
    } else if (mean < 800) {
      // PROPOSED: sub-800ms average per screen is faster than reading it.
      findings.push({
        signal: 'timing_profile',
        player: e.player,
        severity: 'note',
        detail: `mean per-screen time ${Math.round(mean)}ms`,
      });
    }
  }
  return findings;
}

/** 3. Duplicate / near-duplicate battle sets across entries — the strongest
 * single signal (35 identical bytes between independent humans is
 * near-impossible). Exact duplicates are a HARD BLOCK signal (R11). */
export function duplicateSets(entries: RevealedEntry[]): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i].battles.flat();
      const b = entries[j].battles.flat();
      const l1 = a.reduce((acc, v, k) => acc + Math.abs(v - b[k]), 0);
      if (l1 === 0) {
        for (const e of [entries[i], entries[j]]) {
          findings.push({
            signal: 'duplicate_sets',
            player: e.player,
            severity: 'strong',
            detail: 'exact 35-byte duplicate battle set',
            correlated: [entries[i].player, entries[j].player].filter((p) => p !== e.player),
          });
        }
      } else if (l1 <= 10) {
        // PROPOSED: total L1 distance ≤ 10 across 35 values is a near-copy.
        for (const e of [entries[i], entries[j]]) {
          findings.push({
            signal: 'duplicate_sets',
            player: e.player,
            severity: 'note',
            detail: `near-duplicate battle set (L1 distance ${l1})`,
            correlated: [entries[i].player, entries[j].player].filter((p) => p !== e.player),
          });
        }
      }
    }
  }
  return findings;
}

/** 4. Device / IP correlation within a pool. Same device is a HARD BLOCK
 * signal (R11) — one entry per wallet is a program invariant, so the same
 * device behind two wallets IS multi-accounting. */
export function deviceIpCorrelation(entries: RevealedEntry[]): Finding[] {
  const findings: Finding[] = [];
  const byKey = (key: (e: RevealedEntry) => string, severity: 'note' | 'strong', what: string) => {
    const groups = new Map<string, RevealedEntry[]>();
    for (const e of entries) {
      const k = key(e);
      if (!k || /^0+$/.test(k)) continue; // zeroed fingerprints group nothing
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      for (const e of group) {
        findings.push({
          signal: 'device_ip_correlation',
          player: e.player,
          severity,
          detail: `${what} shared by ${group.length} entries`,
          correlated: group.map((g) => g.player).filter((p) => p !== e.player),
        });
      }
    }
  };
  byKey((e) => e.deviceHash, 'strong', 'device fingerprint');
  byKey((e) => e.ipHash, 'note', 'IP address');
  return findings;
}

/** 5. Population-relative score: far outside the field distribution. */
export function populationScore(entries: RevealedEntry[]): Finding[] {
  const scores = entries.map((e) => e.scoreHalf);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
  const sd = Math.sqrt(variance);
  if (sd === 0) return [];
  const findings: Finding[] = [];
  for (const e of entries) {
    const z = (e.scoreHalf - mean) / sd;
    // PROPOSED: |z| ≥ 3 over a 64-player field is worth a look — a note,
    // never conclusive (someone IS best).
    if (Math.abs(z) >= 3) {
      findings.push({
        signal: 'population_score',
        player: e.player,
        severity: 'note',
        detail: `score z=${z.toFixed(2)} against the field`,
      });
    }
  }
  return findings;
}
