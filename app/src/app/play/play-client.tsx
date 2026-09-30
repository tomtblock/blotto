'use client';

/*
 * The play-flow client (C9): geo gate → sign-in → the BALANCE pre-flight →
 * the board, with "How this pool…" and the two statements beside it → the
 * ONE seal press → (the statements' signature, for a wallet not yet on
 * record) → the sealed submit through the REAL transaction pipeline → the
 * reveal takeover on the outcome.
 *
 * The balance check runs BEFORE the three-minute session ever starts:
 * a wallet that cannot cover entry + transaction costs sees the shortfall
 * (and, behind NEXT_PUBLIC_TOPUP_ENABLED, the provider top-up flow) instead
 * of a timer it cannot afford to finish.
 *
 * V5 (founder 2026-09-30): the entry is one view. The full-screen "Before
 * you enter" clickwrap that stood ahead of the board is gone; its two
 * statements are tiles on the board's rail (entry-rail.tsx), the seal key
 * waits on them (entry/seal-hold.ts), and the SAME signed acceptance
 * (D-B4, entry/attestation.ts) is taken at the seal press, ahead of the
 * entry's own two prompts. Nothing about what is signed, recorded or
 * verified changed — only where the player confirms it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { address } from '@solana/kit';
import { COPY } from '@/copy';
import { blockedTerritoryPhrase } from '@/rules/territories';
import { Button } from '@/components/ui/button';
import { BoardFlow } from '@/battle/components/board/BoardFlow';
import type { Allocation } from '@/battle/allocation';
import { indexerApi } from '@/data/api';
import { lamportsToSol, poolMode } from '@/data/format';
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
import { hasLocalAttestation, submitAttestation, type AttestationFailure } from '@/entry/attestation';
import { sealHold } from '@/entry/seal-hold';
import { signInHref } from '@/app/signin/return-to';
import { runInterruption } from './run-guard';
import { RevealHost } from './reveal-host';
import { PendingPanel } from '@/components/ui/pending-panel';
import { STOP_ACTIONS, StopCard } from '@/components/ui/stop-card';
import { observeSigner } from './observed-signer';
import { EnteredPanel } from './entered-panel';
import { EntryRail, notifyAttested, useAttested } from './entry-rail';
import { SigningOverlay, type SignStep } from './signing-overlay';
import { entryServiceNotifyVersion } from '@/notify/pool-notify';
import { BUILD_VERSION, checkBuildVersion } from '@/build/version';
import type { RevealState } from '@/reveal/machine';

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

/**
 * The statements' signature at the seal press (V5): idle until the press;
 * `signing` while the wallet prompt and the POST are out (the hold shows
 * its own sentence and a way to stop waiting); `failed` with the reason,
 * on a stop card that keeps the seven battles and offers the same press
 * again.
 */
