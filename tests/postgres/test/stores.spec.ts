/**
 * The remaining Postgres-backed stores, against the real schema (audit
 * 2026-09-11, A-03 / A-04 / G-03).
 *
 * Each of these had an in-memory twin under test and a Postgres
 * implementation under none. The distance between the two is where the
 * defects were: a signed timestamp that survives a JavaScript Map and dies
 * in a `TIMESTAMPTZ` (A-04), a unique constraint that a hand-written double
 * models by assumption (B-29), a `bytea` round trip, a `jsonb` column that
 * comes back parsed when a `text` one would not, and a three-table join that
 * nothing had ever run against rows.
 *
 * The order below follows the money and the record: what a player sealed,
 * what custody published, what a reviewer signed, what screening refused,
 * what the entry gate attested.
 */
import { expect } from 'chai';
import nacl from 'tweetnacl';
import type { Pool } from 'pg';

import { base58Encode } from '../../../backend/_shared/src/blotto-events';
import { handleRead } from '../../../backend/indexer/src/read-api';
import {
  PgCiphertextStore,
  MemoryCiphertextStore,
} from '../../../backend/sealing/src/store';
import {
  PgPublishedKeyStore,
  PublishedKeyConflictError,
  type StoredPublishedKey,
} from '../../../backend/sealing/src';
import {
  PgDecisionLog,
  canonicalReviewMessage,
  verifyRow,
  type Decision,
  type ReviewerRegistry,
} from '../../../backend/detection/src';
import { PgDetectionReportStore } from '../../../backend/detection/src/reports-pg';
import { PgSanctionsRefusalLog } from '../../../backend/sanctions/src/refusal-log';
import {
  PgAttestationStore,
  PgNotifyPreferenceStore,
} from '../../../backend/packet/src/stores-pg';
import { CONFIGURED, truncate } from '../src/db';
import { sharedDatabase } from '../src/schema';

/** A deterministic 32-byte base58 key, distinct per label. */
function keyFor(label: string, fill: number): string {
  const b = new Uint8Array(32);
  b.fill(fill);
  b[0] = (label.charCodeAt(0) % 250) + 1;
  return base58Encode(b);
}

const POOL_PDA = keyFor('pool', 3);
const PLAYER = keyFor('player', 4);

