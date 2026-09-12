/**
 * A-04 / B-21: a published decision must re-verify against its own
 * signature after a round trip through Postgres.
 *
 * THE DEFECT THIS PINS. `canonicalReviewMessage` ends `at: <decidedAt>` —
 * the timestamp as a STRING. `PgDecisionLog` stored the instant in a
 * `TIMESTAMPTZ` and rebuilt the string on read-back with
 * `new Date(String(row.decided_at)).toISOString()`. `pg` returns a
 * TIMESTAMPTZ as a JavaScript `Date`, and `String(aDate)` is
 * `'Thu Aug 27 2026 12:00:00 GMT+0000 (...)'` — a format with no sub-second
 * field at all. Every signature's timestamp was therefore truncated to whole
 * seconds before it was served, and NO row the log served re-verified.
 *
 * THE FAKE IS THE POINT. It models what the real driver does, and only that:
 *   - `decided_at` comes back as a `Date` (that is what `pg` does with a
 *     TIMESTAMPTZ; it is why `String()` lost the milliseconds);
 *   - `decided_at_text` comes back as the exact text that was inserted.
 * Run this file against the previous `log-pg.ts` and the round trip fails on
 * a millisecond, which is the whole finding.
 */
import { expect } from 'chai';
import nacl from 'tweetnacl';
import { base58Encode } from '../../_shared/src/blotto-events';
import type { Queryable } from '../../_shared/src';
import {
  PgDecisionLog,
  canonicalReviewMessage,
  verifyRow,
  type Decision,
  type ReviewerRegistry,
} from '../src';

const keys = nacl.sign.keyPair.fromSeed(
  new TextEncoder().encode('alice-reviewer'.padEnd(32, '.')).slice(0, 32)
);
const REVIEWER = base58Encode(keys.publicKey);
const POOL = base58Encode(new Uint8Array(32).fill(3));
const PLAYER = base58Encode(new Uint8Array(32).fill(4));
const REGISTRY: ReviewerRegistry = { version: 1, members: [REVIEWER], updated: '2026-09-12' };

function sign(decidedAt: string, action: Decision['action'] = 'clear'): Decision {
  const criterion = 'timings human on inspection';
  const signature = nacl.sign.detached(
    canonicalReviewMessage({ pool: POOL, player: PLAYER, action, criterion, signedAt: decidedAt }),
    keys.secretKey
  );
  return {
    pool: POOL,
    player: PLAYER,
    action,
    criterion,
    decidedBy: REVIEWER,
    decidedAt,
    signature: Buffer.from(signature).toString('base64'),
  };
}

/**
 * A `Queryable` that stores what it is given and answers the way `pg`
 * answers for these column types. Columns are read off the INSERT's own
 * parameter list, so the store cannot drift from what the module writes.
 */
interface FakeResult {
  rows: unknown[];
  rowCount?: number;
}
/** `Queryable`'s shape, structurally — the detection package does not
 * depend on `pg` and this suite has no reason to be the first thing that
 * does. `PgDecisionLog` only ever reads `res.rows`. */
type FakeQueryable = { query(text: string, params?: readonly unknown[]): Promise<FakeResult> };

/** The fake answers `{ rows }` and nothing else; `Queryable`'s declared
 * result type carries `pg`'s other fields, which no code here reads. */
const asQueryable = (db: FakeQueryable): Queryable => db as unknown as Queryable;

function fakePostgres(): {
  db: FakeQueryable;
  rows: Array<Record<string, unknown>>;
} {
  const rows: Array<Record<string, unknown>> = [];
  const db = {
    async query(text: string, params: readonly unknown[] = []): Promise<FakeResult> {
      if (/^\s*INSERT INTO review_decisions/.test(text)) {
        const [pool, player, action, criterion, decidedBy, decidedAt, decidedAtText, signature] =
          params as string[];
        rows.push({
          pool,
          player,
          action,
          criterion,
          decided_by: decidedBy,
          // TIMESTAMPTZ → Date, exactly as `pg` hands it back.
          decided_at: new Date(decidedAt),
          // TEXT → the bytes that went in, verbatim.
          decided_at_text: decidedAtText,
          signature,
        });
        return { rows: [], rowCount: 1 };
      }
      if (/COUNT\(\*\)/.test(text)) {
        const [decidedBy, since] = params as string[];
        const n = rows.filter(
          (r) => r.decided_by === decidedBy && (r.decided_at as Date).getTime() >= Date.parse(since)
        ).length;
        // A bigint count comes back from `pg` as a STRING, not a number.
        return { rows: [{ n: String(n) }] };
      }
      // A SELECT: serve the matching rows, projected to the named columns.
      const [pool, player] = params as string[];
      const matched = rows.filter(
        (r) => r.pool === pool && (player === undefined || r.player === player)
      );
      return { rows: matched.map((r) => ({ ...r })) };
    },
  };
  return { db, rows };
}

describe('the Postgres decision log round trip (audit A-04 / B-21)', () => {
  it('a row signed, stored and read back re-verifies against its own signature', async () => {
    const { db } = fakePostgres();
    const log = new PgDecisionLog(asQueryable(db));
    // A real instant, with milliseconds — which is every instant, since both
    // signing clients use `new Date().toISOString()`.
    const decision = sign('2026-09-12T09:41:07.532Z');
    expect(verifyRow(decision, REGISTRY), 'the submitted row verifies before storage').to.equal(true);

    await log.append(decision);
    const [readBack] = await log.list(POOL);

    expect(readBack.decidedAt, 'the signed timestamp survives the round trip').to.equal(
      decision.decidedAt
    );
    expect(readBack).to.deep.equal(decision);
    expect(
      verifyRow(readBack, REGISTRY),
      'a published decision verifies against the signature that authorised it'
    ).to.equal(true);
  });

  it('the entry thread read back verifies too — the appeal rules read that one', async () => {
    const { db } = fakePostgres();
    const log = new PgDecisionLog(asQueryable(db));
    const rows = [
      sign('2026-09-12T09:41:07.532Z', 'flag'),
      sign('2026-09-12T10:02:00.004Z', 'forfeit'),
    ];
    for (const r of rows) await log.append(r);
    const thread = await log.listFor(POOL, PLAYER);
    expect(thread.map((r) => r.decidedAt)).to.deep.equal(rows.map((r) => r.decidedAt));
    for (const r of thread) expect(verifyRow(r, REGISTRY), r.action).to.equal(true);
  });

  it('every millisecond value survives — not just the ones a Date happens to keep', async () => {
    const { db } = fakePostgres();
    const log = new PgDecisionLog(asQueryable(db));
    for (const ms of ['000', '001', '099', '100', '500', '999']) {
      const d = sign(`2026-09-12T09:41:07.${ms}Z`);
      await log.append(d);
    }
    const rows = await log.list(POOL);
    expect(rows.length).to.equal(6);
    for (const r of rows) expect(verifyRow(r, REGISTRY), r.decidedAt).to.equal(true);
  });

  it('countBy answers the budget window from the instant column (audit B-25)', async () => {
    const { db } = fakePostgres();
    const log = new PgDecisionLog(asQueryable(db));
    await log.append(sign('2026-09-12T09:00:00.000Z'));
    await log.append(sign('2026-09-12T10:00:00.000Z', 'flag'));
    expect(await log.countBy(REVIEWER, '2026-09-12T08:00:00.000Z')).to.equal(2);
    expect(await log.countBy(REVIEWER, '2026-09-12T09:30:00.000Z')).to.equal(1);
    expect(await log.countBy(PLAYER, '2026-09-12T08:00:00.000Z')).to.equal(0);
  });
});
