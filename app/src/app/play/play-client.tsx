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

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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
import type { AddFundsOptions } from '@/wallet/types';
import { isMainnet } from '@/chain/cluster';
import { hasLocalAttestation, submitAttestation } from '@/entry/attestation';
import { RevealHost } from './reveal-host';
import { SealedPanel } from './sealed-panel';

/** D-C: the top-up prompt ships behind a flag, OFF by default. */
const TOPUP_ENABLED = process.env.NEXT_PUBLIC_TOPUP_ENABLED === '1';
/** Devnet only — a faucet link where a real player hits the balance wall. */
const FAUCET_ENABLED = process.env.NEXT_PUBLIC_DEVNET_FAUCET === '1';
const FAUCET_URL = 'https://faucet.solana.com/';
/**
 * How long a signed-in wallet may lack a signer before the screen says so.
 * Right after sign-in the address can arrive from the provider's linked
 * accounts a beat before its wallet connects; that gap is normal. Past this
 * it is the reconnect failure the money-journey trace found: an address with
 * no signer behind it, which used to let a player play all seven battles and
 * press confirm into nothing.
 */
const SIGNER_WAIT_MS = 8_000;

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

/** After this long a hold says so, rather than looking frozen. */
const SLOW_HOLD_MS = 4_000;

/** A quiet in-progress hold (checks, loads) — never a bare ellipsis. Past
 *  SLOW_HOLD_MS it names the stage as slow so a stuck step is reportable. */
function PendingPanel({ label }: { label: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_HOLD_MS);
    return () => clearTimeout(t);
  }, [label]);
  return (
    <section aria-live="polite" className="flex flex-col items-center gap-4 py-14">
      <div className="h-8 w-8 rounded-full border-2 border-overlay border-t-brand motion-safe:animate-rotate" aria-hidden />
      <p className="text-[13px] uppercase tracking-[0.14em] text-ink-muted">{label}</p>
      {slow && <p className="max-w-prose text-center text-[13px] leading-5 text-ink-muted">{COPY.gate.slowHold}</p>}
    </section>
  );
}

/** Ceiling on the browser's fallback read of the pool. */
const POOL_LOAD_TIMEOUT_MS = 8_000;

/** Ceiling on the existing-entry read; past it the run proceeds. */
const ENTRIES_TIMEOUT_MS = 6_000;

/**
 * Reads the pool's entries once and reports this wallet's seat (1-based) or
 * null. Rendered as its own component, keyed by (pool, wallet), so the read
 * restarts cleanly when either changes and the page never holds a stale
 * answer for a different wallet.
 */
function EntriesCheck({
  pool,
  wallet,
  onResult,
}: {
  pool: string;
  wallet: string;
  onResult: (seat: number | null) => void;
}) {
  useEffect(() => {
    let cancelled = false;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('entries: timeout')), ENTRIES_TIMEOUT_MS)
    );
    Promise.race([indexerApi().getEntries(pool), timeout])
      .then((rows) => {
        if (cancelled) return;
        const mine = rows.find((r) => r.player === wallet && !r.refunded);
        onResult(mine ? mine.idx + 1 : null);
      })
      .catch(() => {
        if (!cancelled) onResult(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pool, wallet, onResult]);
  return <PendingPanel label={COPY.gate.entriesChecking} />;
}

/** The server's read of the pool: `null` when the server could not read. */
export type InitialPool = { pool: PoolSummary | null } | null;

