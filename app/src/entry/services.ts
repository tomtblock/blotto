/*
 * The LIVE `EntryServices` (C9) — the browser implementation the play page
 * injects into `submitEntry`. Replaces the Phase 3 placeholder stubs:
 *
 *   - `requestPacket`: POST /packet on the entry service → the issued
 *     packet's message/signature/signer bytes;
 *   - `sendRegister`: the src/tx pipeline end to end — derive the PDAs
 *     (the platform treasury included, D-A1 revised), generate the fresh
 *     pass-asset keypair (Core requires its signature), build the Ed25519 +
 *     `register` instructions and drive `executeTrade` to confirmation.
 *
 * Configuration is explicit and fail-closed: a missing entry API or program
 * id throws a plain "not configured" error before anything is signed.
 */

import {
  ciphertextMessage,
  ciphertextStatusMessage,
} from '@blotto/packet/ciphertext-message';
import { generateKeyPair, getAddressFromPublicKey } from '@solana/kit';
import { executeTrade } from '@/tx/execute';
import type { TxRpc } from '@/tx/tx-rpc';
import type { LifecycleLogEntry, TxFailure, TxSigner } from '@/tx/types';
import type { EntryServices } from './submit';
import { deviceMarker } from './device';
import {
  buildEd25519Instruction,
  buildRegisterInstruction,
  deriveRegisterPdas,
  type IssuedPacketBytes,
} from './register-tx';

/**
 * The entry service answered, and the answer was no (audit 2026-09-11,
 * D-12).
 *
 * Every non-2xx from the ciphertext store and the packet endpoint used to
 * become a bare `Error`, which the outcome seam then classified as
 * `rpc-failure` — "the network request did not go through, check your
 * connection and try again". For a refusal that is false twice over: the
 * request went through perfectly, and the retry it offers can only be
 * refused again. A player meets that at the END of the ninety seconds.
 *
 * `status` is the HTTP status, or null when nothing answered at all. The
 * REASON is deliberately not carried: the service gives a generic refusal
 * on purpose (PID §8), and this type must not become a channel that leaks
 * one.
 */
export class EntryServiceError extends Error {
  constructor(
    readonly stage: 'ciphertext' | 'packet',
    readonly status: number | null,
    message: string
  ) {
    super(message);
    this.name = 'EntryServiceError';
  }

  /** True when the service DECIDED (4xx), as opposed to being unreachable
   * or broken (5xx, or no answer at all). A decision is not retryable. */
  get refused(): boolean {
    return this.status !== null && this.status >= 400 && this.status < 500;
  }
}

/** A register that reached a terminal FAILED state in the tx seam — carries
 * the classified failure so the reveal machine renders honest copy. */
export class RegisterFailedError extends Error {
  constructor(
    readonly failure: TxFailure,
    readonly signature: string | null
  ) {
    super(failure.message);
    this.name = 'RegisterFailedError';
  }
}

export interface LiveEntryServicesConfig {
  /** NEXT_PUBLIC_ENTRY_API_URL — the packet/ciphertext/attestation server. */
  apiBase: string | undefined;
  /** NEXT_PUBLIC_PROGRAM_ID — the blotto_cup program (base58). */
  programId: string | undefined;
  rpc: TxRpc;
  signer: TxSigner;
  /** The pool's numeric id (`PoolSummary.id`) — the PDA seed. */
  poolId: bigint;
  onEvent?: (entry: LifecycleLogEntry) => void;
}

const fromB64 = (s: string): Uint8Array => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < out.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const toB64 = (b: Uint8Array): string => {
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin);
};

/**
 * "Has this wallet already sealed for this pool?" — the one question the
 * lockout made unanswerable (DRIFT.md §H6).
 *
 * PHASE-N-REVIEW (2026-09-18): deliberately NOT called from `submitEntry`.
 * Asking costs a wallet signature prompt, and putting one in front of every
 * entry would spend a prompt on the ninety-second session to detect a state
 * that the backend fix has just made recoverable. This is here for the
 * surfaces that need the truth about a specific wallet — a support answer,
 * the battle test's preflight, a "you already sealed here" panel if the
 * founder wants one — not for the hot path. Wiring it into the flow is a UX
 * decision, and the founder owns it.
 *
 * The wallet proves it is asking about ITSELF; the answer is a boolean and
 * never the ciphertext, so nothing here reads a sealed allocation.
 *
 * @returns true/false, or null when the service could not answer.
 */
