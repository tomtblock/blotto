/**
 * The entry-signer SELECTOR (not the signers themselves — those have their
 * own suites). These cases exist because of a live devnet incident on
 * 2026-08-29: the packet service ran on the development seed for hours while
 * everyone believed it was on Turnkey, because `ENTRY_SIGNER_KEY_ID` was not
 * in effect on the running machine and its absence silently selected the dev
 * path. Nothing looked wrong: the service booted, answered /health, and
 * issued packets whose signatures verified against the public key it
 * reported — a seed-backed signer is entirely self-consistent.
 *
 * The first test below is that incident, and it must fail closed.
 */

import { strict as assert } from 'assert';
import { buildSigner } from '../src/signer-select';
import { issuePacket } from '../src/service';
import { loadTerritorySchedule } from '../src/territories';
import { DEFAULT_WALLET_BLOCKLIST } from '../src/blocked-wallets';
import { resolve } from 'path';

const TERRITORIES = loadTerritorySchedule(
  resolve(__dirname, '..', '..', '..', 'config', 'territories.json')
);

const TURNKEY_ENV = {
  TURNKEY_API_BASE_URL: 'https://api.turnkey.com',
  TURNKEY_API_PUBLIC_KEY: 'pub',
  TURNKEY_API_PRIVATE_KEY: 'priv',
  TURNKEY_ORGANIZATION_ID: 'org',
  ENTRY_SIGNER_PUBLIC_KEY_HEX: '00'.repeat(32),
};
const SEED = { ENTRY_SIGNER_SEED_HEX: 'ab'.repeat(32) };

describe('entry-signer selection', () => {
  it('REGRESSION: a seed beside Turnkey credentials but NO key id refuses to start', () => {
    // Exactly the devnet incident: every Turnkey variable staged except the
    // selector, with the CI-generated seed still present.
    assert.throws(
      () => buildSigner({ ...TURNKEY_ENV, ...SEED } as NodeJS.ProcessEnv),
      /ENTRY_SIGNER_KEY_ID is not|ALLOW_DEV_ENTRY_SIGNER/,
      'a missing key id must fail closed, never fall back to the development seed'
    );
  });

  it('the dev seed alone refuses without the explicit opt-in', () => {
    assert.throws(
      () => buildSigner({ ...SEED } as NodeJS.ProcessEnv),
      /ALLOW_DEV_ENTRY_SIGNER/
    );
  });

  it('the dev seed is used only with ALLOW_DEV_ENTRY_SIGNER=1', () => {
    const signer = buildSigner({
      ...SEED,
      ALLOW_DEV_ENTRY_SIGNER: '1',
    } as NodeJS.ProcessEnv);
    assert.ok(signer, 'the deliberate development posture still works');
  });

  it('any value other than "1" is not an opt-in', () => {
    for (const v of ['true', 'yes', '0', '', 'TRUE']) {
      assert.throws(
        () => buildSigner({ ...SEED, ALLOW_DEV_ENTRY_SIGNER: v } as NodeJS.ProcessEnv),
        /ALLOW_DEV_ENTRY_SIGNER/,
        `"${v}" must not be read as an opt-in`
      );
    }
  });

  it('a key id with an incomplete Turnkey set still refuses, naming the variable', () => {
    for (const missing of Object.keys(TURNKEY_ENV)) {
      const env = { ...TURNKEY_ENV, ENTRY_SIGNER_KEY_ID: 'key-id' } as Record<string, string>;
      delete env[missing];
      // A predicate rather than a dynamically constructed pattern: the
      // pattern constructor's own name trips the §8.7 language gate, and the
      // gate is not to be widened to accommodate a test helper.
      assert.throws(
        () => buildSigner(env as NodeJS.ProcessEnv),
        (e: unknown) => e instanceof Error && e.message.includes(missing),
        `omitting ${missing} must fail closed and name it`
      );
    }
  });

  it('no signer configured at all refuses', () => {
    assert.throws(() => buildSigner({} as NodeJS.ProcessEnv), /no entry signer configured/);
  });
});

/**
 * The rejection is uniform to the CALLER and specific to the OPERATOR.
 *
 * On 2026-08-31 the packet service refused every entry with the generic
 * answer while the Turnkey signer threw on every call. Geo, territory,
 * attestation and sanctions all passed; only signing failed — and nothing,
 * client-side or in the logs, said so. A live signer fault was
 * indistinguishable from a correctly refused entry.
 */
describe('a failed issuance is generic to the caller, diagnosable by the operator', () => {
  it('logs the underlying reason and still answers generically', async () => {
    const errors: string[] = [];
    const spy = console.error;
    console.error = (m?: unknown) => void errors.push(String(m));
    try {
      const res = await issuePacket(
        {
          geo: { lookup: async () => ({ country: 'GB', vpnOrProxy: false }) },
          sanctions: { isSanctioned: async () => false },
          attestations: {
            get: async () => ({
              wallet: 'w',
              termsVersion: 1,
              attested18: true as const,
              timestamp: 0n,
              walletSignature: 's',
            }),
            put: async () => undefined,
          },
          config: { blockedWallets: DEFAULT_WALLET_BLOCKLIST, territories: TERRITORIES, termsVersion: 1, termsUpdated: '2026-09-06', kycTier: 0 },
          now: () => 0n,
          nonce: () => 0n,
          signer: {
            publicKey: async () => new Uint8Array(32),
            // The live failure: Turnkey rejects the signing request.
            sign: async () => {
              throw new Error('turnkey returned r=0/s=0 bytes, expected 32/32');
            },
          },
        } as never,
        { wallet: '11111111111111111111111111111111', pool: '11111111111111111111111111111111', ip: '1.2.3.4' }
      );
      assert.deepEqual(res, { ok: false, error: 'entry_unavailable' }, 'caller sees only the generic answer');
      assert.ok(
        errors.some((m) => m.includes('turnkey returned')),
        'the operator sees the real reason in the log'
      );
    } finally {
      console.error = spy;
    }
  });
});