export function PlayClient({ initial = null }: { initial?: InitialPool }) {
  const params = useSearchParams();
  const router = useRouter();
  const poolId = params.get('pool');
  const auth = useAuth();
  const [pool, setPool] = useState<PoolSummary | null>(initial?.pool ?? null);
  // 'loading' | 'missing' (the indexer has no such pool) | 'failed' (the
  // read did not complete — cross-origin refusal, timeout, outage).
  const [poolLoad, setPoolLoad] = useState<'loading' | 'missing' | 'failed' | 'ok'>(
    initial ? (initial.pool ? 'ok' : 'missing') : 'loading'
  );
  const [poolRun, setPoolRun] = useState(0);
  // D-B3: the territory pre-flight. Nothing that can take money renders
  // until the verdict is an explicit 'allowed' — fail-closed by default.
  const [geo, setGeo] = useState<GeoGateState>('checking');
  const [geoRun, setGeoRun] = useState(0);
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
  /*
   * 2026-09-09 (founder: "tried to enter again from the same wallet and got
   * a network error"): the chain holds one entry per wallet per pool, and a
   * second `register` fails at the entry account's creation. Read the pool's
   * entries FIRST, so a wallet that is already in sees its seat instead of
   * ninety seconds of battles that cannot be entered. Keyed by (pool,
   * wallet); a read that fails or times out lets the run proceed — the tx
   * classifier still names a duplicate honestly if it comes to that.
   */
  const [entered, setEntered] = useState<{ key: string; seat: number | null } | null>(null);

  const rpc = useMemo(() => makeTxRpc(rpcUrl()), []);

  useEffect(() => {
    if (!poolId || pool || poolLoad !== 'loading') return;
    let cancelled = false;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('pool: timeout')), POOL_LOAD_TIMEOUT_MS)
    );
    Promise.race([indexerApi().getPool(poolId), timeout])
      .then((p) => {
        if (cancelled) return;
        if (p) {
          setPool(p);
          setPoolLoad('ok');
        } else {
          setPoolLoad('missing');
        }
      })
      .catch(() => {
        if (!cancelled) setPoolLoad('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [poolId, pool, poolLoad, poolRun]);

  useEffect(() => {
    let cancelled = false;
    // The first run may answer from the tab's memo (see geo-gate.ts); a
    // "Check again" is a genuine re-ask and says so.
    checkGeoGate(process.env.NEXT_PUBLIC_ENTRY_API_URL, fetch, { recheck: geoRun > 0 }).then(
      (verdict) => {
        if (!cancelled) setGeo(verdict);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [geoRun]);

  const wallet = auth.status === 'signed-in' ? auth.walletAddress : null;
  const hasSigner =
    wallet !== null && auth.status === 'signed-in' && auth.signers.some((s) => s.address === wallet);
  const [signerWaitExpired, setSignerWaitExpired] = useState(false);
  useEffect(() => {
    if (hasSigner || wallet === null) return;
    const t = setTimeout(() => setSignerWaitExpired(true), SIGNER_WAIT_MS);
    return () => clearTimeout(t);
  }, [hasSigner, wallet]);

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

  // The confirmed battles, kept ONLY to power retry after a failure the tx
  // seam marks `retryable` (a fresh salt + upsert ciphertext + new packet —
  // nothing landed and nothing can).
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
  if (!pool) {
    if (poolLoad === 'missing') {
      return (
        <StatePanel title={COPY.gate.poolMissingTitle}>
          <p>{COPY.gate.poolMissing}</p>
          <Link href="/" className="mt-1 text-brand underline underline-offset-2">
            Back to Play
          </Link>
        </StatePanel>
      );
    }
    if (poolLoad === 'failed') {
      return (
        <StatePanel title={COPY.gate.poolLoadFailedTitle}>
          <p>{COPY.gate.poolLoadFailed}</p>
          <Button
            intent="quiet"
            className="self-start"
            onClick={() => {
              setPoolLoad('loading');
              setPoolRun((n) => n + 1);
            }}
          >
            {COPY.gate.poolLoadRetry}
          </Button>
        </StatePanel>
      );
    }
    return <PendingPanel label="Loading the pool" />;
  }

  // The pool must still be taking entries — a stale tab or an old link must
  // not start a run that the program will refuse (PoolNotOpen). After this
  // wallet's own entry the sealed panel and the reveal stay put regardless.
  if (pool.state !== 'Open' && !done && !revealRun) {
    return (
      <StatePanel title={COPY.gate.poolClosedTitle}>
        <p>{COPY.gate.poolClosed}</p>
        <Link href="/pools" className="mt-1 text-brand underline underline-offset-2">
          {COPY.gate.poolClosedLink}
        </Link>
      </StatePanel>
    );
  }

  // D-B3: territory gate ahead of everything, including the attestation.
  if (geo === 'checking') return <PendingPanel label="Checking availability" />;
  if (geo === 'blocked') {
    // Fail-closed covers a slow or unreachable check too (D-B3), so the
    // panel offers one more look before the player concludes anything.
    return (
      <StatePanel title="Not available here">
        <p>{COPY.gate.territoryBlocked}</p>
        <p className="text-[13px]">{COPY.gate.territoryRecheckNote}</p>
        <Button
          intent="quiet"
          className="self-start"
          onClick={() => {
            setGeo('checking');
            setGeoRun((n) => n + 1);
          }}
        >
          {COPY.gate.territoryRecheck}
        </Button>
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
  if (!hasSigner) {
    // Signed in, address known, nothing that can sign for it. Hold, then say
    // so — never let the ninety seconds start against a wallet that cannot
    // confirm at the end.
    return signerWaitExpired ? (
      <StatePanel title={COPY.gate.signerMissingTitle}>
        <p>{COPY.gate.signerMissing}</p>
        <Link href="/wallet" className="mt-1 text-brand underline underline-offset-2">
          {COPY.gate.signerMissingLink}
        </Link>
      </StatePanel>
    ) : (
      <PendingPanel label={COPY.gate.signerConnecting} />
    );
  }

  const enteredKey = `${pool.pool}:${auth.walletAddress}`;
  if (!done && !revealRun) {
    if (!entered || entered.key !== enteredKey) {
      return <EntriesCheck key={enteredKey} pool={pool.pool} wallet={auth.walletAddress} onResult={(seat) => setEntered({ key: enteredKey, seat })} />;
    }
    if (entered.seat !== null) {
      return (
        <StatePanel title={COPY.gate.alreadyEnteredTitle}>
          <p>{COPY.gate.alreadyEntered(entered.seat)}</p>
          <Link href={`/pools/${pool.pool}`} className="mt-1 text-brand underline underline-offset-2">
            {COPY.gate.alreadyEnteredPool}
          </Link>
          <Link href={`/pools/${pool.pool}/results`} className="text-brand underline underline-offset-2">
            {COPY.gate.alreadyEnteredResults}
          </Link>
        </StatePanel>
      );
    }
  }

  if (done) {
    // v3 D2: the sealed confirmation is a designed moment, not a sentence;
    // founder 2026-09-09: the check-back line, the opt-in, the public view.
    return <SealedPanel poolAddress={pool.pool} />;
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
        onDone={(exit) => {
          /*
           * Audit O25 (2026-09-11): the sealed panel is for an entry that
           * exists. Until this change every exit from the takeover set
           * `done`, so a player whose transaction had FAILED pressed Back
           * into "Your seven battles are sealed" with nothing paid.
           */
          if (exit === 'entered') {
            setDone(true);
            return;
          }
          if (exit === 'pending') {
            // Broadcast and not yet confirmed: it may still land, so neither
            // a second run nor "Sealed" is honest. The pool page is, and it
            // shows the entry the moment the network confirms it.
            router.push(`/pools/${pool.pool}`);
            return;
          }
          // Nothing landed and nothing can. Back to the start of the flow,
          // through a fresh read of the pool so a closed or paused one says
          // so before any timer starts, and through the entries check so a
          // seat this wallet already holds is found rather than re-entered.
          setRevealRun(null);
          setLastConfirmed(null);
          setEntered(null);
          setPool(null);
          setPoolLoad('loading');
          setPoolRun((n) => n + 1);
        }}
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
        <BattleFlow poolAddress={pool.pool} onConfirm={onConfirm} />
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
  addFunds: ((address: string, options?: AddFundsOptions) => Promise<void>) | undefined;
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
                  // Straight onto the deposit-address screen on devnet: no
                  // card or exchange provider sells devnet SOL, so it is the
                  // only funding method that can work there.
                  await addFunds(wallet, { method: isMainnet() ? 'any' : 'receive' });
                } catch (error) {
                  // Exiting the funding flow lands here, and so does a
                  // provider REFUSAL — notably the SDK's "Wallet funding is
                  // not enabled" throw when funding is switched off in the
                  // Privy dashboard, which is its state today. This catch
                  // was empty until 2026-09-08, so that refusal produced a
                  // tap with no window, no message and nothing in the log.
                  // PHASE-N-REVIEW: logged, not surfaced. Telling the player
                  // apart from a deliberate exit needs the SDK's
                  // onUserExited callback, and the sentence they would read
                  // is founder-owned copy (CLAUDE.md: user-facing language).
                  // Recorded as a founder decision rather than invented here.
                  console.error('top-up flow did not open:', error);
                }
                setFunding(false);
                // NOTE: addFunds resolves when the funding window OPENS, not
                // when funds arrive (the SDK warns they can take minutes), so
                // this re-read is expected to still show the old balance. The
                // manual "Check again" below is what actually catches it.
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
        {FAUCET_ENABLED && state.state === 'insufficient' ? (
          <p className="mt-1 text-[13px] leading-5 text-ink-muted">
            <a
              href={FAUCET_URL}
              target="_blank"
              rel="noreferrer"
              className="text-brand underline underline-offset-2"
            >
              {COPY.wallet.faucet}
            </a>{' '}
            — {COPY.wallet.faucetNote}
          </p>
        ) : null}
      </div>
    </StatePanel>
  );
}

/**
 * D-B4 clickwrap gate: renders its children only for a wallet whose
 * acceptance of the CURRENT terms version is on record. Lazy initial state
 * (no effect) — the component is re-mounted per wallet via `key`.
 */
/* The attestation flag lives in localStorage; reading it during the first
 * render made server and client HTML disagree (hydration error). The
 * store below reads it through useSyncExternalStore — false on the
 * server, the real value after hydration, notified on a fresh attest. */
const attestListeners = new Set<() => void>();
function subscribeAttested(cb: () => void): () => void {
  attestListeners.add(cb);
  return () => attestListeners.delete(cb);
}
function notifyAttested() {
  for (const cb of attestListeners) cb();
}

function AttestationGate({
  wallet,
  signer,
  children,
}: {
  wallet: string;
  signer: { signMessage?(message: Uint8Array): Promise<Uint8Array> } | undefined;
  children: React.ReactNode;
}) {
  const attested = useSyncExternalStore(
    subscribeAttested,
    () => hasLocalAttestation(wallet),
    () => false
  );
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
    if (ok) notifyAttested();
    else setAttestError(true);
  }, [attesting, signer, wallet]);

  if (attested) return <>{children}</>;

  // v3 D2: the clickwrap is a full-screen moment — the whole viewport is the
  // agreement, nothing competes with it. Founder 2026-09-09: each statement
  // is a designed tile with its own check mark, not a browser checkbox; the
  // confirm stays disabled until both are confirmed, and the page says what
  // the wallet prompt that follows is.
  const statements = [
    { checked: ageChecked, set: setAgeChecked, text: COPY.gate.ageAttestation, link: null },
    {
      checked: termsChecked,
      set: setTermsChecked,
      text: COPY.gate.termsAcceptance,
      link: { href: '/rules', label: COPY.gate.gateReadTerms },
    },
  ] as const;
  const confirmedCount = statements.filter((st) => st.checked).length;
  const ready = confirmedCount === statements.length;

  return (
    <section className="animate-settle flex min-h-[70vh] flex-col justify-center gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-[34px] leading-[38px] font-extrabold text-ink">
          {COPY.gate.gateTitle}
        </h2>
        <p className="max-w-prose text-[15px] leading-6 text-ink-muted">{COPY.gate.gateIntro}</p>
      </div>
      <ol className="flex flex-col gap-3">
        {statements.map((st, i) => (
          <li key={i}>
            <StatementTile
              index={i + 1}
              of={statements.length}
              checked={st.checked}
              onChange={st.set}
              text={st.text}
              link={st.link}
              disabled={attesting}
            />
          </li>
        ))}
      </ol>
      {attestError && (
        <p className="text-[14px] leading-5 text-price-down" role="alert">
          {COPY.gate.attestFailed}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <Button size="lg" disabled={!ready || attesting} onClick={onAttest} data-testid="gate-confirm">
          {attesting ? COPY.gate.gateSigning : COPY.gate.ageConfirm}
        </Button>
        <p className="text-[13px] leading-5 text-ink-muted" aria-live="polite">
          {ready ? COPY.gate.gateSignNote : `${confirmedCount} / ${statements.length}`}
        </p>
      </div>
    </section>
  );
}

/**
 * One statement of the clickwrap: a large tap target whose whole face is
 * the control. The real checkbox is kept for assistive tech and tests but
 * drawn by us — a ring that fills with the brand colour and a check mark
 * when confirmed — so the two statements read as part of the product, not
 * as a form. A "read the terms" link sits inside the tile without toggling it.
 */
function StatementTile({
  index,
  of,
  checked,
  onChange,
  text,
  link,
  disabled,
}: {
  index: number;
  of: number;
  checked: boolean;
  onChange: (next: boolean) => void;
  text: string;
  link: { href: string; label: string } | null;
  disabled: boolean;
}) {
  return (
    <label
      data-testid={`gate-statement-${index}`}
      data-checked={checked ? 'true' : 'false'}
      className={
        'group relative flex cursor-pointer items-start gap-4 rounded-2xl border p-5 transition-[border-color,background-color,box-shadow] ' +
        (checked
          ? 'border-brand bg-brand/10 shadow-[0_0_0_1px_var(--color-brand)]'
          : 'border-line bg-raised hover:border-brand/40') +
        (disabled ? ' cursor-default opacity-70' : '')
      }
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={
          'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 transition-[background-color,border-color,transform] ' +
          'peer-focus-visible:ring-2 peer-focus-visible:ring-brand-cream peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-(--color-base) ' +
          (checked
            ? 'scale-100 border-brand bg-brand text-(--color-base)'
            : 'border-line bg-base text-transparent group-hover:border-brand/60')
        }
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none">
          <path
            d="M4 10.5l4 4 8-9"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-center justify-between gap-3">
          <span className="font-mono text-[11px] tracking-[0.14em] whitespace-nowrap text-ink-muted uppercase">
            {COPY.gate.gateStep(index, of)}
          </span>
          {checked ? (
            <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 font-mono text-[10px] tracking-[0.12em] text-(--color-base) uppercase">
              {COPY.gate.gateConfirmed}
            </span>
          ) : null}
        </span>
        <span className="text-[16px] leading-6 text-ink">{text}</span>
        {link ? (
          <Link
            href={link.href}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="w-fit text-[13px] text-brand underline underline-offset-2"
          >
            {link.label}
          </Link>
        ) : null}
      </span>
    </label>
  );
}