(CONFIGURED ? describe : describe.skip)('the sealed-ciphertext store', function () {
  this.timeout(60_000);
  let pool: Pool;
  let store: PgCiphertextStore;

  before(async () => {
    pool = (await sharedDatabase()).pool;
    store = new PgCiphertextStore(pool);
  });
  beforeEach(async () => {
    await truncate(pool, ['sealed_entries']);
  });

  it('returns the exact bytes it was handed, through a bytea column', async () => {
    // Every byte value, so a driver that mangled one encoding (a text
    // round trip, a UTF-8 coercion) could not pass by accident.
    const ciphertext = new Uint8Array(256);
    for (let i = 0; i < 256; i++) ciphertext[i] = i;
    await store.put(41n, PLAYER, ciphertext);
    const got = await store.get(41n, PLAYER);
    expect(got, 'the row is there').to.not.equal(null);
    expect(Buffer.from(got!.ciphertext).equals(Buffer.from(ciphertext))).to.equal(true);
    expect(got!.poolId, 'a NUMERIC pool id comes back as a bigint, not as a float').to.equal(41n);
    expect(got!.player).to.equal(PLAYER);
  });

  it('carries a pool id past 2^53 without losing a digit', async () => {
    // NUMERIC, not BIGINT, precisely so this holds; `pg` hands NUMERIC back
    // as a string and the store parses it with BigInt.
    const huge = 18_446_744_073_709_551_615n; // u64::MAX
    await store.put(huge, PLAYER, new Uint8Array([1, 2, 3]));
    expect((await store.get(huge, PLAYER))!.poolId).to.equal(huge);
  });

  it('last write wins for one (pool, player), and listForPool is insertion-ordered', async () => {
    const twin = new MemoryCiphertextStore();
    const players = [keyFor('a', 9), keyFor('b', 9), keyFor('c', 9)];
    for (const [i, p] of players.entries()) {
      await store.put(7n, p, new Uint8Array([i]));
      await twin.put(7n, p, new Uint8Array([i]));
    }
    await store.put(7n, players[1], new Uint8Array([99]));
    await twin.put(7n, players[1], new Uint8Array([99]));

    const rows = await store.listForPool(7n);
    expect(rows.length, 'one row per player, not one per write').to.equal(3);
    expect((await store.get(7n, players[1]))!.ciphertext[0]).to.equal(99);
    // The twin is the reference for ORDER as well as for content: an
    // overwrite re-stamps `received_at`, so the overwritten player moves to
    // the end in both implementations or in neither.
    expect(rows.map((r) => r.player)).to.deep.equal(
      (await twin.listForPool(7n)).map((r) => r.player)
    );
  });

  it('the sealed boxes stay in the store and the read API serves none of them, before or after the reveal', async () => {
    // Rewritten in place on 2026-09-16 (the founder's data-minimisation
    // ruling of 2026-09-15). Until then this case exercised the real
    // pools → sealed_entries → entries join behind `/sealed-entries`, which
    // served every seat's box once the secret was on chain. That route is
    // gone: the boxes have no public reader. What this case still proves
    // against real rows is that the store holds the boxes the daemon needs
    // and that the API, with the same rows in front of it, refuses.
    await truncate(pool, ['pools', 'entries', 'sealed_entries']);
    await pool.query(
      `INSERT INTO pools (pool, id, tier, state, entrants) VALUES ($1, $2, 0, 'Scored', 2)`,
      [POOL_PDA, '41']
    );
    const seats = [
      { player: keyFor('x', 5), idx: 1, bytes: Uint8Array.from([0xde, 0xad]) },
      { player: keyFor('y', 5), idx: 0, bytes: Uint8Array.from([0xbe, 0xef]) },
    ];
    for (const s of seats) {
      await pool.query('INSERT INTO entries (pool, player, idx) VALUES ($1, $2, $3)', [
        POOL_PDA,
        s.player,
        s.idx,
      ]);
      await store.put(41n, s.player, s.bytes);
    }

    const before = await handleRead(pool, `/pools/${POOL_PDA}/sealed-entries`);
    expect(before.status, 'no box is served before the reveal').to.equal(404);

    await pool.query('UPDATE pools SET secret = $2 WHERE pool = $1', [POOL_PDA, 'ff'.repeat(32)]);
    const after = await handleRead(pool, `/pools/${POOL_PDA}/sealed-entries`);
    expect(after.status, 'and none after it either').to.equal(404);

    // The daemon's own read is untouched: both boxes are there, in order.
    const held = await store.listForPool(41n);
    expect(held.map((r) => r.player).sort()).to.deep.equal(seats.map((s) => s.player).sort());
    expect(Array.from((await store.get(41n, seats[1].player))!.ciphertext)).to.deep.equal([0xbe, 0xef]);
  });
});