type AttestState = { phase: 'idle' } | { phase: 'signing' } | { phase: 'failed'; reason: AttestationFailure };

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
  /*
   * 2026-09-09 (founder: "tried to enter again from the same wallet and got
   * a network error"): the chain holds one entry per wallet per pool, and a
   * second `register` fails at the entry account's creation. Read the pool's
   * entries FIRST, so a wallet that is already in sees its seat instead of
   * three minutes of battles that cannot be entered. Keyed by (pool,
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
   * THE SIGNING HOLD (V2, founder 2026-09-27; signing-overlay.tsx): from the
   * seal press until the network answers, the whole screen is one graphic
   * and one sentence over the board's record. Which sentence is decided by
   * the wallet's signatures, observed on the signer object this page hands
   * to the entry path (never inside it), and by the takeover's beat.
   */
  const [signStep, setSignStep] = useState<SignStep>('seal');
  const [revealBeat, setRevealBeat] = useState<RevealState['beat']>('entry');
  // Whether the board's record is still mounted behind the hold. True from
  // the seal press; false once a retry begins (the board is gone by then,
  // and a fresh one would be a ready banner behind the hold).
  const [boardBehind, setBoardBehind] = useState(false);
  // Round four (§E): whether the entry service can deliver the one-message
  // opt-in — asked once the entry is in flight, so the success screen offers
  // it only when there is a dispatcher behind it.
  const [notifyVersion, setNotifyVersion] = useState<string | null>(null);
  const onRevealBeat = useCallback((beat: RevealState['beat']) => setRevealBeat(beat), []);

  /*
   * THE STATEMENTS (V5). Whether this wallet's acceptance of the current
   * terms is on record on this device; the two tiles' state while it is
   * not; and the signature's progress at the seal press. The tiles reset
   * with the wallet: a different account confirms for itself.
   */
  const [consent, setConsent] = useState<{ wallet: string | null; age: boolean; terms: boolean }>({
    wallet: null,
    age: false,
    terms: false,
  });
  const ageChecked = consent.wallet === wallet && consent.age;
  const termsChecked = consent.wallet === wallet && consent.terms;
  const setAgeChecked = useCallback(
    (next: boolean) => setConsent((c) => ({ wallet, age: next, terms: c.wallet === wallet && c.terms })),
    [wallet]
  );
  const setTermsChecked = useCallback(
    (next: boolean) => setConsent((c) => ({ wallet, age: c.wallet === wallet && c.age, terms: next })),
    [wallet]
  );
  const [attest, setAttest] = useState<AttestState>({ phase: 'idle' });
  const cancelAttest = useRef<AbortController | null>(null);

  const startSubmit = useCallback(
    (battles: readonly Allocation[], timingsMs: readonly number[]): Promise<RevealResult> | null => {
      if (!pool || auth.status !== 'signed-in' || !auth.walletAddress) return null;
      const signer = auth.signers.find((s) => s.address === auth.walletAddress);
      if (!signer) return null;
      const services = makeLiveEntryServices({
        apiBase: process.env.NEXT_PUBLIC_ENTRY_API_URL,
        programId: process.env.NEXT_PUBLIC_PROGRAM_ID,
        rpc,
        // The hold learns "signed" from the object the entry path is given.
        signer: observeSigner(signer, (e) => setSignStep(e === 'message-signed' ? 'pay' : 'network')),
        poolId: BigInt(pool.id),
      });
      return submitForReveal(services, rpc, {
        pool: pool.pool,
        sealingPubkeyHex: pool.sealing_pubkey,
        player: auth.walletAddress,
        battles,
        timingsMs,
        // The POOL's rule, from its record (Phase B) — never the board's guess.
        mode: poolMode(pool),
      });
    },
    [pool, auth, rpc]
  );

  // The confirmed battles, kept ONLY to power retry after a failure the tx
  // seam marks `retryable` (a fresh salt + upsert ciphertext + new packet —
  // nothing landed and nothing can), and after a statements' signature that
  // did not go through.
  const [lastConfirmed, setLastConfirmed] = useState<{
    battles: readonly Allocation[];
    timingsMs: readonly number[];
  } | null>(null);

  /*
   * C-17 / D-13 (audit 2026-09-11). THE RUN IS THE PLAYER'S WORK, and until
   * the seal it exists nowhere but inside the board (BoardFlow). Every gate below used
   * to be re-evaluated on every render, so a wallet reconnect, an active-
   * address change, or a balance re-check in the middle of the three
   * minutes took the screen away and destroyed all seven allocations with
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
  /*
   * THE BUILD CHECK (2026-09-28, D-E18; build/version.ts has the reasoning).
   * One build serves the site and the Android shell, and a page left open
   * across a deploy — a phone app in the background for days — must not
   * seal an entry the current engine would read differently. Asked ONCE
   * when the page opens, so the common case stops before a board is
   * played, and AGAIN at the seal, so a deploy during the three minutes is
   * caught before anything is signed. `unknown` (the route did not answer)
   * proceeds: this guards a stale page, not an absent server.
   */
  const [staleBuild, setStaleBuild] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void checkBuildVersion({ fetch, current: BUILD_VERSION }).then((verdict) => {
      if (!cancelled && verdict === 'stale') setStaleBuild(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The seal press, from the board or the buzzer's review. In order: the
   * build check; the statements' signature when this wallet's acceptance
   * is not on record (the key only lit once both tiles were confirmed,
   * seal-hold.ts); then the entry itself. Each step that stops says so and
   * keeps the seven battles for the same press again.
   */
  const onConfirm = useCallback(
    async (battles: readonly Allocation[], timingsMs: readonly number[]) => {
      // Remembered FIRST and unconditionally: it is the player's three
      // minutes, and it must survive whatever the submit does next.
      setLastConfirmed({ battles, timingsMs });
      // Before the seal, never after: a stale page signs nothing.
      if ((await checkBuildVersion({ fetch, current: BUILD_VERSION })) === 'stale') {
        setStaleBuild(true);
        return;
      }
      const signerWallet = auth.status === 'signed-in' ? auth.walletAddress : null;
      const signer = signerWallet ? auth.signers.find((s) => s.address === signerWallet) : undefined;
      if (signerWallet && !hasLocalAttestation(signerWallet)) {
        // The acceptance is the signature, not the tick (D-B4): taken now,
        // once, ahead of the entry's own prompts. Fail-closed like the gate
        // it replaced — a refusal, a decline or a hung prompt stops here.
        setAttest({ phase: 'signing' });
        setSignStep('attest');
        const controller = new AbortController();
        cancelAttest.current = controller;
        const result = await submitAttestation(
          process.env.NEXT_PUBLIC_ENTRY_API_URL,
          signer,
          signerWallet,
          undefined,
          undefined,
          { signal: controller.signal }
        );
        cancelAttest.current = null;
        if (!result.ok) {
          setAttest({ phase: 'failed', reason: result.reason });
          return;
        }
        notifyAttested();
        setAttest({ phase: 'idle' });
      }
      const run = startSubmit(battles, timingsMs);
      if (run) {
        setSubmitBlocked(false);
        setSignStep('seal');
        setRevealBeat('entry');
        setRevealRun(() => run);
      } else {
        // Signed in, but nothing that can sign right now. Never a silent
        // no-op: the old code returned here and left "Sealing…" on screen
        // for ever.
        setSubmitBlocked(true);
      }
    },
    [startSubmit, auth]
  );

  const retrySubmit = useCallback(() => {
    setBoardBehind(false);
    setAttest({ phase: 'idle' });
    if (lastConfirmed) void onConfirm(lastConfirmed.battles, lastConfirmed.timingsMs);
  }, [lastConfirmed, onConfirm]);

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
  const runInProgress = interruption !== 'none' && !revealRun;
  /** Once the run has begun the balance pre-flight has been passed; a later
   * re-check must not blank the screen the player is playing on. */
  const balanceForGate: BalanceGateState | 'checking' = runInProgress
    ? { state: 'ok', haveLamports: 0n }
    : balance;

  if (!poolId) {
    return (
      <StopCard
        kind="dead-end"
        title={COPY.gate.noPoolTitle}
        actions={[STOP_ACTIONS.findAnotherPool(), STOP_ACTIONS.seePools()]}
        data-testid="stop-no-pool"
      >
        <p>{COPY.gate.noPool}</p>
      </StopCard>
    );
  }
  if (!pool) {
    if (poolLoad === 'missing') {
      return (
        <StopCard
          kind="dead-end"
          title={COPY.gate.poolMissingTitle}
          actions={[STOP_ACTIONS.findAnotherPool(), STOP_ACTIONS.backHome()]}
          data-testid="stop-pool-missing"
        >
          <p>{COPY.gate.poolMissing}</p>
        </StopCard>
      );
    }
    if (poolLoad === 'failed') {
      return (
        <StopCard
          kind="error"
          title={COPY.gate.poolLoadFailedTitle}
          actions={[
            {
              label: COPY.gate.poolLoadRetry,
              intent: 'primary',
              onClick: () => {
                setPoolLoad('loading');
                setPoolRun((n) => n + 1);
              },
            },
            { ...STOP_ACTIONS.findAnotherPool(), intent: 'quiet' },
          ]}
          data-testid="stop-pool-load-failed"
        >
          <p>{COPY.gate.poolLoadFailed}</p>
        </StopCard>
      );
    }
    return <PendingPanel label="Loading the pool" />;
  }

  // The pool must still be taking entries — a stale tab or an old link must
  // not start a run that the program will refuse (PoolNotOpen). After this
  // wallet's own entry the takeover and its success screen stay put
  // regardless. A pool that closes WHILE someone is playing does not take
  // their work away: they finish, and `register` gives them the honest
  // refusal.
  if (pool.state !== 'Open' && !revealRun && !runInProgress) {
    return (
      <StopCard
        kind="dead-end"
        title={COPY.gate.poolClosedTitle}
        actions={[
          STOP_ACTIONS.findAnotherPool(),
          { href: `/pools/${pool.pool}/results`, label: COPY.pool.resultsLink, intent: 'quiet' },
        ]}
        data-testid="stop-pool-closed"
      >
        <p>{COPY.gate.poolClosed}</p>
      </StopCard>
    );
  }

  // D-B3: territory gate ahead of everything, including the statements.
  if (geo === 'checking') return <PendingPanel label="Checking availability" />;
  if (geo === 'blocked') {
    // Fail-closed covers a slow or unreachable check too (D-B3), so the
    // panel offers one more look before the player concludes anything.
    return (
      <StopCard
        kind="refusal"
        title={COPY.gate.territoryBlockedTitle}
        actions={[
          {
            label: COPY.gate.territoryRecheck,
            intent: 'primary',
            onClick: () => {
              setGeo('checking');
              setGeoRun((n) => n + 1);
            },
          },
          STOP_ACTIONS.backHome(),
        ]}
        data-testid="stop-territory"
      >
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
      </StopCard>
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
      <StopCard
        kind="dead-end"
        title={COPY.gate.walletChangedTitle}
        actions={[
          {
            label: COPY.gate.walletChangedRestart,
            intent: 'primary',
            onClick: () => {
              setRunWallet(null);
              setLastConfirmed(null);
              setSubmitBlocked(false);
              setAttest({ phase: 'idle' });
              setEntered(null);
            },
          },
          STOP_ACTIONS.wallet(),
        ]}
        data-testid="stop-wallet-changed"
      >
        <p>{COPY.gate.walletChanged}</p>
      </StopCard>
    );
  }

  /*
   * A stale build stops everything, run or no run (D-E18): once the seal
   * has refused there is nothing on this page that can be entered, and the
   * only way forward is the current build. Placed ahead of the run-guard
   * gates on purpose — it is not a reconnect flicker, it is a fact about
   * the page. The pre-flight variant fires before a board exists, so the
   * ordinary case costs the player nothing; the seal-time variant is the
   * rare one and says what was and was not done.
   */
  if (staleBuild) {
    return (
      <StopCard
        kind="dead-end"
        title={COPY.build.staleTitle}
        actions={[
          { label: COPY.build.reload, intent: 'primary', onClick: () => window.location.reload() },
          { ...STOP_ACTIONS.findAnotherPool(), intent: 'quiet' },
        ]}
        data-testid="stop-stale-build"
      >
        <p>{COPY.build.stale}</p>
      </StopCard>
    );
  }

  // Each of the three gates below can flip for a moment during an ordinary
  // reconnect. Before a run they are the pre-flight; during one they are
  // not allowed to unmount it (C-17 / D-13).
  if (auth.status !== 'signed-in' && !runInProgress) {
    return (
      <StopCard
        kind="dead-end"
        title={COPY.gate.signInTitle}
        actions={[
          /* D-17: the pool travels with them, so signing in returns to THIS
             pool rather than to "No pool selected". */
          { href: signInHref(`/play?pool=${poolId}`), label: COPY.signin.title, intent: 'primary' },
          { ...STOP_ACTIONS.findAnotherPool(), intent: 'quiet' },
        ]}
        data-testid="stop-sign-in"
      >
        <p>{COPY.gate.signInLine}</p>
      </StopCard>
    );
  }
  if (!auth.walletAddress && !runInProgress) {
    return <PendingPanel label="Resolving your wallet" />;
  }
  if (!hasSigner && !runInProgress) {
    // Signed in, address known, nothing that can sign for it. Hold, then say
    // so — never let the three minutes start against a wallet that cannot
    // confirm at the end.
    //
    // The KNOWN case does not hold (D-E18): a mobile wallet that offers
    // sign-and-send only has said so at sign-in (wallet/types.ts,
    // `signerLimit`), reconnecting cannot change it, and the sentence names
    // the wallets that can enter instead.
    const cannotSignTransactions = auth.status === 'signed-in' && auth.signerLimit === 'no-sign-transaction';
    return signerWaitExpired || cannotSignTransactions ? (
      <StopCard
        kind="error"
        title={COPY.gate.signerMissingTitle}
        actions={[{ ...STOP_ACTIONS.wallet(), intent: 'primary' }, { ...STOP_ACTIONS.findAnotherPool(), intent: 'quiet' }]}
        data-testid="stop-signer-missing"
      >
        <p>{cannotSignTransactions ? COPY.gate.signerCannotSignTransactions : COPY.gate.signerMissing}</p>
      </StopCard>
    ) : (
      <PendingPanel label={COPY.gate.signerConnecting} />
    );
  }

  const enteredKey = `${pool.pool}:${wallet}`;
  // The existing-entry read is pre-flight too: it must not re-run over a
  // live run and replace it with a spinner (C-17 / D-13). `wallet` is
  // non-null here off a run — the gates above guarantee it — and the test
  // is what tells the compiler so.
  if (!revealRun && !runInProgress && wallet) {
    if (!entered || entered.key !== enteredKey) {
      return <EntriesCheck key={enteredKey} pool={pool.pool} wallet={wallet} onResult={(seat) => setEntered({ key: enteredKey, seat })} />;
    }
    if (entered.seat !== null) {
      return (
        <StopCard
          kind="dead-end"
          title={COPY.gate.alreadyEnteredTitle}
          actions={[
            { href: `/pools/${pool.pool}`, label: COPY.gate.alreadyEnteredPool, intent: 'primary' },
            { href: `/pools/${pool.pool}/results`, label: COPY.gate.alreadyEnteredResults, intent: 'quiet' },
            { ...STOP_ACTIONS.findAnotherPool(), intent: 'quiet' },
          ]}
          data-testid="stop-already-entered"
        >
          <p>{COPY.gate.alreadyEntered(entered.seat)}</p>
        </StopCard>
      );
    }
  }

  /*
   * The wallet the flow below belongs to. During a run it is the address
   * the run began with — NOT the live one — so a reconnect that briefly
   * drops or re-reports the address cannot change the `key` and remount the
   * whole subtree underneath it. Off a run the two are the same value.
   */
  const flowWallet = runWallet ?? auth.walletAddress;
  if (!flowWallet) return <PendingPanel label="Resolving your wallet" />;

  /*
   * The board under its gates, with the rail beside it. Built ONCE and
   * always returned in the same slot of the same fragment, with or without
   * the takeover beside it: React keeps the board's state — the player's
   * seven battles — only while its position in the tree is unchanged, and
   * the signing hold is drawn over that record, not instead of it.
   */
  const board = (
    <BalanceGateView
      key={flowWallet}
      // Once the entry is in flight the balance pre-flight is behind us; a
      // re-check must not blank the record under the hold.
      state={revealRun ? { state: 'ok', haveLamports: 0n } : balanceForGate}
      entryLamports={pool.entry_lamports}
      wallet={flowWallet}
      addFunds={auth.addFunds}
      onRecheck={() => setBalanceRun((n) => n + 1)}
    >
      <BoardWithRail
        wallet={flowWallet}
        mode={poolMode(pool)}
        ageChecked={ageChecked}
        termsChecked={termsChecked}
        onAgeChange={setAgeChecked}
        onTermsChange={setTermsChecked}
        railDisabled={attest.phase === 'signing'}
        onConfirm={onConfirm}
        onRunStarted={() => {
          setRunWallet(flowWallet);
          setBoardBehind(true);
        }}
      />
    </BalanceGateView>
  );

  // The reveal takeover owns the screen from confirm onward: the hold over
  // the board's record while the chain answers, then the success screen or
  // the rejection card in the record's place.
  if (revealRun) {
    const retry = lastConfirmed
      ? () => startSubmit(lastConfirmed.battles, lastConfirmed.timingsMs)
      : null;
    const revealHost = (
      <RevealHost
        result={revealRun}
        onBeat={onRevealBeat}
        waiting={<SigningOverlay step={signStep} />}
        renderCard={(card) => (
          <EnteredPanel
            entryIndex={card.entryIndex}
            asset={card.asset}
            poolNumber={pool.id}
            mode={poolMode(pool)}
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
                setBoardBehind(false);
                setSignStep('seal');
                const run = retry();
                if (run) return run;
                return revealRun;
              }
            : undefined
        }
        onDone={(exit) => {
          /*
           * Audit O25 (2026-09-11): only an entry that exists may read as
           * sealed. The success screen is terminal (no dismiss), so the
           * `entered` exit is unreachable; it is handled all the same, as
           * a stay, never as a restart.
           */
          if (exit === 'entered') {
            setLastConfirmed(null);
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
          setBoardBehind(false);
        }}
      />
    );
    // Slot 0 is the board (its record stays under the hold while the chain
    // answers); slot 1 the takeover. Same shape as the plain return below.
    return (
      <>
        {revealBeat === 'entry' && boardBehind ? board : null}
        {revealHost}
      </>
    );
  }

  /*
   * The statements' signature is out (V5): the same hold as the entry's,
   * over the board's record, with its own sentence and a way to stop
   * waiting on a prompt that never comes back.
   */
  if (attest.phase === 'signing') {
    return (
      <>
        {boardBehind ? board : null}
        <SigningOverlay step="attest" onCancel={() => cancelAttest.current?.abort()} />
      </>
    );
  }

  /*
   * The statements were not signed: one sentence per reason (audit C-13),
   * because the next step differs — a wallet that cannot sign messages is
   * not helped by trying again; a declined prompt is not an error. The
   * seven battles are held in `lastConfirmed`, so Try again is the same
   * press: the statements first, then the entry.
   */
  if (attest.phase === 'failed') {
    const retryable = attest.reason !== 'not-configured' && attest.reason !== 'cannot-sign';
    return (
      <StopCard
        kind="failure"
        title={COPY.gate.attestFailedTitle}
        actions={[
          ...(retryable ? [{ label: COPY.gate.poolLoadRetry, intent: 'primary' as const, onClick: retrySubmit, 'data-testid': 'gate-retry' }] : []),
          { ...STOP_ACTIONS.wallet(), intent: retryable ? ('quiet' as const) : ('primary' as const) },
          { ...STOP_ACTIONS.findAnotherPool(), intent: 'quiet' },
        ]}
        data-testid="stop-attest-failed"
      >
        <p data-testid="gate-error">{COPY.gate.attestErrors[attest.reason]}</p>
      </StopCard>
    );
  }

  /*
   * The seal could not be submitted — signed in, and nothing able to sign at
   * that moment. The seven allocations are held in `lastConfirmed`, so this
   * is a retry, not a restart: pressing try again re-submits the SAME
   * battles. Before this the confirm silently did nothing.
   */
  if (submitBlocked) {
    return (
      <StopCard
        kind="failure"
        title={COPY.gate.signerMissingTitle}
        actions={[
          { label: COPY.gate.poolLoadRetry, intent: 'primary', onClick: retrySubmit },
          STOP_ACTIONS.wallet(),
        ]}
        data-testid="stop-submit-blocked"
      >
        <p>{COPY.gate.signerMissing}</p>
      </StopCard>
    );
  }

  return (
    <>
      {board}
      {null}
    </>
  );
}

/**
 * The board and its rail for one wallet (V5). Whether the statements are
 * drawn, and whether the seal waits on them, follows the device's record
 * of this wallet's acceptance — read through a store so the server and
 * the hydrating render agree (entry-rail.tsx).
 */
function BoardWithRail({
  wallet,
  mode,
  ageChecked,
  termsChecked,
  onAgeChange,
  onTermsChange,
  railDisabled,
  onConfirm,
  onRunStarted,
}: {
  wallet: string;
  mode: ReturnType<typeof poolMode>;
  ageChecked: boolean;
  termsChecked: boolean;
  onAgeChange: (next: boolean) => void;
  onTermsChange: (next: boolean) => void;
  railDisabled: boolean;
  onConfirm: (battles: readonly Allocation[], timingsMs: readonly number[]) => void;
  onRunStarted: () => void;
}) {
  const attested = useAttested(wallet);
  const hold = sealHold({ attested, ageChecked, termsChecked });
  return (
    <BoardFlow
      mode={mode}
      onConfirm={onConfirm}
      onRunStarted={onRunStarted}
      sealHold={hold === 'statements' ? COPY.gate.sealHoldStatements : null}
      rail={
        <EntryRail
          mode={mode}
          attested={attested}
          ageChecked={ageChecked}
          termsChecked={termsChecked}
          onAgeChange={onAgeChange}
          onTermsChange={onTermsChange}
          disabled={railDisabled}
        />
      }
    />
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
    <StopCard
      kind={state.state === 'insufficient' ? 'refusal' : 'error'}
      title={state.state === 'insufficient' ? COPY.gate.balanceInsufficientTitle : COPY.gate.balanceUnavailableTitle}
      actions={[STOP_ACTIONS.findAnotherPool()]}
      data-testid="stop-balance"
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
    </StopCard>
  );
}
