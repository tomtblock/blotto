/*
 * The balance pre-flight (C9): BEFORE the ninety-second session starts, the
 * wallet must demonstrably cover the entry price plus the transaction's own
 * costs — a player must never allocate seven battles and then discover at
 * the pay step that the wallet cannot cover it.
 *
 * Fail-closed like the geo and attestation gates: an unreadable balance
 * blocks with an explicit retry, it never waves the player through.
 */

/**
 * What `register` costs beyond the entry price, over-estimated on purpose:
 * Entry account rent (~0.0023 SOL at 191 bytes), the Core pass asset's
 * rent (~0.004 SOL), the transaction + priority fee (well under 0.001 SOL)
 * — about 0.007 SOL in practice, guarded at 0.01. A wallet inside the
 * guard band still has every lamport checked by the chain itself; this
 * constant only decides who gets told BEFORE spending ninety seconds.
 */
export const ENTRY_COST_HEADROOM_LAMPORTS = 10_000_000n;

export type BalanceGateState =
  | { state: 'ok'; haveLamports: bigint }
  | { state: 'insufficient'; needLamports: bigint; haveLamports: bigint }
  | { state: 'unavailable' };

export async function checkBalanceGate(
  getBalance: (wallet: string) => Promise<bigint>,
  wallet: string,
  entryLamports: bigint
): Promise<BalanceGateState> {
  const needLamports = entryLamports + ENTRY_COST_HEADROOM_LAMPORTS;
  let haveLamports: bigint;
  try {
    haveLamports = await getBalance(wallet);
  } catch {
    return { state: 'unavailable' };
  }
  return haveLamports >= needLamports
    ? { state: 'ok', haveLamports }
    : { state: 'insufficient', needLamports, haveLamports };
}
