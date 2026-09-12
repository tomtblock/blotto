/*
 * What a review decision's response means (audit 2026-09-11, B-24 / B-25).
 *
 * The finding that drives this file: the page read `res.ok` as success, and
 * the service now answers 200 for "the chain action landed and the
 * published log does not carry it". Read as success, the reviewer moves on
 * believing the decision is on the record; read as failure, they repeat
 * work that is already irreversible. It is neither.
 */
import { describe, expect, it } from 'vitest';
import { decisionOutcome } from './decision-outcome';

const PLAYER = '4ydbVZuNupTPu1cKGCc2cePs95B8iMkrR4TvsCLiwcL1';
const out = (status: number, body: Record<string, unknown> = {}) =>
  decisionOutcome('forfeit', PLAYER, status, body);

describe('decisionOutcome', () => {
  it('204 is the only plain success', () => {
    const r = out(204);
    expect(r.kind).toBe('recorded');
    expect(r.severity).toBe('ok');
    expect(r.settled).toBe(true);
  });

  it('applied-but-not-logged is NEVER success, and never a failure either', () => {
    const r = out(200, { applied: true, logged: false, error: 'log_write_failed', detail: 'pg down' });
    expect(r.kind).toBe('applied_not_logged');
    expect(r.severity).toBe('attention');
    // Not "recorded": the reviewer must not believe the log carries it.
    expect(r.message).not.toMatch(/\brecorded\b/);
    // It must say the chain moved, and warn against repeating it.
    expect(r.message).toMatch(/LANDED ON-CHAIN/);
    expect(r.message).toMatch(/Do not repeat/i);
    expect(r.message).toContain('pg down');
    // The page must not reload as though everything settled.
    expect(r.settled).toBe(false);
  });

  it('an unrecognised 200 is reported, not assumed to be success', () => {
    // How B-24 got its foothold: `res.ok` swallowed a new outcome whole.
    const r = out(200, { something: 'new' });
    expect(r.severity).toBe('failed');
    expect(r.message).toMatch(/does not recognise/);
  });

  it('202 says the decision is logged and the instruction is not landed', () => {
    const r = out(202, { recorded: true, landed: false });
    expect(r.kind).toBe('recorded_pending_admin');
    expect(r.severity).toBe('attention');
    expect(r.message).toMatch(/has NOT landed/);
    expect(r.message).toMatch(/forfeit_escrow/);
  });

  it('429 is the reviewer action budget, with the wait, not a bare "failed: 429"', () => {
    const r = out(429, { error: 'budget_exceeded', retryAfterSeconds: 600 });
    expect(r.kind).toBe('budget_exceeded');
    expect(r.message).toMatch(/action budget/);
    expect(r.message).toMatch(/10m/);
    expect(r.message).toMatch(/Nothing was submitted/);
    // Without the hint it still says something true.
    expect(out(429, { error: 'budget_exceeded' }).message).toMatch(/action budget/);
  });

  it('every 409 precondition refusal has a sentence, not a raw code', () => {
    const codes = [
      'already_recorded',
      'no_entry',
      'pool_state',
      'entry_settled',
      'flag_unchanged',
      'no_escrow',
      'already_forfeited',
      'sanctions_hold',
      'forfeit_requires_flag',
    ];
    for (const error of codes) {
      const r = out(409, { error });
      expect(r.kind, error).toBe('refused');
      expect(r.severity).toBe('refused');
      // The raw wire code must not be what an operator reads.
      expect(r.message, error).not.toContain(error);
      expect(r.message.length).toBeGreaterThan(20);
    }
    // An unknown code still renders, rather than rendering nothing.
    expect(out(409, { error: 'something_new' }).message).toContain('something_new');
  });

  it('502 says whether anything was attempted', () => {
    expect(out(502, { error: 'state_unreadable' }).message).toMatch(/not attempted/);
    expect(out(502, { error: 'action_failed' }).message).toMatch(/Nothing was logged/);
  });

  it('401 and everything else stay honest', () => {
    expect(out(401).kind).toBe('not_a_reviewer');
    expect(out(503).message).toMatch(/not configured/);
    expect(out(418).message).toBe('failed: 418');
  });

  it('only a settled outcome reloads the page', () => {
    // A reload after applied-but-not-logged would redraw the table as
    // though the decision were on the record.
    expect(out(204).settled).toBe(true);
    expect(out(202).settled).toBe(true);
    expect(out(200, { applied: true, logged: false }).settled).toBe(false);
    expect(out(409, { error: 'no_entry' }).settled).toBe(false);
    expect(out(429, {}).settled).toBe(false);
  });
});
