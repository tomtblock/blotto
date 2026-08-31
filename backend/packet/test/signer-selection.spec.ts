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
