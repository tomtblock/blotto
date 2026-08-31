/**
 * The entry-signer SELECTOR, in its own module so it can be unit-tested.
 *
 * It lived in `main.ts` until 2026-08-29, where nothing could reach it: that
 * file imports the Postgres pool and the sealing store, so a test of the
 * selector would have needed every sibling package installed. The one branch
 * that mattered therefore had no test, and it is the branch that failed on
 * devnet — a missing ENTRY_SIGNER_KEY_ID silently selecting the development
 * seed while everyone believed the service was on Turnkey.
 *
 * This module imports only the two signers. `test/signer-selection.spec.ts`
 * pins every path.
 */

import { LocalPacketSigner, type PacketSigner } from './packet';
import { TurnkeyPacketSigner } from './signer-turnkey';

const SERVICE = 'packet';

/** First 6 and last 4 characters of an identifier, for startup lines. Never
 * used on a secret — only on ids and public keys, which are public by
 * definition — but truncated anyway so a pasted log stays boring. */
export function redact(v: string | undefined): string {
  if (!v) return '<unset>';
  return v.length <= 12 ? v : `${v.slice(0, 6)}…${v.slice(-4)}`;
}

export function buildSigner(env: NodeJS.ProcessEnv): PacketSigner {
  if (env.ENTRY_SIGNER_KEY_ID) {
    for (const k of [
      'TURNKEY_API_BASE_URL',
      'TURNKEY_API_PUBLIC_KEY',
      'TURNKEY_API_PRIVATE_KEY',
      'TURNKEY_ORGANIZATION_ID',
      'ENTRY_SIGNER_PUBLIC_KEY_HEX',
    ]) {
      if (!env[k]) throw new Error(`${SERVICE}: ${k} is required with ENTRY_SIGNER_KEY_ID`);
    }
    // Lazy vendor import — offline suites never load the SDK (C11 pattern).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Turnkey } = require('@turnkey/sdk-server') as typeof import('@turnkey/sdk-server');
    const client = new Turnkey({
      apiBaseUrl: env.TURNKEY_API_BASE_URL as string,
      apiPublicKey: env.TURNKEY_API_PUBLIC_KEY as string,
      apiPrivateKey: env.TURNKEY_API_PRIVATE_KEY as string,
      defaultOrganizationId: env.TURNKEY_ORGANIZATION_ID as string,
    }).apiClient();
    // Say WHICH path was chosen. A clean boot proves the credentials were
    // present, not which signer is live, and the two are indistinguishable
    // from outside the process — the packet's public key is config either
    // way. Naming it here is the only cheap way an operator can tell a
    // Turnkey deployment from one that silently fell back to the dev seed.
    console.log(
      `${SERVICE}: entry signer = TURNKEY (key ${redact(env.ENTRY_SIGNER_KEY_ID)}, ` +
        `org ${redact(env.TURNKEY_ORGANIZATION_ID)}, ` +
        `pubkey ${redact(env.ENTRY_SIGNER_PUBLIC_KEY_HEX)})`
    );
    return new TurnkeyPacketSigner({
      client,
      organizationId: env.TURNKEY_ORGANIZATION_ID as string,
      signWith: env.ENTRY_SIGNER_KEY_ID,
      publicKeyHex: env.ENTRY_SIGNER_PUBLIC_KEY_HEX as string,
    });
  }
  if (env.ENTRY_SIGNER_SEED_HEX) {
    // The dev seed requires a DELIBERATE opt-in, because absence of Turnkey
    // configuration must never silently mean "use the development key".
    //
    // Devnet, 2026-08-29: the packet service ran on the dev seed for hours
    // while everyone believed it was on Turnkey. Ten secrets had been staged
    // by hand, but ENTRY_SIGNER_KEY_ID was not in effect on the running
    // machine — and this branch is reached whenever that ONE variable is
    // absent, whatever else is set. The service booted clean, answered
    // /health, and issued packets whose signatures verified against the
    // public key it reported, because a seed-backed signer is perfectly
    // self-consistent. Nothing about it looked wrong from outside.
    //
    // The five-variable check above only fires once ENTRY_SIGNER_KEY_ID is
    // present, so it could not catch a missing selector. This is the guard
    // for that case: with it, the same deploy refuses to start and names the
    // missing variable instead of quietly downgrading.
    if (env.ALLOW_DEV_ENTRY_SIGNER !== '1') {
      throw new Error(
        `${SERVICE}: ENTRY_SIGNER_SEED_HEX is set but ENTRY_SIGNER_KEY_ID is not, so the ` +
          `DEVELOPMENT signer would be used. If that is intended, set ` +
          `ALLOW_DEV_ENTRY_SIGNER=1. If Turnkey was intended, ENTRY_SIGNER_KEY_ID is ` +
          `missing from this process's environment — check it is set on the app AND ` +
          `that the machine restarted to pick it up.`
      );
    }
    console.warn(
      `${SERVICE}: entry signer = LOCAL DEV SEED (ENTRY_SIGNER_SEED_HEX, ` +
        `ALLOW_DEV_ENTRY_SIGNER=1) — NOT Turnkey. Development only.`
    );
    return new LocalPacketSigner(new Uint8Array(Buffer.from(env.ENTRY_SIGNER_SEED_HEX, 'hex')));
  }
  throw new Error(
    `${SERVICE}: no entry signer configured — set the Turnkey variables, or ` +
      `ENTRY_SIGNER_SEED_HEX with ALLOW_DEV_ENTRY_SIGNER=1 (dev)`
  );
}