(CONFIGURED ? describe : describe.skip)('the published sealing-key store (B-29)', function () {
  this.timeout(60_000);
  let pool: Pool;
  let store: PgPublishedKeyStore;

  const FIRST: StoredPublishedKey = {
    publicKeyHex: 'aa'.repeat(32),
    secretHashHex: '11'.repeat(32),
    privateKeyId: 'turnkey-key-1',
  };
  const SECOND: StoredPublishedKey = {
    publicKeyHex: 'bb'.repeat(32),
    secretHashHex: '22'.repeat(32),
    privateKeyId: 'turnkey-key-2',
  };

  before(async () => {
    pool = (await sharedDatabase()).pool;
    store = new PgPublishedKeyStore(pool);
  });
  beforeEach(async () => {
    await truncate(pool, ['published_pool_keys']);
  });

  it('first write wins and a conflicting second write throws — on the REAL constraint', async () => {
    // The in-memory twin of this statement is exercised by
    // `backend/sealing/test/published-key-store.spec.ts`. What it models by
    // assumption is `ON CONFLICT (pool_id) DO NOTHING ... RETURNING`: one
    // row back when this statement inserted, none when the table's unique
    // index refused it. That behaviour is the database's, not ours.
    await store.save(5n, FIRST);
    let refused: unknown = null;
    try {
      await store.save(5n, SECOND);
    } catch (e) {
      refused = e;
    }
    expect(refused, 'the losing open must learn it lost').to.be.instanceOf(
      PublishedKeyConflictError
    );
    expect(await store.load(5n)).to.deep.equal(FIRST);
  });

  it('an identical re-save is a no-op, so a retry can finish', async () => {
    await store.save(6n, FIRST);
    await store.save(6n, { ...FIRST });
    expect(await store.load(6n)).to.deep.equal(FIRST);
    const n = await pool.query('SELECT count(*)::int AS n FROM published_pool_keys WHERE pool_id = 6');
    expect((n.rows[0] as { n: number }).n).to.equal(1);
  });

  it('two concurrent saves of different keys leave exactly one winner', async () => {
    // The race the finding describes, run for real: both statements are in
    // flight against one unique index at the same time. Exactly one must
    // return a row, and the other caller must throw rather than believe it
    // published a key it did not.
    const outcomes = await Promise.allSettled([store.save(8n, FIRST), store.save(8n, SECOND)]);
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(fulfilled.length, 'exactly one open may be told its key was published').to.equal(1);
    expect(rejected.length).to.equal(1);
    expect((rejected[0] as PromiseRejectedResult).reason).to.be.instanceOf(
      PublishedKeyConflictError
    );
    const stored = await store.load(8n);
    expect([FIRST, SECOND]).to.deep.include(stored);
  });

  it('load answers null for a pool with no key, rather than an empty record', async () => {
    expect(await store.load(9_999n)).to.equal(null);
  });
});

(CONFIGURED ? describe : describe.skip)('the review decision log (A-04 / B-21 / B-25)', function () {
  this.timeout(60_000);
  let pool: Pool;
  let log: PgDecisionLog;

  const keys = nacl.sign.keyPair.fromSeed(
    new TextEncoder().encode('pg-suite-reviewer'.padEnd(32, '.')).slice(0, 32)
  );
  const REVIEWER = base58Encode(keys.publicKey);
  const REGISTRY: ReviewerRegistry = {
    version: 1,
    members: [REVIEWER],
    updated: '2026-09-12',
  };

  function sign(decidedAt: string, action: Decision['action'] = 'clear'): Decision {
    const criterion = 'timings human on inspection';
    const signature = nacl.sign.detached(
      canonicalReviewMessage({
        pool: POOL_PDA,
        player: PLAYER,
        action,
        criterion,
        signedAt: decidedAt,
      }),
      keys.secretKey
    );
    return {
      pool: POOL_PDA,
      player: PLAYER,
      action,
      criterion,
      decidedBy: REVIEWER,
      decidedAt,
      signature: Buffer.from(signature).toString('base64'),
    };
  }

  before(async () => {
    pool = (await sharedDatabase()).pool;
    log = new PgDecisionLog(pool);
  });
  beforeEach(async () => {
    await truncate(pool, ['review_decisions']);
  });

  it('a decision re-verifies against its own signature after a REAL round trip', async () => {
    // The defect A-04 named: the canonical message ends `at: <decidedAt>`,
    // the column was a TIMESTAMPTZ, `pg` hands a TIMESTAMPTZ back as a
    // `Date`, and `String(date)` has no sub-second field — so every
    // published decision came back with its milliseconds gone and none of
    // them verified. `log-pg.spec.ts` pins this against a fake that models
    // the driver; this pins it against the driver.
    const decision = sign('2026-09-12T09:41:07.532Z');
    expect(verifyRow(decision, REGISTRY), 'it verified before storage').to.equal(true);
    await log.append(decision);

    const [readBack] = await log.list(POOL_PDA);
    expect(readBack.decidedAt, 'the signed timestamp survived Postgres').to.equal(
      decision.decidedAt
    );
    expect(readBack).to.deep.equal(decision);
    expect(verifyRow(readBack, REGISTRY), 'the published row verifies').to.equal(true);
  });

  it('every millisecond value survives, including the ones a Date drops', async () => {
    for (const ms of ['000', '001', '099', '100', '500', '999']) {
      await log.append(sign(`2026-09-12T09:41:07.${ms}Z`));
    }
    const rows = await log.list(POOL_PDA);
    expect(rows.length).to.equal(6);
    for (const r of rows) expect(verifyRow(r, REGISTRY), r.decidedAt).to.equal(true);
    expect(rows.map((r) => r.decidedAt.slice(-5, -1)).sort()).to.deep.equal([
      '.000',
      '.001',
      '.099',
      '.100',
      '.500',
      '.999',
    ]);
  });

  it('countBy reads the budget window off the indexed instant column (B-25)', async () => {
    await log.append(sign('2026-09-12T09:00:00.000Z'));
    await log.append(sign('2026-09-12T10:00:00.000Z', 'flag'));
    expect(await log.countBy(REVIEWER, '2026-09-12T08:00:00.000Z')).to.equal(2);
    expect(await log.countBy(REVIEWER, '2026-09-12T09:30:00.000Z')).to.equal(1);
    expect(await log.countBy(PLAYER, '2026-09-12T08:00:00.000Z')).to.equal(0);
  });

  it('the entry thread comes back in decision order and each row verifies', async () => {
    const rows = [
      sign('2026-09-12T09:41:07.532Z', 'flag'),
      sign('2026-09-12T10:02:00.004Z', 'forfeit'),
    ];
    for (const r of rows) await log.append(r);
    const thread = await log.listFor(POOL_PDA, PLAYER);
    expect(thread.map((r) => r.decidedAt)).to.deep.equal(rows.map((r) => r.decidedAt));
    for (const r of thread) expect(verifyRow(r, REGISTRY), r.action).to.equal(true);
  });
});

