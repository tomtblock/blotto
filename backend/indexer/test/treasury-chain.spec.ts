/**
 * The chain read behind GET /treasury and GET /pool-types (D-E19): every
 * `PoolType` account, enumerated with `getProgramAccounts` filtered to the
 * account's size, decoded by the shared layout module, and believed only as
 * a WHOLE list — a reserve computed over fewer enabled types than Config
 * counts would publish a floor below the one the program enforces.
 */
import { expect } from 'chai';
import { PublicKey } from '@solana/web3.js';
import { CONFIG_OFFSETS, CONFIG_SPACE, CONFIG_SPACE_V3 } from '../../_shared/src/config-account';
import { POOL_TYPE_OFFSETS, POOL_TYPE_SPACE } from '../../_shared/src/pool-type-account';
import { LADDER_TABLES, MIN_FIELD_BY_CAPACITY, TIER_ENTRY_LAMPORTS, prizePoolFor } from '../../scoring/src/prizes';
import {
  POOL_TYPE_DISCRIMINATOR,
  poolAddress,
  readTreasuryChainView,
  type ChainConnection,
} from '../src/treasury-chain';

const PROGRAM_ID = new PublicKey('5aawXayPYgEqrnHi6pGiYRpuHNuwauj8GqftRjkeXH17');
const CUSHION = 890_880;

/** A PoolType account's bytes, at the launch economics of its size and tier. */
function poolTypeBytes(t: {
  mode: number;
  tier: number;
  capacity: 8 | 16 | 32 | 64;
  enabled: boolean;
  activePool?: bigint;
  nextOpenAt?: bigint;
  discriminator?: Uint8Array;
}): Uint8Array {
  const d = new Uint8Array(POOL_TYPE_SPACE);
  const dv = new DataView(d.buffer);
  d.set(t.discriminator ?? POOL_TYPE_DISCRIMINATOR, 0);
  const O = POOL_TYPE_OFFSETS;
  const table = LADDER_TABLES[t.capacity];
  d[O.mode] = t.mode;
  d[O.tier] = t.tier;
  dv.setUint16(O.capacity, t.capacity, true);
  dv.setUint16(O.minSeats, MIN_FIELD_BY_CAPACITY[t.capacity], true);
  d[O.paidPlaces] = table.length;
  d.set(table, O.prizeTable);
  dv.setBigUint64(O.potLamports, prizePoolFor(table, TIER_ENTRY_LAMPORTS[t.tier]), true);
  d[O.enabled] = t.enabled ? 1 : 0;
  dv.setBigUint64(O.activePool, t.activePool ?? 0n, true);
  dv.setBigInt64(O.nextOpenAt, t.nextOpenAt ?? 0n, true);
  d[O.bump] = 254;
  return d;
}

function configBytes(enabledPoolTypes: number, size = CONFIG_SPACE): Uint8Array {
  const d = new Uint8Array(size);
  d[CONFIG_OFFSETS.openTiers] = 1;
  if (size === CONFIG_SPACE) new DataView(d.buffer).setUint16(CONFIG_OFFSETS.enabledPoolTypes, enabledPoolTypes, true);
  return d;
}

const key = (n: number): PublicKey => new PublicKey(new Uint8Array(32).fill(n));

function connection(config: Uint8Array, accounts: Array<{ pubkey: PublicKey; data: Uint8Array }>) {
  const asked: Array<{ programId: string; filters: unknown }> = [];
  const conn: ChainConnection = {
    async getAccountInfo(address) {
      const configPda = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID)[0];
      if (address.equals(configPda)) return { data: config, lamports: 1 };
      return { data: new Uint8Array(0), lamports: 6_300_000_000 };
    },
    async getMinimumBalanceForRentExemption() {
      return CUSHION;
    },
    async getProgramAccounts(programId, cfg) {
      asked.push({ programId: programId.toBase58(), filters: cfg.filters });
      return accounts.map((a) => ({ pubkey: a.pubkey, account: { data: a.data } }));
    },
  };
  return { conn, asked };
}

