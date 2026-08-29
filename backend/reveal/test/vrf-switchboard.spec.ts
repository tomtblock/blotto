/**
 * Pins the Switchboard coordinator's lifecycle OFFLINE (the SDK sits behind
 * the `SwitchboardOps` seam): a fresh Randomness account per pool, the
 * reveal factory answering only for accounts this process created, bounded
 * retry around the reveal+commit transaction (the oracle answers a few slots
 * after the commit lands), and the pending map never leaking a handle —
 * success or failure.
 */
import { expect } from 'chai';
import { Keypair, TransactionInstruction, PublicKey } from '@solana/web3.js';
import {
  SwitchboardVrfCoordinator,
  type RandomnessHandle,
  type SwitchboardOps,
} from '../src/vrf-switchboard';

const NOOP_PROGRAM = Keypair.generate().publicKey;

function fakeHandle(pubkey: PublicKey): RandomnessHandle {
  return {
    pubkey,
    revealIx: async () =>
      new TransactionInstruction({ programId: NOOP_PROGRAM, keys: [], data: Buffer.alloc(0) }),
  };
}

function fakeOps(): SwitchboardOps & { created: PublicKey[] } {
  const created: PublicKey[] = [];
  return {
    created,
    async createAndCommit() {
      const pubkey = Keypair.generate().publicKey;
      created.push(pubkey);
      return fakeHandle(pubkey);
    },
  };
}

describe('SwitchboardVrfCoordinator', () => {
  it('creates a FRESH randomness account per pool and commits it on-chain', async () => {
    const ops = fakeOps();
    const commits: Array<{ poolId: bigint; account: string }> = [];
    const vrf = new SwitchboardVrfCoordinator({
      ops,
      commitOnChain: async (poolId, account) => {
        commits.push({ poolId, account });
      },
    });

    await vrf.commitSeed(1n);
    await vrf.commitSeed(2n);

    expect(ops.created).to.have.length(2);
    expect(ops.created[0].toBase58()).to.not.equal(ops.created[1].toBase58());
    expect(commits).to.deep.equal([
      { poolId: 1n, account: ops.created[0].toBase58() },
      { poolId: 2n, account: ops.created[1].toBase58() },
    ]);
  });

  it('reveal factory answers ONLY while the commit is in flight, and never for foreign accounts', async () => {
    const ops = fakeOps();
    let seenDuringCommit: TransactionInstruction | null = null;
    const vrf = new SwitchboardVrfCoordinator({
      ops,
      commitOnChain: async (_poolId, account) => {
        // This is when Web3Chain calls the hook — mid-commit.
        seenDuringCommit = await vrf.makeVrfRevealIx(new PublicKey(account));
      },
    });

    await vrf.commitSeed(7n);
    expect(seenDuringCommit).to.not.equal(null);

    // After the commit resolves the handle is gone (write-once on-chain;
    // nothing should be able to build a reveal for it again)...
    expect(await vrf.makeVrfRevealIx(ops.created[0])).to.equal(null);
    // ...and an account we never created (the stub's fixed account, say)
    // was never ours to reveal.
    expect(await vrf.makeVrfRevealIx(Keypair.generate().publicKey)).to.equal(null);
  });

  it('retries the commit while the oracle has not answered, then succeeds', async () => {
    const ops = fakeOps();
    let attempts = 0;
    const sleeps: number[] = [];
    const vrf = new SwitchboardVrfCoordinator({
      ops,
      commitOnChain: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('RandomnessNotResolved');
      },
      attempts: 5,
      delayMs: 10,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await vrf.commitSeed(3n);
    expect(attempts).to.equal(3);
    expect(sleeps).to.deep.equal([10, 10]);
    // One account for the whole retry loop — retrying must not mint new ones.
    expect(ops.created).to.have.length(1);
  });

  it('surfaces the last error after exhausting retries, and cleans up the handle', async () => {
    const ops = fakeOps();
    const vrf = new SwitchboardVrfCoordinator({
      ops,
      commitOnChain: async () => {
        throw new Error('RandomnessNotResolved');
      },
      attempts: 2,
      delayMs: 1,
      sleep: async () => {},
    });

    let thrown: unknown = null;
    try {
      await vrf.commitSeed(9n);
    } catch (err) {
      thrown = err;
    }
    expect((thrown as Error).message).to.equal('RandomnessNotResolved');
    // The abandoned account's handle must not leak — the next sweep starts clean.
    expect(await vrf.makeVrfRevealIx(ops.created[0])).to.equal(null);
  });
});
