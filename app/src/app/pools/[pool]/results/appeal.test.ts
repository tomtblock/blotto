/* Stage E appeal client specs: message parity with the review service and
 * a named outcome for every way lodging can end. */
import { describe, expect, it } from 'vitest';
import nacl from 'tweetnacl';
import { verifyAppealSubmission } from '@blotto/detection/appeals';
import { canonicalAppealMessage } from '@blotto/detection/appeal-message';
import { base58Encode } from '@blotto/shared/blotto-events';
import { fetchAppealPosition, lodgeAppeal } from './appeal';

const POOL = '5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17';
const PLAYER = '4ydbVZuNupTPu1cKGCc2cePs95B8iMkrR4TvsCLiwcL1';

describe('the appeal message', () => {
  it('what the app signs is what the review service verifies, and it names the wallet', () => {
    const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(8));
    const player = base58Encode(kp.publicKey);
    const signedAt = '2026-09-07T12:00:00.000Z';
    const a = { pool: POOL, player, grounds: 'shared device', signedAt };
    const signature = nacl.sign.detached(canonicalAppealMessage(a), kp.secretKey);
    const submission = { ...a, signature: Buffer.from(signature).toString('base64') };
    // Fresh against the service clock: accepted. Same bytes, other key: not.
    expect(verifyAppealSubmission(submission, Date.parse(signedAt))).toBe(true);
    expect(verifyAppealSubmission({ ...submission, player: PLAYER }, Date.parse(signedAt))).toBe(false);
    const text = new TextDecoder().decode(canonicalAppealMessage(a));
    expect(text.startsWith('Blotto Cup appeal\n')).toBe(true);
    expect(text).toContain(player);
  });
});

describe('lodgeAppeal (every ending named)', () => {
  const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(6));
  const signer = { signMessage: async (m: Uint8Array) => nacl.sign.detached(m, kp.secretKey) };
  const answering = (status: number, body: unknown = {}): typeof fetch =>
    (async () => ({ status, ok: status < 300, json: async () => body })) as never;

  it('lodged only on a 204', async () => {
    expect(await lodgeAppeal('https://r', signer, POOL, PLAYER, 'g', answering(204))).toBe('lodged');
  });
  it('names the service’s rule refusals', async () => {
    expect(await lodgeAppeal('https://r', signer, POOL, PLAYER, 'g', answering(409, { error: 'window_closed' }))).toBe('window_closed');
    expect(await lodgeAppeal('https://r', signer, POOL, PLAYER, 'g', answering(409, { error: 'already_lodged' }))).toBe('already_lodged');
    expect(await lodgeAppeal('https://r', signer, POOL, PLAYER, 'g', answering(409, { error: 'nothing_to_appeal' }))).toBe('nothing_to_appeal');
    expect(await lodgeAppeal('https://r', signer, POOL, PLAYER, 'g', answering(401))).toBe('refused');
    expect(await lodgeAppeal('https://r', signer, POOL, PLAYER, 'g', answering(500))).toBe('failed');
  });
  it('fails closed without a service, a signer, or consent', async () => {
    expect(await lodgeAppeal(undefined, signer, POOL, PLAYER, 'g', answering(204))).toBe('not_configured');
    expect(await lodgeAppeal('https://r', {}, POOL, PLAYER, 'g', answering(204))).toBe('cannot_sign');
    const declining = { signMessage: async () => { throw new Error('user declined'); } };
    expect(await lodgeAppeal('https://r', declining, POOL, PLAYER, 'g', answering(204))).toBe('declined');
  });
  it('the position read names every way it can fail, and never collapses one into another', async () => {
    // Absent service and unreachable service are DIFFERENT facts — the
    // panel says different things (audit 2026-09-11, C-04).
    expect(await fetchAppealPosition(undefined, POOL, PLAYER)).toEqual({ kind: 'not_configured' });
    expect(await fetchAppealPosition('https://r', POOL, PLAYER, answering(500))).toEqual({
      kind: 'unreachable',
      reason: 'status',
    });
    const offline: typeof fetch = (async () => {
      throw new Error('offline');
    }) as never;
    expect(await fetchAppealPosition('https://r', POOL, PLAYER, offline)).toEqual({
      kind: 'unreachable',
      reason: 'network',
    });
    const garbage: typeof fetch = (async () => ({
      status: 200,
      ok: true,
      json: async () => {
        throw new Error('not json');
      },
    })) as never;
    expect(await fetchAppealPosition('https://r', POOL, PLAYER, garbage)).toEqual({
      kind: 'unreachable',
      reason: 'malformed',
    });
    // A 200 with the wrong shape is not a position either.
    expect(await fetchAppealPosition('https://r', POOL, PLAYER, answering(200, { hello: 1 }))).toEqual({
      kind: 'unreachable',
      reason: 'malformed',
    });
    const pos = { forfeit: null, lodged: null, decided: null, lodgeUntil: null, decideBy: null };
    expect(await fetchAppealPosition('https://r', POOL, PLAYER, answering(200, pos))).toEqual({
      kind: 'position',
      position: pos,
    });
  });
});
