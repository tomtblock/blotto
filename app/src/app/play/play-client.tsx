'use client';

/*
 * The play-flow client (C9): geo gate → sign-in → age attestation → the
 * BALANCE pre-flight → the battle flow → the sealed submit through the REAL
 * transaction pipeline → the reveal takeover on the outcome.
 *
 * The balance check runs BEFORE the ninety-second session ever starts:
 * a wallet that cannot cover entry + transaction costs sees the shortfall
 * (and, behind NEXT_PUBLIC_TOPUP_ENABLED, the provider top-up flow) instead
 * of a timer it cannot afford to finish.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { address } from '@solana/kit';
import { COPY } from '@/copy';
import { BattleFlow } from '@/battle/components/battle-flow';
import type { Allocation } from '@/battle/allocation';
import { indexerApi } from '@/data/api';
import { lamportsToSol } from '@/data/format';
import type { PoolSummary } from '@/data/types';
import { rpcUrl } from '@/chain/rpc';
import { makeTxRpc } from '@/tx/tx-rpc';
import { useAuth } from '@/wallet/auth-context';
import type { RevealResult } from '@/reveal/types';
import { makeLiveEntryServices } from '@/entry/services';
import { submitForReveal } from '@/entry/outcome';
import {
  checkBalanceGate,
  ENTRY_COST_HEADROOM_LAMPORTS,
  type BalanceGateState,
} from '@/entry/balance-gate';
import { checkGeoGate, type GeoGateState } from '@/entry/geo-gate';
import {
  TERMS_VERSION,
  hasLocalAttestation,
  submitAttestation,
} from '@/entry/attestation';
import { RevealHost } from './reveal-host';

/** D-C: the top-up prompt ships behind a flag, OFF by default. */
const TOPUP_ENABLED = process.env.NEXT_PUBLIC_TOPUP_ENABLED === '1';