(CONFIGURED ? describe : describe.skip)('the sanctions refusal log (B-36)', function () {
  this.timeout(60_000);
  let pool: Pool;
  let log: PgSanctionsRefusalLog;

  before(async () => {
    pool = (await sharedDatabase()).pool;
    log = new PgSanctionsRefusalLog(pool);
  });
  beforeEach(async () => {
    await truncate(pool, ['sanctions_refusals']);
  });

  it('writes the evidence a regulator asks for, and reads it back unchanged', async () => {
    await log.record({
      service: 'packet',
      wallet: PLAYER,
      pool: POOL_PDA,
      screenedAt: '2026-09-12T11:22:33.444Z',
      matches: [
        { source: 'ofac-sdn', listName: 'SDN', entityName: 'A NAME', entityId: '12345' },
        { source: 'opensanctions', listName: 'consolidated', entityName: 'A NAME' },
      ],
      consulted: ['ofac-sdn', 'opensanctions'],
      failed: ['chainalysis'],
      country: 'GB',
      ipPrefix: '203.0',
    });
    const res = await pool.query(
      `SELECT service, wallet, pool, screened_at, matches, consulted, failed, country, ip_prefix
         FROM sanctions_refusals`
    );
    expect(res.rowCount).to.equal(1);
    const row = res.rows[0] as Record<string, unknown>;
    expect(row.wallet).to.equal(PLAYER);
    expect(row.pool).to.equal(POOL_PDA);
    expect(row.country).to.equal('GB');
    expect(row.ip_prefix, 'truncated, as the header requires').to.equal('203.0');
    // jsonb comes back parsed; a text column would not. Which list matched
    // is the first question asked of this table.
    expect(row.matches).to.deep.equal([
      { source: 'ofac-sdn', listName: 'SDN', entityName: 'A NAME', entityId: '12345' },
      { source: 'opensanctions', listName: 'consolidated', entityName: 'A NAME' },
    ]);
    expect(row.consulted).to.deep.equal(['ofac-sdn', 'opensanctions']);
    expect(row.failed).to.deep.equal(['chainalysis']);
    expect(
      (row.screened_at as Date).toISOString(),
      'the vendor verdict`s own instant, not ours'
    ).to.equal('2026-09-12T11:22:33.444Z');
  });

  it('is append-only in practice: a second refusal for one wallet is a second row', async () => {
    const base = {
      service: 'packet',
      wallet: PLAYER,
      pool: POOL_PDA,
      matches: [],
      consulted: ['ofac-sdn'],
      failed: [],
      country: null,
      ipPrefix: null,
    };
    await log.record({ ...base, screenedAt: '2026-09-12T11:00:00.000Z' });
    await log.record({ ...base, screenedAt: '2026-09-12T12:00:00.000Z' });
    const res = await pool.query('SELECT count(*)::int AS n FROM sanctions_refusals');
    expect((res.rows[0] as { n: number }).n).to.equal(2);
  });
});

