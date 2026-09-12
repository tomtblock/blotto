/**
 * The published-key store contract, driven against BOTH implementations
 * (audit 2026-09-11, B-29).
 *
 * THE DEFECT. `TurnkeyCustody.createPoolKey` checks `load()` and then acts,
 * so two concurrent opens of one pool both pass the check, both mint a
 * keypair, both import it to the enclave, and both call `save`. The two
 * stores then disagreed, and both answers were unsafe:
 *
 *   - Postgres had `ON CONFLICT (pool_id) DO NOTHING`, so the second write
 *     was discarded while its caller was told it had succeeded;
 *   - the in-memory twin overwrote, so the FIRST caller's record was
 *     discarded while its caller was told it had succeeded.
 *
 * Either way one caller walks away holding a secret hash the store does not
 * have. That caller opens the pool on chain committing that hash, players
 * seal their allocations to it, and custody can only ever export the other
 * key. The pool cannot be revealed, cannot be scored, and cannot satisfy the
 * commitment it made on chain — with entry money already in the vault.
 *
 * So the contract is: first write wins, an identical re-save is a no-op (a
 * retry after a transient failure has to be able to finish), and a
 * conflicting write THROWS so the loser learns it lost before it commits
 * anything. Both twins are held to it here, in one table, because a test
 * double that behaves differently from the deployed store proves nothing.
 */
import { expect } from 'chai';
import {
  MemoryPublishedKeyStore,
  PgPublishedKeyStore,
  PublishedKeyConflictError,
  samePublishedKey,
  type PublishedKeyStore,
  type StoredPublishedKey,
} from '../src';
import type { Queryable } from '../src/shared';

const FIRST: StoredPublishedKey = {
  publicKeyHex: 'aa'.repeat(32),
  secretHashHex: '11'.repeat(32),
  privateKeyId: 'turnkey-key-1',
};
/** A different key for the same pool: what the losing concurrent open holds. */
const SECOND: StoredPublishedKey = {
  publicKeyHex: 'bb'.repeat(32),
  secretHashHex: '22'.repeat(32),
  privateKeyId: 'turnkey-key-2',
};

/**
 * A `Queryable` over one table that models the two statements this store
 * issues, including `ON CONFLICT DO NOTHING ... RETURNING`'s defining
 * property: one row back when THIS statement inserted, zero when it did not.
 * Anything else it is asked runs into an explicit failure rather than a
 * silent empty result, so a changed statement fails loudly here.
 */
function fakePg(): Queryable & { rows: Map<string, StoredPublishedKey> } {
  const rows = new Map<string, StoredPublishedKey>();
  return {
    rows,
    async query(text: string, params?: readonly unknown[]) {
      const p = (params ?? []) as string[];
      if (/^\s*INSERT INTO published_pool_keys/.test(text)) {
        if (!/ON CONFLICT \(pool_id\) DO NOTHING/.test(text) || !/RETURNING pool_id/.test(text)) {
          throw new Error(`unexpected insert statement: ${text}`);
        }
        if (rows.has(p[0])) return { rows: [] } as never;
        rows.set(p[0], { publicKeyHex: p[1], secretHashHex: p[2], privateKeyId: p[3] });
        return { rows: [{ pool_id: p[0] }] } as never;
      }
      if (/^\s*SELECT public_key_hex/.test(text)) {
        const r = rows.get(p[0]);
        return {
          rows: r
            ? [
                {
                  public_key_hex: r.publicKeyHex,
                  secret_hash_hex: r.secretHashHex,
                  private_key_id: r.privateKeyId,
                },
              ]
            : [],
        } as never;
      }
      throw new Error(`unexpected statement: ${text}`);
    },
  };
}

const IMPLEMENTATIONS: Array<[string, () => PublishedKeyStore]> = [
  ['MemoryPublishedKeyStore', () => new MemoryPublishedKeyStore()],
  ['PgPublishedKeyStore', () => new PgPublishedKeyStore(fakePg())],
];

for (const [name, make] of IMPLEMENTATIONS) {
  describe(`${name}: first write wins, a conflicting one is refused (B-29)`, () => {
    it('stores the first key', async () => {
      const store = make();
      await store.save(7n, FIRST);
      expect(await store.load(7n)).to.deep.equal(FIRST);
    });

    it('refuses a DIFFERENT key for a pool that already has one', async () => {
      const store = make();
      await store.save(7n, FIRST);

      let thrown: unknown = null;
      try {
        await store.save(7n, SECOND);
      } catch (e) {
        thrown = e;
      }
      expect(thrown, 'the losing writer must be told, not told nothing').to.be.instanceOf(
        PublishedKeyConflictError
      );
      const err = thrown as PublishedKeyConflictError;
      expect(err.poolId).to.equal(7n);
      expect(err.stored).to.deep.equal(FIRST);
      expect(err.offered).to.deep.equal(SECOND);
      // Both hashes are named, because an operator reading this line has to
      // work out which key the chain was committed to.
      expect(err.message).to.contain(FIRST.secretHashHex);
      expect(err.message).to.contain(SECOND.secretHashHex);
    });

    it('leaves the stored key untouched after a refusal', async () => {
      const store = make();
      await store.save(7n, FIRST);
      await store.save(7n, SECOND).catch(() => undefined);
      expect(
        await store.load(7n),
        'the winner keeps the pool; a refusal must not half-apply'
      ).to.deep.equal(FIRST);
    });

    it('accepts an identical re-save, because a retry has to be able to finish', async () => {
      const store = make();
      await store.save(7n, FIRST);
      await store.save(7n, { ...FIRST });
      expect(await store.load(7n)).to.deep.equal(FIRST);
    });

    it('keys are per pool: a second pool is not a conflict', async () => {
      const store = make();
      await store.save(7n, FIRST);
      await store.save(8n, SECOND);
      expect(await store.load(7n)).to.deep.equal(FIRST);
      expect(await store.load(8n)).to.deep.equal(SECOND);
    });

    it('an absent pool loads as null', async () => {
      expect(await make().load(9n)).to.equal(null);
    });
  });
}

describe('PgPublishedKeyStore: a conflict with no readable row is refused, not assumed (B-29)', () => {
  it('throws rather than reporting an unstored key as published', async () => {
    // The insert conflicts but the row cannot be read back. Nothing deletes
    // from this table, so this is not a concurrency outcome — it means the
    // service is talking to something other than the table it thinks it is.
    // Reporting success here is the one answer that loses money.
    const db: Queryable = {
      async query(text: string) {
        if (/^\s*INSERT INTO published_pool_keys/.test(text)) return { rows: [] } as never;
        return { rows: [] } as never;
      },
    };
    let thrown: unknown = null;
    try {
      await new PgPublishedKeyStore(db).save(7n, FIRST);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).to.be.instanceOf(Error);
    expect((thrown as Error).message).to.contain('no row could be read back');
  });
});

describe('samePublishedKey compares the whole record', () => {
  it('is true only for an identical record', () => {
    expect(samePublishedKey(FIRST, { ...FIRST })).to.equal(true);
    expect(samePublishedKey(FIRST, { ...FIRST, publicKeyHex: 'cc'.repeat(32) })).to.equal(false);
    expect(samePublishedKey(FIRST, { ...FIRST, secretHashHex: 'cc'.repeat(32) })).to.equal(false);
    expect(samePublishedKey(FIRST, { ...FIRST, privateKeyId: 'other' })).to.equal(false);
  });
});
