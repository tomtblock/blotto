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

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { address } from '@solana/kit';
import { COPY } from '@/copy';
import { blockedTerritoryPhrase } from '@/rules/territories';
import { Button } from '@/components/ui/button';
import { BoardFlow } from '@/battle/components/board/BoardFlow';
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
import { openFunding } from '@/wallet/funding';
import { isMainnet } from '@/chain/cluster';
import {
  hasLocalAttestation,
  submitAttestation,
  type AttestationFailure,
} from '@/entry/attestation';
import { signInHref } from '@/app/signin/return-to';
import { runInterruption } from './run-guard';
import { RevealHost } from './reveal-host';
import { PendingPanel } from '@/components/ui/pending-panel';
import { SealedPanel } from './sealed-panel';
import { SealStage, type ReviewSealApi, type SealKeyTone } from './seal-stage';
import { INITIAL_SEAL_STAGE, reduceSealStage } from './seal-stage-machine';
import { observeSigner } from './observed-signer';
import { EnteredPanel } from './entered-panel';
import { entryServiceNotifyVersion } from '@/notify/pool-notify';
import type { RevealState } from '@/reveal/machine';

/*
 * D3 (founder 2026-09-16): the seal key's colour. `action` is the pink every
 * money-moving control wears (button.tsx); `red` is the founder's ask, held
 * behind this one constant because tokens.ts reserves red for loss
 * semantics — flipping it is a recorded exception, not a style choice.
 */
const SEAL_KEY_TONE: SealKeyTone = 'action';

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
    <section className="candy candy-gloss animate-rise relative flex flex-col gap-2 overflow-hidden rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,var(--color-overlay)_0%,var(--color-raised)_38%,var(--color-base)_100%)] p-6">
      <h2 className="font-display text-[24px] font-bold text-ink">{title}</h2>
      <div className="flex max-w-prose flex-col gap-2 text-[15px] leading-6 text-ink-muted">
        {children}
      </div>
    </section>
  );
}

