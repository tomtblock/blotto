/** Notify opt-in store specs (v3 D3): signature-verified, skew-bounded,
 * monotonic — a captured older message can never overwrite a newer choice. */
import { expect } from 'chai';
import nacl from 'tweetnacl';

import {
  MemoryNotifyPreferenceStore,
  NOTIFY_MAX_SKEW_SECONDS,
  acceptNotifyPreference,
  notifyMessage,
} from '../src/notify';
import { base58Encode } from '../src/shared';

const kp = nacl.sign.keyPair();
const WALLET = base58Encode(kp.publicKey);
const NOW = 1_756_339_200n;

function signed(emailOptIn: boolean, atUnix: bigint, key = kp.secretKey) {
  const sig = nacl.sign.detached(notifyMessage(WALLET, emailOptIn, atUnix), key);
  return {
    wallet: WALLET,
    emailOptIn,
    atUnix,
    signature: Buffer.from(sig).toString('base64'),
  };
}

describe('notify opt-in', () => {
  it('stores a verified choice and serves it back', async () => {
    const store = new MemoryNotifyPreferenceStore();
    expect(await acceptNotifyPreference(store, () => NOW, signed(true, NOW))).to.equal(true);
    const rec = await store.get(WALLET);
    expect(rec?.emailOptIn).to.equal(true);
    expect(rec?.timestamp).to.equal(NOW);
  });

  it('rejects a bad signature and a foreign key', async () => {
    const store = new MemoryNotifyPreferenceStore();
    const other = nacl.sign.keyPair();
    expect(
      await acceptNotifyPreference(store, () => NOW, signed(true, NOW, other.secretKey))
    ).to.equal(false);
    const tampered = { ...signed(true, NOW), emailOptIn: false };
    expect(await acceptNotifyPreference(store, () => NOW, tampered)).to.equal(false);
    expect(await store.get(WALLET)).to.equal(null);
  });

  it('rejects a message outside the skew window', async () => {
    const store = new MemoryNotifyPreferenceStore();
    const stale = NOW - NOTIFY_MAX_SKEW_SECONDS - 1n;
    expect(await acceptNotifyPreference(store, () => NOW, signed(true, stale))).to.equal(false);
  });

  it('never lets an older captured message overwrite a newer choice', async () => {
    const store = new MemoryNotifyPreferenceStore();
    const optOutEarlier = signed(false, NOW - 60n);
    expect(await acceptNotifyPreference(store, () => NOW, signed(true, NOW))).to.equal(true);
    expect(await acceptNotifyPreference(store, () => NOW, optOutEarlier)).to.equal(false);
    expect((await store.get(WALLET))?.emailOptIn).to.equal(true);
  });
});