describe('the chain read: every PoolType account (D-E19)', () => {
  it('the discriminator is sha256("account:PoolType")[..8]', () => {
    expect(Buffer.from(POOL_TYPE_DISCRIMINATOR).toString('hex')).to.equal('23bee6af4b720965');
  });

  it('enumerates by size, decodes each type, and names its live pool by address', async () => {
    const { conn, asked } = connection(configBytes(2), [
      { pubkey: key(1), data: poolTypeBytes({ mode: 0, tier: 0, capacity: 8, enabled: true }) },
      {
        pubkey: key(2),
        data: poolTypeBytes({ mode: 0, tier: 0, capacity: 64, enabled: true, activePool: 12n, nextOpenAt: 1_790_000_000n }),
      },
      { pubkey: key(3), data: poolTypeBytes({ mode: 1, tier: 0, capacity: 16, enabled: false }) },
    ]);
    const view = await readTreasuryChainView(conn, PROGRAM_ID);

    expect(asked).to.deep.equal([{ programId: PROGRAM_ID.toBase58(), filters: [{ dataSize: 57 }] }]);
    expect(view.ladderPresent).to.equal(true);
    expect(view.enabledPoolTypes).to.equal(2);
    expect(view.poolTypes).to.have.length(3);
    const t64 = view.poolTypes.find((t) => t.capacity === 64)!;
    expect(t64).to.include({ mode: 0, tier: 0, minSeats: 40, paidPlaces: 16, enabled: true });
    expect(t64.potLamports).to.equal(4_000_000_000n);
    expect(t64.activePool).to.equal(12n);
    expect(t64.nextOpenAt).to.equal(1_790_000_000n);
    expect(t64.address).to.equal(key(2).toBase58());
    expect(t64.activePoolAddress).to.equal(poolAddress(12n, PROGRAM_ID));
    // ["pool", id u64 LE] — the same derivation the program's seeds use.
    const le = Buffer.alloc(8);
    le.writeBigUInt64LE(12n);
    expect(t64.activePoolAddress).to.equal(
      PublicKey.findProgramAddressSync([Buffer.from('pool'), le], PROGRAM_ID)[0].toBase58()
    );
    expect(view.poolTypes.find((t) => t.capacity === 8)!.activePoolAddress).to.equal(null);
  });

  it('skips a 57-byte account that is not a PoolType', async () => {
    const { conn } = connection(configBytes(1), [
      { pubkey: key(1), data: poolTypeBytes({ mode: 0, tier: 0, capacity: 8, enabled: true }) },
      {
        pubkey: key(9),
        data: poolTypeBytes({ mode: 0, tier: 0, capacity: 32, enabled: true, discriminator: new Uint8Array(8).fill(7) }),
      },
    ]);
    const view = await readTreasuryChainView(conn, PROGRAM_ID);
    expect(view.poolTypes.map((t) => t.capacity)).to.deep.equal([8]);
  });

  it('refuses a list whose enabled types do not number what Config counts', async () => {
    // Config says three are enabled; the read found two. A reserve over the
    // two would understate the floor, so the read fails and the report falls
    // back to the ledger, labelled.
    const { conn } = connection(configBytes(3), [
      { pubkey: key(1), data: poolTypeBytes({ mode: 0, tier: 0, capacity: 8, enabled: true }) },
      { pubkey: key(2), data: poolTypeBytes({ mode: 0, tier: 0, capacity: 64, enabled: true }) },
    ]);
    let error: Error | null = null;
    try {
      await readTreasuryChainView(conn, PROGRAM_ID);
    } catch (e) {
      error = e as Error;
    }
    expect(error?.message).to.match(/read 2 enabled pool types but Config counts 3/);
  });

  it('reads a pre-Ladder Config (603 bytes) with whatever pool types exist, and no count to check', async () => {
    const { conn } = connection(configBytes(0, CONFIG_SPACE_V3), []);
    const view = await readTreasuryChainView(conn, PROGRAM_ID);
    expect(view.ladderPresent).to.equal(false);
    expect(view.enabledPoolTypes).to.equal(0);
    expect(view.poolTypes).to.deep.equal([]);
  });
});