/** After this long a hold says so, rather than looking frozen. */
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

  /*
   * THE SEAL STAGE (founder 2026-09-16, CHANGE-2026-09-16_ui-uplift.md §A8):
   * the scene behind the seal, from "seven made" to the pass. Its phase is
   * fed by facts this page already has — the seal steps, the wallet's two
   * signatures (observed on the signer object this page hands to the entry
   * path, never inside it), and the reveal machine's beats. It is mounted
   * HERE, outside the flow and the takeover, so it survives the swap from
   * the board to RevealHost without restarting its loop.
   */
  const [stagePhase, stageDispatch] = useReducer(reduceSealStage, INITIAL_SEAL_STAGE);
  const [reviewApi, setReviewApi] = useState<ReviewSealApi | null>(null);
  const onReviewApi = useCallback((api: ReviewSealApi | null) => setReviewApi(api), []);
  // Round three (§D): the stage's widget slot, handed to the flow so it can
  // portal the review into it. A ref callback, so it is a stable setter.
  const [reviewHost, setReviewHost] = useState<HTMLDivElement | null>(null);
  // Round four (§E): whether the entry service can deliver the one-message
  // opt-in — asked once the entry is in flight, so the sealed column offers
  // it only when there is a dispatcher behind it.
  const [notifyVersion, setNotifyVersion] = useState<string | null>(null);
  const onRevealBeat = useCallback((beat: RevealState['beat']) => {
    if (beat === 'card') stageDispatch({ type: 'confirmed' });
    else if (beat === 'failed') stageDispatch({ type: 'failed' });
  }, []);

  const startSubmit = useCallback(
    (battles: readonly Allocation[], timingsMs: readonly number[]): Promise<RevealResult> | null => {
      if (!pool || auth.status !== 'signed-in' || !auth.walletAddress) return null;
      const signer = auth.signers.find((s) => s.address === auth.walletAddress);
      if (!signer) return null;
      const services = makeLiveEntryServices({
        apiBase: process.env.NEXT_PUBLIC_ENTRY_API_URL,
        programId: process.env.NEXT_PUBLIC_PROGRAM_ID,
        rpc,
        // The stage learns "signed" from the object the entry path is given.
        signer: observeSigner(signer, (e) => stageDispatch({ type: e })),
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

  /*
   * C-17 / D-13 (audit 2026-09-11). THE RUN IS THE PLAYER'S WORK, and until
   * the seal it exists nowhere but inside the board (BoardFlow). Every gate below used
   * to be re-evaluated on every render, so a wallet reconnect, an active-
   * address change, or a balance re-check in the middle of the ninety
   * seconds took the screen away and destroyed all seven allocations with
   * no message and no recovery.
   *
   * The wallet the run BELONGS to is captured when the player begins.
   * Non-null means a run is on screen, and from that moment:
   *
   *   - the pre-flight gates (signer, balance, existing entry, pool state)
   *     stop being able to unmount the flow — they are PRE-flight, and they
   *     have already been passed;
   *   - a genuine change of account is the one thing that does stop it, and
   *     it SAYS so, offering a deliberate restart rather than silently
   *     beginning again with nothing on screen.
   */
  const [runWallet, setRunWallet] = useState<string | null>(null);
  /** Set when a seal could not be submitted (no signer at that moment) —
   * the allocations survive in `lastConfirmed` and the panel offers a retry
   * rather than a dead "Sealing…" hold. */
  const [submitBlocked, setSubmitBlocked] = useState(false);

  const onConfirm = useCallback(
    async (battles: readonly Allocation[], timingsMs: readonly number[]) => {
      // Remembered FIRST and unconditionally: it is the player's ninety
      // seconds, and it must survive whatever the submit does next.
      setLastConfirmed({ battles, timingsMs });
      const run = startSubmit(battles, timingsMs);
      if (run) {
        setSubmitBlocked(false);
        setRevealRun(() => run);
      } else {
        // Signed in, but nothing that can sign right now. Never a silent
        // no-op: the old code returned here and left "Sealing…" on screen
        // for ever.
        setSubmitBlocked(true);
      }
    },
    [startSubmit]
  );

  const retrySubmit = useCallback(() => {
    if (lastConfirmed) void onConfirm(lastConfirmed.battles, lastConfirmed.timingsMs);
  }, [lastConfirmed, onConfirm]);

  /* The seal controls, drawn on the blender's base while the seven are made
   * and nothing is in flight: two steps, the §8.6 line above each — the
   * same order the board's own unhosted review uses (BoardFlow). */
  const sealControls =
    reviewApi && !revealRun && (stagePhase === 'made' || stagePhase === 'armed') ? (
      stagePhase === 'armed' ? (
        <>
          {/* PID §8.6 — above the confirm, always. Do not move it below. */}
          <p className="seal-stage-line text-[15px] leading-6">{COPY.pool.decisionsFinal}</p>
          {/* Step two: Go back beside the confirm on a wide screen (a row keeps
              the key inside the window), under it on a phone. */}
          <div className="seal-stage-keys">
            <Button intent="quiet" className="seal-stage-back" onClick={() => stageDispatch({ type: 'disarm' })}>
              {COPY.battle.sealCancel}
            </Button>
            <Button
              size="lg"
              className="seal-stage-key"
              data-testid="seal-confirm"
              onClick={() => {
                stageDispatch({ type: 'confirm' });
                reviewApi.confirm();
              }}
            >
              {COPY.battle.sealConfirm}
            </Button>
          </div>
        </>
      ) : (
        <>
          {/* PID §8.6 — above the seal control on step one as well. */}
          <p className="seal-stage-line text-[15px] leading-6">{COPY.pool.decisionsFinal}</p>
          <Button
            size="lg"
            className="seal-stage-key"
            data-testid="seal-arm"
            onClick={() => stageDispatch({ type: 'arm' })}
          >
            {COPY.battle.seal}
          </Button>
        </>
      )
    ) : null;
  const stageStatus =
    stagePhase === 'signing' || stagePhase === 'locked'
      ? COPY.battle.sealing
      : stagePhase === 'blending'
        ? COPY.reveal.confirming
        : null;
  // Sticky on purpose: from the first review until the flow is reset or
  // done, so the scene never unmounts between the review ending and the
  // takeover starting — a remount would restart its loop.
  const stageOn = reviewApi !== null || revealRun !== null || stagePhase !== 'made';
  // The stage with whatever the side column shows after the review (the
  // takeover's beats — round four, §E); `stage` is the plain one.
  const stageWith = (side: ReactNode = null) =>
    stageOn ? (
      <SealStage
        phase={stagePhase}
        tone={SEAL_KEY_TONE}
        controls={sealControls}
        status={stageStatus}
        busy={stagePhase === 'signing' || stagePhase === 'locked' || stagePhase === 'blending'}
        widgetRef={setReviewHost}
        side={side}
      />
    ) : null;
  const stage = stageWith();

  useEffect(() => {
    if (!revealRun) return;
    let live = true;
    void entryServiceNotifyVersion(process.env.NEXT_PUBLIC_ENTRY_API_URL).then((v) => {
      if (live) setNotifyVersion(v);
    });
    return () => {
      live = false;
    };
  }, [revealRun]);

  /** A run is on screen: begun, not sealed, not handed to the takeover. */
  const interruption = runInterruption(runWallet, auth);
  const runInProgress = interruption !== 'none' && !done && !revealRun;
  /** Once the run has begun the balance pre-flight has been passed; a later
   * re-check must not blank the screen the player is playing on. */
  const balanceForGate: BalanceGateState | 'checking' = runInProgress
    ? { state: 'ok', haveLamports: 0n }
    : balance;

  if (!poolId) {
    return (
      <StatePanel title={COPY.gate.noPoolTitle}>
        <p>{COPY.gate.noPool}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link
            href="/"
            className="inline-flex h-11 items-center rounded-full bg-brand px-6 text-[15px] font-semibold text-(--color-base) hover:bg-brand-hot"
          >
            {COPY.shell.nav.backToPlay}
          </Link>
          <Link
            href="/pools"
            className="inline-flex h-11 items-center rounded-full border border-white/20 px-6 text-[15px] text-ink hover:border-brand hover:text-brand"
          >
            {COPY.gate.browsePools}
          </Link>
        </div>
      </StatePanel>
    );
  }
  if (!pool) {
    if (poolLoad === 'missing') {
      return (
        <StatePanel title={COPY.gate.poolMissingTitle}>
          <p>{COPY.gate.poolMissing}</p>
          <Link href="/" className="mt-1 text-brand underline underline-offset-2">
            {COPY.shell.nav.backToPlay}
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
  // A pool that closes WHILE someone is playing does not take their work
  // away: they finish, and `register` gives them the honest refusal.
  if (pool.state !== 'Open' && !done && !revealRun && !runInProgress) {
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
        {/* The list is GENERATED from config/territories.json (§3.3) — never
            typed here, so a founder instruction that changes the schedule
            changes this panel in the same commit. Named in full rather than
            summarised: this is the one screen whose whole job is to explain
            the refusal, and a visitor should be able to see whether their
            territory is on the list. */}
        <p>{COPY.gate.territoryBlocked(blockedTerritoryPhrase())}</p>
        <p className="text-[13px]">
          <Link href="/rules#availability" className="underline underline-offset-2">
            {COPY.gate.territoryBlockedSeeRules}
          </Link>
        </p>
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

  /*
   * A GENUINE account change, told apart from a transient one: the address
   * is known, signed in, and is not the address this run began with. That
   * is the only auth event allowed to take a run off the screen, and it
   * explains itself.
   */
  if (runInProgress && interruption === 'account-changed') {
    return (
      <StatePanel title={COPY.gate.walletChangedTitle}>
        <p>{COPY.gate.walletChanged}</p>
        <Button
          intent="quiet"
          className="self-start"
          onClick={() => {
            setRunWallet(null);
            setLastConfirmed(null);
            setSubmitBlocked(false);
            setEntered(null);
          }}
        >
          {COPY.gate.walletChangedRestart}
        </Button>
      </StatePanel>
    );
  }

  // Each of the three gates below can flip for a moment during an ordinary
  // reconnect. Before a run they are the pre-flight; during one they are
  // not allowed to unmount it (C-17 / D-13).
  if (auth.status !== 'signed-in' && !runInProgress) {
    return (
      <StatePanel title="Sign in to enter">
        <p>Entering needs a signed-in wallet — sign in from the header above.</p>
        {/* D-17: the pool travels with them, so signing in returns to THIS
            tournament rather than to "No pool selected". */}
        <Link
          href={signInHref(`/play?pool=${poolId}`)}
          className="mt-1 text-brand underline underline-offset-2"
        >
          {COPY.signin.title}
        </Link>
      </StatePanel>
    );
  }
  if (!auth.walletAddress && !runInProgress) {
    return <PendingPanel label="Resolving your wallet" />;
  }
  if (!hasSigner && !runInProgress) {
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

  const enteredKey = `${pool.pool}:${wallet}`;
  // The existing-entry read is pre-flight too: it must not re-run over a
  // live run and replace it with a spinner (C-17 / D-13). `wallet` is
  // non-null here off a run — the gates above guarantee it — and the test
  // is what tells the compiler so.
  if (!done && !revealRun && !runInProgress && wallet) {
    if (!entered || entered.key !== enteredKey) {
      return <EntriesCheck key={enteredKey} pool={pool.pool} wallet={wallet} onResult={(seat) => setEntered({ key: enteredKey, seat })} />;
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

  // The reveal takeover owns the screen from confirm onward — over the stage.
  if (revealRun) {
    const retry = lastConfirmed
      ? () => startSubmit(lastConfirmed.battles, lastConfirmed.timingsMs)
      : null;
    const revealHost = (
      <RevealHost
        poolNumber={pool.id}
        result={revealRun}
        onBeat={onRevealBeat}
        quiet
        renderCard={(card) => (
          <EnteredPanel
            entryIndex={card.entryIndex}
            asset={card.asset}
            poolNumber={pool.id}
            poolAddress={pool.pool}
            wallet={auth.walletAddress ?? ''}
            signer={auth.signers.find((s) => s.address === auth.walletAddress)}
            email={auth.email}
            apiBase={process.env.NEXT_PUBLIC_ENTRY_API_URL}
            notifyOffered={notifyVersion === 'v2'}
          />
        )}
        onRetry={
          retry
            ? () => {
                stageDispatch({ type: 'retry' });
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
            // The retry copy of the run exists for a failure nothing landed
            // from; once a seat is held it is surplus (2026-09-16).
            setLastConfirmed(null);
            setDone(true);
            return;
          }
          if (exit === 'pending') {
            // Broadcast and not yet confirmed: it may still land, so neither
            // a second run nor "Sealed" is honest. The pool page is, and it
            // shows the entry the moment the network confirms it.
            setLastConfirmed(null);
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
          setRunWallet(null);
          setSubmitBlocked(false);
          setPool(null);
          setPoolLoad('loading');
          setPoolRun((n) => n + 1);
          stageDispatch({ type: 'reset' });
        }}
      />
    );
    // The takeover's beats draw in the stage's side column, the blender
    // staying on screen through the confirm and after it (round four, §E).
    return <>{stageWith(revealHost)}</>;
  }

  /*
   * The seal could not be submitted — signed in, and nothing able to sign at
   * that moment. The seven allocations are held in `lastConfirmed`, so this
   * is a retry, not a restart: pressing try again re-submits the SAME
   * battles. Before this the confirm silently did nothing.
   */
  if (submitBlocked) {
    return (
      <StatePanel title={COPY.gate.signerMissingTitle}>
        <p>{COPY.gate.signerMissing}</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <Button intent="quiet" onClick={retrySubmit} disabled={!lastConfirmed}>
            {COPY.gate.poolLoadRetry}
          </Button>
          <Link href="/wallet" className="text-brand underline underline-offset-2">
            {COPY.gate.signerMissingLink}
          </Link>
        </div>
      </StatePanel>
    );
  }

  /*
   * The wallet the flow below belongs to. During a run it is the address
   * the run began with — NOT the live one — so a reconnect that briefly
   * drops or re-reports the address cannot change the `key` and remount the
   * whole subtree underneath it. Off a run the two are the same value.
   */
  const flowWallet = runWallet ?? auth.walletAddress;
  if (!flowWallet) return <PendingPanel label="Resolving your wallet" />;

  return (
    <AttestationGate
      key={flowWallet}
      wallet={flowWallet}
      signer={auth.signers.find((s) => s.address === flowWallet)}
    >
      <BalanceGateView
        state={balanceForGate}
        entryLamports={pool.entry_lamports}
        wallet={flowWallet}
        addFunds={auth.addFunds}
        onRecheck={() => setBalanceRun((n) => n + 1)}
      >
        {/* The board (founder brief 2026-09-24). Phase A: every pool plays EASY. */}
        <BoardFlow
          mode="easy"
          onConfirm={onConfirm}
          onRunStarted={() => setRunWallet(flowWallet)}
          onReviewApi={onReviewApi}
          reviewHost={reviewHost}
        />
      </BalanceGateView>
      {stage}
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
  /* D-14: a refusal the player can see, and a route out that does not
   * depend on the provider's funding flow being switched on at all. */
  const [fundingFailed, setFundingFailed] = useState(false);
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
                setFundingFailed(false);
                /*
                 * Straight onto the deposit-address screen on devnet: no
                 * card or exchange provider sells devnet SOL, so it is the
                 * only funding method that can work there.
                 *
                 * The call returns an OUTCOME (wallet/funding.ts). Until
                 * 2026-09-11 (audit D-14) a provider refusal — the SDK's
                 * "Wallet funding is not enabled", its state today — went
                 * to the console and nowhere else, so with funding
                 * switched off the only control on this wall was a dead
                 * button. The sentence below does not claim to know WHICH
                 * happened: a deliberate exit and a refusal are
                 * indistinguishable without the SDK's onUserExited
                 * callback, so it says the window did not open and names
                 * the route that works either way.
                 */
                const outcome = await openFunding(addFunds, wallet, {
                  method: isMainnet() ? 'any' : 'receive',
                });
                setFundingFailed(outcome !== 'opened');
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
        {fundingFailed ? (
          <p role="status" data-testid="topup-failed" className="text-[13px] leading-5 text-ink-muted">
            {COPY.gate.topUpUnavailable}{' '}
            <Link href="/wallet" className="text-brand underline underline-offset-2">
              {COPY.gate.topUpWalletPage}
            </Link>
          </p>
        ) : null}
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
  /*
   * C-13 (audit 2026-09-11): the REASON, not a boolean. Each one gets its
   * own sentence, because "this wallet cannot sign messages" and "your
   * connection dropped" have different next steps and only one of them is
   * worth trying again.
   */
  const [attestError, setAttestError] = useState<AttestationFailure | null>(null);
  const [attesting, setAttesting] = useState(false);
  /** Lets the player stop waiting on a wallet prompt that never answers —
   * the gate had no exit at all while it waited. */
  const cancelAttest = useRef<AbortController | null>(null);

  const onAttest = useCallback(async () => {
    if (attesting) return;
    setAttesting(true);
    setAttestError(null);
    const controller = new AbortController();
    cancelAttest.current = controller;
    const result = await submitAttestation(
      process.env.NEXT_PUBLIC_ENTRY_API_URL,
      signer,
      wallet,
      undefined,
      undefined,
      { signal: controller.signal }
    );
    cancelAttest.current = null;
    setAttesting(false);
    if (result.ok) notifyAttested();
    else setAttestError(result.reason);
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
        <p className="text-[14px] leading-5 text-price-down" role="alert" data-testid="gate-error">
          {COPY.gate.attestErrors[attestError]}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <Button size="lg" disabled={!ready || attesting} onClick={onAttest} data-testid="gate-confirm">
          {attesting ? COPY.gate.gateSigning : COPY.gate.ageConfirm}
        </Button>
        {attesting && (
          // The way out of a prompt that never came back. Without it the
          // button stayed disabled and the page was a dead end.
          <Button
            intent="quiet"
            data-testid="gate-cancel"
            onClick={() => cancelAttest.current?.abort()}
          >
            {COPY.gate.attestCancel}
          </Button>
        )}
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
