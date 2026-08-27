'use client';

/*
 * The play-flow client: age attestation (3.1) → the battle flow (3.4) → the
 * sealed submit (3.3). The reveal machine takes over after `register`
 * confirms — its CONFIRMED-BEFORE-REVEAL discipline is carried and pinned
 * (src/reveal/machine.ts).
 *
 * PHASE-3-REVIEW: `EntryServices` is wired to placeholder endpoints until
 * the Phase 4 packet service exists and the Phase 5 rehearsal wires devnet;
 * until then the submit path surfaces a clear "entry service not configured"
 * error rather than pretending.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { COPY } from '@/copy';
import { BattleFlow } from '@/battle/components/battle-flow';
import type { Allocation } from '@/battle/allocation';
import { indexerApi } from '@/data/api';
import type { PoolSummary } from '@/data/types';
import { useAuth } from '@/wallet/auth-context';
import { submitEntry, type EntryServices } from '@/entry/submit';
import { checkGeoGate, type GeoGateState } from '@/entry/geo-gate';
import {
  TERMS_VERSION,
  hasLocalAttestation,
  submitAttestation,
} from '@/entry/attestation';

function browserServices(): EntryServices {
  const base = process.env.NEXT_PUBLIC_ENTRY_API_URL;
  const need = (): never => {
    throw new Error('entry service not configured (NEXT_PUBLIC_ENTRY_API_URL)');
  };
  return {
    async putCiphertext(pool, player, ciphertext) {
      if (!base) need();
      const res = await fetch(`${base}/ciphertexts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pool,
          player,
          ciphertext: Buffer.from(ciphertext).toString('base64'),
        }),
      });
      if (!res.ok) throw new Error(`ciphertext store: ${res.status}`);
    },
    async requestPacket() {
      // Phase 4 (roadmap 4.1) — the packet service issues this.
      return need();
    },
    async sendRegister() {
      // Phase 5 wires the carried tx seam against devnet.
      return need();
    },
    randomBytes(n) {
      const out = new Uint8Array(n);
      crypto.getRandomValues(out);
      return out;
    },
    async deviceHash() {
      // R19: the Privy device fingerprint — wired in Phase 4 with detection.
      return new Uint8Array(32);
    },
  };
}

export function PlayClient() {
  const params = useSearchParams();
  const poolId = params.get('pool');
  const auth = useAuth();
  const [pool, setPool] = useState<PoolSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  // D-B3: the territory pre-flight. Nothing that can take money renders
  // until the verdict is an explicit 'allowed' — fail-closed by default.
  const [geo, setGeo] = useState<GeoGateState>('checking');

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


  const onConfirm = useCallback(
    async (battles: readonly Allocation[], timingsMs: readonly number[]) => {
      if (!pool || auth.status !== 'signed-in' || !auth.walletAddress) return;
      try {
        await submitEntry(browserServices(), {
          pool: pool.pool,
          sealingPubkeyHex: pool.sealing_pubkey,
          player: auth.walletAddress,
          battles,
          timingsMs,
        });
        setSubmitted(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [pool, auth]
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

  // D-B4: the versioned clickwrap — conspicuous, unavoidable, BEFORE any
  // paid action. Keyed by wallet so acceptance state re-derives per wallet;
  // a terms-version bump re-prompts because the cache key carries the
  // version.
  if (!auth.walletAddress) {
    return <p className="opacity-70">…</p>;
  }

  if (submitted) {
    return <p aria-live="polite">Entry submitted — sealing confirmed.</p>;
  }

  return (
    <AttestationGate
      key={auth.walletAddress}
      wallet={auth.walletAddress}
      signer={auth.signers.find((s) => s.address === auth.walletAddress)}
    >
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      <BattleFlow timerSeconds={pool.timer_seconds} onConfirm={onConfirm} />
    </AttestationGate>
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