export function PlayClient() {
  const params = useSearchParams();
  const poolId = params.get('pool');
  const auth = useAuth();
  const [pool, setPool] = useState<PoolSummary | null>(null);
  // D-B3: the territory pre-flight. Nothing that can take money renders
  // until the verdict is an explicit 'allowed' — fail-closed by default.
  const [geo, setGeo] = useState<GeoGateState>('checking');
  // C9: the balance pre-flight, equally fail-closed, ahead of the timer.
  // Keyed by (wallet, pool, run): a stale result renders as 'checking'
  // rather than being cleared with a synchronous setState in the effect.
  const [balanceResult, setBalanceResult] = useState<{
    key: string;
    verdict: BalanceGateState;
  } | null>(null);
  const [balanceRun, setBalanceRun] = useState(0);
  // The in-flight entry: set at confirm, drives the reveal takeover.
  const [revealRun, setRevealRun] = useState<Promise<RevealResult> | null>(null);
  const [done, setDone] = useState(false);

  const rpc = useMemo(() => makeTxRpc(rpcUrl()), []);

  useEffect(() => {
    if (!poolId) return;
    indexerApi().getPool(poolId).then(setPool);
  }, [poolId]);

  useEffect(() => {
    let cancelled = false;
    checkGeoGate(process.env.NEXT_PUBLIC_ENTRY_API_URL).then((verdict) => {
      if (!cancelled) setGeo(verdict);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const wallet = auth.status === 'signed-in' ? auth.walletAddress : null;

  const balanceKey = wallet && pool ? `${wallet}:${pool.id}:${balanceRun}` : null;
  useEffect(() => {
    if (!wallet || !pool || !balanceKey) return;
    let cancelled = false;
    checkBalanceGate(
      (w) => rpc.getBalance(address(w)),
      wallet,
      BigInt(pool.entry_lamports)
    ).then((verdict) => {
      if (!cancelled) setBalanceResult({ key: balanceKey, verdict });
    });
    return () => {
      cancelled = true;
    };
  }, [wallet, pool, rpc, balanceKey]);
  const balance: BalanceGateState | 'checking' =
    balanceResult && balanceResult.key === balanceKey ? balanceResult.verdict : 'checking';

  const startSubmit = useCallback(
    (battles: readonly Allocation[], timingsMs: readonly number[]): Promise<RevealResult> | null => {
      if (!pool || auth.status !== 'signed-in' || !auth.walletAddress) return null;
      const signer = auth.signers.find((s) => s.address === auth.walletAddress);
      if (!signer) return null;
      const services = makeLiveEntryServices({
        apiBase: process.env.NEXT_PUBLIC_ENTRY_API_URL,
        programId: process.env.NEXT_PUBLIC_PROGRAM_ID,
        rpc,
        signer,
        poolId: BigInt(pool.id),
      });
      return submitForReveal(services, rpc, {
        pool: pool.pool,
        sealingPubkeyHex: pool.sealing_pubkey,
        player: auth.walletAddress,
        battles,
        timingsMs,
      });
    },
    [pool, auth, rpc]
  );

  // The confirmed battles, kept ONLY to power retry after a never-broadcast
  // failure (a fresh salt + upsert ciphertext + new packet — nothing landed).
  const [lastConfirmed, setLastConfirmed] = useState<{
    battles: readonly Allocation[];
    timingsMs: readonly number[];
  } | null>(null);

  const onConfirm = useCallback(
    async (battles: readonly Allocation[], timingsMs: readonly number[]) => {
      const run = startSubmit(battles, timingsMs);
      if (run) {
        setLastConfirmed({ battles, timingsMs });
        setRevealRun(() => run);
      }
    },
    [startSubmit]
  );

  if (!poolId) return <p className="opacity-70">Pick a pool first.</p>;
  if (!pool) return <p className="opacity-70">…</p>;

  // D-B3: territory gate ahead of everything, including the attestation.
  if (geo === 'checking') return <p className="opacity-70">…</p>;
  if (geo === 'blocked') {
    return <p className="max-w-prose text-sm opacity-80">{COPY.gate.territoryBlocked}</p>;
  }

  if (auth.status !== 'signed-in') {
    return <p className="opacity-70">Sign in to enter.</p>;
  }
  if (!auth.walletAddress) {
    return <p className="opacity-70">…</p>;
  }

  if (done) {
    return <p aria-live="polite">Entry submitted — sealing confirmed.</p>;
  }

  // The reveal takeover owns the screen from confirm onward.
  if (revealRun) {
    const retry = lastConfirmed
      ? () => startSubmit(lastConfirmed.battles, lastConfirmed.timingsMs)
      : null;
    return (
      <RevealHost
        result={revealRun}
        onRetry={
          retry
            ? () => {
                const run = retry();
                if (run) return run;
                return revealRun;
              }
            : undefined
        }
        onDone={() => setDone(true)}
      />
    );
  }

  return (
    <AttestationGate
      key={auth.walletAddress}
      wallet={auth.walletAddress}
      signer={auth.signers.find((s) => s.address === auth.walletAddress)}
    >
      <BalanceGateView
        state={balance}
        entryLamports={pool.entry_lamports}
        wallet={auth.walletAddress}
        addFunds={auth.addFunds}
        onRecheck={() => setBalanceRun((n) => n + 1)}
      >
        <BattleFlow timerSeconds={pool.timer_seconds} onConfirm={onConfirm} />
      </BalanceGateView>
    </AttestationGate>
  );
}

/**
 * C9 balance gate view: children render ONLY on an explicit 'ok'. The
 * insufficient state shows the exact shortfall in plain numbers; the
 * top-up button exists only behind the flag AND a provider funding seam.
 */
function BalanceGateView({
  state,
  entryLamports,
  wallet,
  addFunds,
  onRecheck,
  children,
}: {
  state: BalanceGateState | 'checking';
  entryLamports: string;
  wallet: string;
  addFunds: ((address: string) => Promise<void>) | undefined;
  onRecheck: () => void;
  children: React.ReactNode;
}) {
  const [funding, setFunding] = useState(false);
  if (state === 'checking') return <p className="opacity-70">…</p>;
  if (state.state === 'ok') return <>{children}</>;

  const needSol = lamportsToSol(
    (BigInt(entryLamports) + ENTRY_COST_HEADROOM_LAMPORTS).toString()
  );
  return (
    <section className="flex max-w-prose flex-col gap-4 rounded border p-6" aria-live="polite">
      {state.state === 'insufficient' ? (
        <p className="text-sm opacity-80">
          {COPY.gate.balanceInsufficient(needSol, lamportsToSol(state.haveLamports.toString()))}
        </p>
      ) : (
        <p className="text-sm opacity-80">{COPY.gate.balanceUnavailable}</p>
      )}
      <div className="flex gap-3">
        {TOPUP_ENABLED && addFunds && state.state === 'insufficient' && (
          <button
            type="button"
            disabled={funding}
            className="rounded bg-[var(--color-accent,#7c5cff)] px-6 py-2 text-white disabled:opacity-40"
            onClick={async () => {
              setFunding(true);
              try {
                await addFunds(wallet);
              } catch {
                // Exited the funding flow — the recheck below stays available.
              }
              setFunding(false);
              onRecheck();
            }}
          >
            {funding ? '…' : COPY.gate.topUp}
          </button>
        )}
        <button type="button" className="underline" onClick={onRecheck}>
          {COPY.gate.balanceRetry}
        </button>
      </div>
    </section>
  );
}

/**
 * D-B4 clickwrap gate: renders its children only for a wallet whose
 * acceptance of the CURRENT terms version is on record. Lazy initial state
 * (no effect) — the component is re-mounted per wallet via `key`.
 */
function AttestationGate({
  wallet,
  signer,
  children,
}: {
  wallet: string;
  signer: { signMessage?(message: Uint8Array): Promise<Uint8Array> } | undefined;
  children: React.ReactNode;
}) {
  const [attested, setAttested] = useState(() => hasLocalAttestation(wallet));
  const [ageChecked, setAgeChecked] = useState(false);
  const [termsChecked, setTermsChecked] = useState(false);
  const [attestError, setAttestError] = useState(false);
  const [attesting, setAttesting] = useState(false);

  const onAttest = useCallback(async () => {
    if (attesting) return;
    setAttesting(true);
    setAttestError(false);
    const ok = await submitAttestation(process.env.NEXT_PUBLIC_ENTRY_API_URL, signer, wallet);
    setAttesting(false);
    if (ok) setAttested(true);
    else setAttestError(true);
  }, [attesting, signer, wallet]);

  if (attested) return <>{children}</>;

  return (
    <section className="flex max-w-prose flex-col gap-4 rounded border p-6">
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={ageChecked}
          onChange={(e) => setAgeChecked(e.target.checked)}
          className="mt-1"
        />
        <span>{COPY.gate.ageAttestation}</span>
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={termsChecked}
          onChange={(e) => setTermsChecked(e.target.checked)}
          className="mt-1"
        />
        <span>{COPY.gate.termsAcceptance(TERMS_VERSION)}</span>
      </label>
      {attestError && <p className="text-sm text-red-400">{COPY.gate.attestFailed}</p>}
      <button
        type="button"
        disabled={!ageChecked || !termsChecked || attesting}
        className="rounded bg-[var(--color-accent,#7c5cff)] px-6 py-2 text-white disabled:opacity-40"
        onClick={onAttest}
      >
        {attesting ? '…' : COPY.gate.ageConfirm}
      </button>
    </section>
  );
}
