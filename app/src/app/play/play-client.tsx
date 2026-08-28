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
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { address } from '@solana/kit';
import { COPY } from '@/copy';
import { Button } from '@/components/ui/button';
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

/* v3 D2: every empty/error state on the entry path is designed, not a bare
 * sentence — same panel shape whatever stopped the flow. */
function StatePanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="animate-rise flex flex-col gap-2 rounded-2xl border border-line bg-raised p-6">
      <h2 className="font-display text-[24px] font-bold text-ink">{title}</h2>
      <div className="flex max-w-prose flex-col gap-2 text-[15px] leading-6 text-ink-muted">
        {children}
      </div>
    </section>
  );
}

/** A quiet in-progress hold (checks, loads) — never a bare ellipsis. */
function PendingPanel({ label }: { label: string }) {
  return (
    <section aria-live="polite" className="flex flex-col items-center gap-4 py-14">
      <div className="h-8 w-8 rounded-full border-2 border-overlay border-t-brand motion-safe:animate-rotate" aria-hidden />
      <p className="text-[13px] uppercase tracking-[0.14em] text-ink-muted">{label}</p>
    </section>
  );
}

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

  if (!poolId) {
    return (
      <StatePanel title="No pool selected">
        <p>Pick an open tournament from the Play tab to enter.</p>
        <Link href="/" className="mt-1 text-brand underline underline-offset-2">
          Back to Play
        </Link>
      </StatePanel>
    );
  }
  if (!pool) return <PendingPanel label="Loading the pool" />;

  // D-B3: territory gate ahead of everything, including the attestation.
  if (geo === 'checking') return <PendingPanel label="Checking availability" />;
  if (geo === 'blocked') {
    return (
      <StatePanel title="Not available here">
        <p>{COPY.gate.territoryBlocked}</p>
      </StatePanel>
    );
  }

  if (auth.status !== 'signed-in') {
    return (
      <StatePanel title="Sign in to enter">
        <p>Entering needs a signed-in wallet — sign in from the header above.</p>
      </StatePanel>
    );
  }
  if (!auth.walletAddress) {
    return <PendingPanel label="Resolving your wallet" />;
  }

  if (done) {
    // v3 D2: the sealed confirmation is a designed moment, not a sentence.
    return (
      <section aria-live="polite" className="animate-settle flex flex-col items-center gap-5 py-14 text-center">
        <div className="relative h-16 w-16" aria-hidden>
          <div className="absolute inset-0 rounded-2xl border-2 border-brand" />
          <div className="absolute inset-0 rounded-2xl" style={{ boxShadow: 'var(--glow-action)' }} />
          <svg viewBox="0 0 24 24" className="absolute inset-0 m-auto h-8 w-8 text-brand">
            <path
              d="m5 13 4.5 4.5L19 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h2 className="font-display text-[34px] leading-[38px] font-extrabold text-ink">Sealed</h2>
        <p className="max-w-prose text-[15px] leading-6 text-ink-muted">{COPY.pool.sealed}</p>
        <Link
          href={`/pools/${pool.pool}`}
          className="mt-2 flex h-12 items-center justify-center rounded-xl bg-brand px-8 text-[15px] font-semibold text-(--color-base) transition-colors hover:bg-brand-hot"
        >
          {COPY.reveal.stalledDismiss}
        </Link>
      </section>
    );
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
  if (state === 'checking') return <PendingPanel label="Checking your balance" />;
  if (state.state === 'ok') return <>{children}</>;

  const needSol = lamportsToSol(
    (BigInt(entryLamports) + ENTRY_COST_HEADROOM_LAMPORTS).toString()
  );
  return (
    <StatePanel
      title={state.state === 'insufficient' ? 'Not enough SOL for this entry' : 'Balance check needed'}
    >
      <div aria-live="polite" className="flex flex-col gap-4">
        {state.state === 'insufficient' ? (
          <p>{COPY.gate.balanceInsufficient(needSol, lamportsToSol(state.haveLamports.toString()))}</p>
        ) : (
          <p>{COPY.gate.balanceUnavailable}</p>
        )}
        <div className="flex flex-wrap gap-3">
          {TOPUP_ENABLED && addFunds && state.state === 'insufficient' && (
            <Button
              disabled={funding}
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
            </Button>
          )}
          <Button intent="quiet" onClick={onRecheck}>
            {COPY.gate.balanceRetry}
          </Button>
        </div>
      </div>
    </StatePanel>
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

  // v3 D2: the clickwrap is a full-screen moment — the whole viewport is the
  // agreement, nothing competes with it. Each statement is a large tap
  // target; the confirm stays disabled until both are checked.
  return (
    <section className="animate-settle flex min-h-[70vh] flex-col justify-center gap-6">
      <h2 className="font-display text-[34px] leading-[38px] font-extrabold text-ink">
        {COPY.gate.gateTitle}
      </h2>
      <div className="flex flex-col gap-3">
        {(
          [
            { checked: ageChecked, set: setAgeChecked, text: COPY.gate.ageAttestation },
            {
              checked: termsChecked,
              set: setTermsChecked,
              text: COPY.gate.termsAcceptance(TERMS_VERSION),
            },
          ] as const
        ).map((row, i) => (
          <label
            key={i}
            className={
              'flex cursor-pointer items-start gap-4 rounded-2xl border p-5 transition-colors ' +
              (row.checked ? 'border-brand/60 bg-raised' : 'border-line bg-raised hover:border-brand/30')
            }
          >
            <input
              type="checkbox"
              checked={row.checked}
              onChange={(e) => row.set(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-(--color-brand)"
            />
            <span className="text-[15px] leading-6 text-ink">{row.text}</span>
          </label>
        ))}
      </div>
      {attestError && (
        <p className="text-[14px] leading-5 text-price-down" role="alert">
          {COPY.gate.attestFailed}
        </p>
      )}
      <Button size="lg" disabled={!ageChecked || !termsChecked || attesting} onClick={onAttest}>
        {attesting ? '…' : COPY.gate.ageConfirm}
      </Button>
    </section>
  );
}
