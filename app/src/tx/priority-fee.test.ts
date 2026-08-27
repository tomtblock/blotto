import { describe, expect, it } from "vitest";
import {
  cuLimitFromSimulation,
  MAX_CU_LIMIT,
  pickPriorityFee,
  PROVISIONAL_CU_LIMIT_FALLBACK,
  PROVISIONAL_PRIORITY_FEE_CAP_MICROLAMPORTS,
  PROVISIONAL_PRIORITY_FEE_FLOOR_MICROLAMPORTS,
} from "./priority-fee";

describe("pickPriorityFee", () => {
  it("returns the floor for an empty sample (quiet cluster)", () => {
    expect(pickPriorityFee([])).toBe(PROVISIONAL_PRIORITY_FEE_FLOOR_MICROLAMPORTS);
  });

  it("returns the floor when every recent slot priced at zero (devnet norm)", () => {
    expect(pickPriorityFee([0n, 0n, 0n])).toBe(
      PROVISIONAL_PRIORITY_FEE_FLOOR_MICROLAMPORTS,
    );
  });

  it("picks the percentile over the non-zero samples only", () => {
    // Non-zero sorted: [10k, 20k, 30k, 40k] — p75 index = floor(4·75/100) = 3.
    const fees = [0n, 10_000n, 0n, 40_000n, 20_000n, 30_000n];
    expect(pickPriorityFee(fees, 75, 0n, 10_000_000n)).toBe(40_000n);
    // p50 index = 2 → 30k.
    expect(pickPriorityFee(fees, 50, 0n, 10_000_000n)).toBe(30_000n);
  });

  it("clamps up to the floor and down to the cap", () => {
    expect(pickPriorityFee([2n, 3n])).toBe(
      PROVISIONAL_PRIORITY_FEE_FLOOR_MICROLAMPORTS,
    );
    expect(pickPriorityFee([10_000_000_000n])).toBe(
      PROVISIONAL_PRIORITY_FEE_CAP_MICROLAMPORTS,
    );
  });

  it("handles a single sample without index overflow", () => {
    expect(pickPriorityFee([5_000n], 100, 0n, 10_000_000n)).toBe(5_000n);
  });
});

describe("cuLimitFromSimulation", () => {
  it("falls back conservatively when simulation gave no number", () => {
    expect(cuLimitFromSimulation(null)).toBe(PROVISIONAL_CU_LIMIT_FALLBACK);
    expect(cuLimitFromSimulation(0n)).toBe(PROVISIONAL_CU_LIMIT_FALLBACK);
  });

  it("adds the provisional +20% margin", () => {
    expect(cuLimitFromSimulation(100_000n)).toBe(120_000);
    expect(cuLimitFromSimulation(33_333n)).toBe(39_999); // floor division
  });

  it("clamps to the protocol per-transaction ceiling", () => {
    expect(cuLimitFromSimulation(1_399_999n)).toBe(MAX_CU_LIMIT);
    expect(cuLimitFromSimulation(9_999_999n)).toBe(MAX_CU_LIMIT);
  });
});
