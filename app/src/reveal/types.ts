/*
 * Reveal outcome seam — the ONLY source of a revealed outcome the reveal
 * surface imports.
 *
 * Carried from the predecessor repository. The isolation shape is the reason it
 * was worth carrying: the reveal loop depends on this narrow interface, never on
 * a transport, so the animation can be built and tested before the chain wiring
 * exists and neither one drags the other around.
 *
 * ⚠ PROVISIONAL. The real transport does not exist yet — Phase 1 writes
 * `register`, Phase 3 wires this seam to it. The shape below mirrors what the
 * chain will make available at confirmation (the drawn class, the seat index, the
 * minted Core asset) and may NOT be cited as a contract until it does.
 */

import type { TxFailure } from "@/tx/types";

/**
 * The cosmetic character class, `0..4` — Goblin, Knight, Wizard, Dragon, Titan
 * (PID §3).
 *
 * The predecessor's equivalent ran `0..5` over six rarity tiers; this product has
 * five classes, drawn `[38, 15, 7, 3, 1]` from a bag summing to a pool's 64 seats.
 *
 * **A class confers nothing.** It does not affect any stat, any battle, any pool
 * or any prize (PID §8.4). It exists to be drawn and looked at. Anything in this
 * directory that reads a class is choosing artwork, and nothing else may.
 */
export type RevealClass = 0 | 1 | 2 | 3 | 4;

/** Every class, in ladder order. Exhaustive — useful for exhaustive tests. */
export const ALL_CLASSES: readonly RevealClass[] = [0, 1, 2, 3, 4];

/**
 * What one confirmed entry yields — the reveal's entire data need.
 *
 * The player's five-stat allocations are deliberately NOT here. They are sealed
 * at entry and unreadable until the pool closes (TECH-ARCH §5); a reveal that
 * could show them would defeat the sealing. This surface shows a class and
 * nothing else.
 */
export interface RevealOutcome {
  /** Pool PDA (base58). */
  pool: string;
  /** The drawn cosmetic class (PID §3). */
  class: RevealClass;
  /** The entry's 0-based seat in the pool, as emitted on-chain. */
  entryIndex: number;
  /** Minted Metaplex Core pass address (base58). */
  asset: string;
}

/**
 * An entry's terminal state. Failure is DATA, not an exception — the
 * honest-states discipline: the surface renders failure explicitly, it never
 * catches a throw and improvises.
 */
export type RevealResult =
  | { kind: "confirmed"; outcome: RevealOutcome }
  | { kind: "failed"; failure: TxFailure };

/** The seam: submit ONE entry and resolve at its terminal state. */
export interface RevealOutcomeSource {
  /**
   * True when the source serves fixture data rather than a real entry. The
   * surface renders an explicit "demo data" indicator off this flag — a fixture
   * reveal must never pass as a real one.
   */
  readonly isDemo: boolean;
  /**
   * Submit one entry for `pool` and resolve when the chain has spoken. Resolves
   * `failed` for every transaction-level failure and never rejects for one; a
   * rejection is a transport bug, not a user-visible state.
   */
  revealPass(pool: string): Promise<RevealResult>;
}
