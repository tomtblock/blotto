"use client";

/*
 * The live SOL balance of one wallet, for the header and the wallet screen.
 *
 * Until 2026-09-08 the product read a balance in exactly one place — the
 * entry gate — and showed it only to refuse an entry. A player never saw
 * what they held and a winner had no way to confirm a prize arrived. This
 * hook is the missing read: TanStack Query over the same `TxRpc.getBalance`
 * the gate uses, polled while a surface that shows it is mounted, never in a
 * background tab (the provider's foreground rule).
 *
 * The figure is a bigint end to end. Display goes through
 * `formatSolShort` / `lamportsToSol`; nothing here ever holds a float.
 *
 * The read is bounded (8 s) so a slow public node produces "could not be
 * read" rather than a spinner forever — the gate's own read has no bound,
 * which the money-journey trace flagged; this one does.
 */

import { useQuery } from "@tanstack/react-query";
import { address } from "@solana/kit";
import { useMemo } from "react";
import { rpcUrl } from "@/chain/rpc";
import { makeTxRpc, type TxRpc } from "@/tx/tx-rpc";

export const BALANCE_POLL_MS = 15_000;
export const BALANCE_STALE_MS = 5_000;
export const BALANCE_TIMEOUT_MS = 8_000;

/** Reject after `ms` — the RPC client offers no per-call timeout of its own. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`balance read exceeded ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export const balanceQueryKey = (wallet: string | null) => ["balance", wallet] as const;

export function useBalance(wallet: string | null, rpcOverride?: TxRpc) {
  const rpc = useMemo(() => rpcOverride ?? makeTxRpc(rpcUrl()), [rpcOverride]);
  return useQuery<bigint, Error>({
    queryKey: balanceQueryKey(wallet),
    enabled: wallet !== null,
    queryFn: () => withTimeout(rpc.getBalance(address(wallet as string)), BALANCE_TIMEOUT_MS),
    refetchInterval: BALANCE_POLL_MS,
    staleTime: BALANCE_STALE_MS,
    retry: 1,
  });
}
