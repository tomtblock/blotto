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

export function makeLiveEntryServices(cfg: LiveEntryServicesConfig): EntryServices {
  const api = (): string => {
    if (!cfg.apiBase) throw new Error('entry service not configured (NEXT_PUBLIC_ENTRY_API_URL)');
    return cfg.apiBase;
  };

  return {
    async putCiphertext(pool, player, ciphertext) {
      const res = await fetch(`${api()}/ciphertexts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pool, player, ciphertext: toB64(ciphertext) }),
      });
      if (!res.ok) throw new Error(`ciphertext store: ${res.status}`);
    },

    async requestPacket(pool, player): Promise<IssuedPacketBytes> {
      const res = await fetch(`${api()}/packet`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet: player, pool }),
      });
      if (!res.ok) {
        // The service's ONE generic rejection — no reason to relay, none given.
        throw new Error('entry unavailable');
      }
      const body = (await res.json()) as {
        ok: boolean;
        message?: string;
        signature?: string;
        publicKey?: string;
      };
      if (!body.ok || !body.message || !body.signature || !body.publicKey) {
        throw new Error('entry unavailable');
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

    async deviceHash() {
      // C11: the persisted per-browser marker (device.ts documents why it
      // is not the Privy fingerprint R19 assumed — the SDK has none).
      return deviceMarker();
    },
  };
}
