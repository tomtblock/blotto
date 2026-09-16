import { describe, expect, it, vi } from 'vitest';
import type { TxSigner } from '@/tx/types';
import { observeSigner, type SignerEvent } from './observed-signer';

/* A class-based adapter: its methods live on the prototype, which is the
 * shape a spread would have silently broken. */
class ProtoSigner implements TxSigner {
  address = 'Wa11et111111111111111111111111111111111111';
  kind = 'external' as const;
  label = 'Phantom';
  calls: string[] = [];
  async signTransaction(tx: Uint8Array): Promise<Uint8Array> {
    this.calls.push(`tx:${tx.length}`);
    return new Uint8Array([...tx, 9]);
  }
  async signMessage(m: Uint8Array): Promise<Uint8Array> {
    this.calls.push(`msg:${m.length}`);
    return new Uint8Array([7, 7]);
  }
}

describe('observeSigner', () => {
  it('delegates by method call and reports after each signature resolves', async () => {
    const inner = new ProtoSigner();
    const events: SignerEvent[] = [];
    const observed = observeSigner(inner, (e) => events.push(e));

    expect(observed.address).toBe(inner.address);
    expect(observed.kind).toBe('external');
    expect(observed.label).toBe('Phantom');

    const sig = await observed.signMessage!(new Uint8Array(3));
    expect(sig).toEqual(new Uint8Array([7, 7]));
    expect(events).toEqual(['message-signed']);

    const tx = await observed.signTransaction(new Uint8Array([1, 2]));
    expect(tx).toEqual(new Uint8Array([1, 2, 9]));
    expect(events).toEqual(['message-signed', 'transaction-signed']);
    // `this` was the original adapter both times.
    expect(inner.calls).toEqual(['msg:3', 'tx:2']);
  });

  it('keeps signMessage absent when the source has none (fails closed, as before)', () => {
    const inner: TxSigner = {
      address: 'A',
      kind: 'embedded',
      label: 'Privy',
      signTransaction: vi.fn(async (tx: Uint8Array) => tx),
    };
    const observed = observeSigner(inner, () => {});
    expect(observed.signMessage).toBeUndefined();
    expect('signMessage' in observed).toBe(false);
  });

  it('passes a rejection through untouched and reports nothing for it', async () => {
    const inner: TxSigner = {
      address: 'A',
      kind: 'external',
      label: 'Test',
      signTransaction: async () => {
        throw new Error('user rejected');
      },
      signMessage: async () => {
        throw new Error('closed the prompt');
      },
    };
    const events: SignerEvent[] = [];
    const observed = observeSigner(inner, (e) => events.push(e));
    await expect(observed.signMessage!(new Uint8Array())).rejects.toThrow('closed the prompt');
    await expect(observed.signTransaction(new Uint8Array())).rejects.toThrow('user rejected');
    expect(events).toEqual([]);
  });
});