export async function checkSealed(
  apiBase: string | undefined,
  signer: Pick<TxSigner, 'signMessage'>,
  pool: string,
  player: string,
  nowUnix: bigint = BigInt(Math.floor(Date.now() / 1000))
): Promise<boolean | null> {
  if (!apiBase) throw new Error('entry service not configured (NEXT_PUBLIC_ENTRY_API_URL)');
  if (!signer.signMessage) throw new Error('this wallet cannot sign');
  const signature = await signer.signMessage(
    ciphertextStatusMessage(pool, player, nowUnix)
  );
  let res: Response;
  try {
    res = await fetch(`${apiBase}/ciphertexts/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pool,
        player,
        atUnix: nowUnix.toString(),
        signature: toB64(signature),
      }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const body = (await res.json()) as { sealed?: unknown };
  return typeof body.sealed === 'boolean' ? body.sealed : null;
}

export function makeLiveEntryServices(cfg: LiveEntryServicesConfig): EntryServices {
  const api = (): string => {
    if (!cfg.apiBase) throw new Error('entry service not configured (NEXT_PUBLIC_ENTRY_API_URL)');
    return cfg.apiBase;
  };

  return {
    async putCiphertext(pool, player, ciphertext) {
      // The service will not store an allocation it cannot attribute: the
      // wallet signs a message binding the pool, itself and a digest of
      // these exact bytes, so nobody else can write or replace this seat's
      // allocation (audit B-02). A wallet that cannot sign a message cannot
      // seal — the flow fails closed rather than around.
      if (!cfg.signer.signMessage) {
        throw new Error('this wallet cannot sign a sealed allocation');
      }
      const signature = await cfg.signer.signMessage(
        ciphertextMessage(pool, player, ciphertext)
      );
      let res: Response;
      try {
        res = await fetch(`${api()}/ciphertexts`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            pool,
            player,
            ciphertext: toB64(ciphertext),
            signature: toB64(signature),
          }),
        });
      } catch (error) {
        // Nothing answered: this one really IS a connection problem.
        throw new EntryServiceError('ciphertext', null, `ciphertext store unreachable: ${String(error)}`);
      }
      if (!res.ok) {
        throw new EntryServiceError('ciphertext', res.status, `ciphertext store: ${res.status}`);
      }
    },

    async requestPacket(pool, player): Promise<IssuedPacketBytes> {
      let res: Response;
      try {
        res = await fetch(`${api()}/packet`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ wallet: player, pool }),
        });
      } catch (error) {
        throw new EntryServiceError('packet', null, `packet service unreachable: ${String(error)}`);
      }
      if (!res.ok) {
        // The service's ONE generic rejection — no reason to relay, none
        // given. The STATUS still says whether it decided (403) or fell
        // over (5xx), which is the difference between "no" and "not now".
        throw new EntryServiceError('packet', res.status, 'entry unavailable');
      }
      const body = (await res.json()) as {
        ok: boolean;
        message?: string;
        signature?: string;
        publicKey?: string;
      };
      if (!body.ok || !body.message || !body.signature || !body.publicKey) {
        // A 200 that carries no packet is a refusal in the body.
        throw new EntryServiceError('packet', res.status, 'entry unavailable');
      }
      return {
        message: fromB64(body.message),
        signature: fromB64(body.signature),
        publicKey: fromB64(body.publicKey),
      };
    },

    async sendRegister(_pool, battlesHash, packet) {
      if (!cfg.programId) {
        throw new Error('program not configured (NEXT_PUBLIC_PROGRAM_ID)');
      }
      const pdas = await deriveRegisterPdas(cfg.programId, cfg.poolId, cfg.signer.address);
      // Pre-flight existence check only: since D-A1 revised the treasury is
      // a PDA derived client-side, so nothing is read out of Config here.
      const configData = await cfg.rpc.getAccountData(pdas.config);
      if (!configData) throw new Error('config account not found on this cluster');

      // The fresh pass asset: Core's CreateV2 requires the new asset
      // account's signature, so it partial-signs locally AFTER the wallet
      // (the load-bearing order documented in execute.ts).
      const passAssetKeyPair = await generateKeyPair();
      const passAsset = await getAddressFromPublicKey(passAssetKeyPair.publicKey);

      const instructions = [
        buildEd25519Instruction(packet),
        buildRegisterInstruction({
          programId: cfg.programId,
          poolId: cfg.poolId,
          player: cfg.signer.address,
          passAsset,
          battlesHash,
          pdas,
        }),
      ];

      const result = await executeTrade({
        rpc: cfg.rpc,
        signer: cfg.signer,
        instructions,
        localPartialSigners: [passAssetKeyPair],
        onEvent: cfg.onEvent ?? (() => {}),
      });
      if (result.outcome === 'failed' || !result.signature) {
        throw new RegisterFailedError(
          result.failure ?? {
            kind: 'rpc-failure',
            message: 'the transaction did not confirm',
            detail: 'executeTrade returned no failure detail',
            broadcast: false,
            retryable: true,
          },
          result.signature
        );
      }
      return result.signature;
    },

    randomBytes(n) {
      const out = new Uint8Array(n);
      crypto.getRandomValues(out);
      return out;
    },

    async deviceHash(pool) {
      // C11: derived per pool from a per-browser secret that never leaves
      // this device (device.ts documents both why it is not the Privy
      // fingerprint R19 assumed — the SDK has none — and why the value sent
      // is a derivation rather than the secret itself, audit B-40).
      return deviceMarker(pool);
    },
  };
}