(CONFIGURED ? describe : describe.skip)('the entry gate`s stores and the detection report store', function () {
  this.timeout(60_000);
  let pool: Pool;

  before(async () => {
    pool = (await sharedDatabase()).pool;
  });
  beforeEach(async () => {
    await truncate(pool, ['attestations', 'notify_optin', 'detection_reports']);
  });

  it('an attestation round-trips, including a timestamp past 2^53', async () => {
    const store = new PgAttestationStore(pool);
    expect(await store.get(PLAYER), 'no attestation yet').to.equal(null);
    const record = {
      wallet: PLAYER,
      termsVersion: 3,
      attested18: true as const,
      timestamp: 1_757_664_000n,
      walletSignature: 'c2lnbmF0dXJl',
    };
    await store.put(record);
    expect(await store.get(PLAYER)).to.deep.equal(record);
    // Re-attesting under a newer terms edition replaces the row.
    await store.put({ ...record, termsVersion: 4, timestamp: 1_757_700_000n });
    const updated = await store.get(PLAYER);
    expect(updated!.termsVersion).to.equal(4);
    expect(updated!.timestamp).to.equal(1_757_700_000n);
    const n = await pool.query('SELECT count(*)::int AS n FROM attestations');
    expect((n.rows[0] as { n: number }).n).to.equal(1);
  });

  it('a notify preference round-trips, and opting out is a stored false', async () => {
    const store = new PgNotifyPreferenceStore(pool);
    const record = {
      wallet: PLAYER,
      emailOptIn: true,
      timestamp: 1_757_664_000n,
      walletSignature: 'c2ln',
    };
    await store.put(record);
    expect(await store.get(PLAYER)).to.deep.equal(record);
    await store.put({ ...record, emailOptIn: false, timestamp: 1_757_665_000n });
    expect((await store.get(PLAYER))!.emailOptIn).to.equal(false);
  });

  it('the latest detection report is the latest one, and its findings come back as findings', async () => {
    const store = new PgDetectionReportStore(pool);
    expect(await store.latest(POOL_PDA)).to.equal(null);
    const finding = {
      signal: 'duplicate-battle-set',
      players: [PLAYER],
      detail: 'two entries share a battle set',
    };
    await store.save({
      pool: POOL_PDA,
      poolId: '41',
      producedAt: '2026-09-12T10:00:00.000Z',
      report: { pool: POOL_PDA, findings: [], reviewRecommended: [], hardBlocks: [] },
    });
    await store.save({
      pool: POOL_PDA,
      poolId: '41',
      producedAt: '2026-09-12T11:00:00.000Z',
      report: {
        pool: POOL_PDA,
        findings: [finding as never],
        reviewRecommended: [PLAYER],
        hardBlocks: [PLAYER],
      },
    });
    const latest = await store.latest(POOL_PDA);
    expect(latest!.producedAt).to.equal('2026-09-12T11:00:00.000Z');
    expect(latest!.report.findings, 'jsonb arrives parsed, not as a string').to.deep.equal([
      finding,
    ]);
    expect(latest!.report.hardBlocks).to.deep.equal([PLAYER]);
    // Append-only: the earlier report is still on the record.
    const n = await pool.query('SELECT count(*)::int AS n FROM detection_reports');
    expect((n.rows[0] as { n: number }).n).to.equal(2);
  });
});
