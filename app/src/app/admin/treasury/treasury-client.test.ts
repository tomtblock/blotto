/*
 * The treasury page's two audit findings (2026-09-11).
 *
 *  - D-35: six of seven rows rendered a BLANK status, because the client's
 *    status union omitted 'disabled' and the label lookup silently answered
 *    `undefined`. A founder reading the page saw an empty cell where the
 *    report said "not enabled".
 *  - D-41: the caption contradicted the very table above it, asserting that
 *    tier enablement is not on the event ledger — untrue since the indexer
 *    began consuming TiersOpened (E1 PR3a).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STATUS_LABEL, provenanceCaption, statusLabel } from './treasury-client';

/** The statuses the report can actually answer, read from its own source
 * so the two cannot drift apart silently the way they did. */
function reportStatuses(): string[] {
  const source = readFileSync(
    fileURLToPath(
      new URL('../../../../../backend/indexer/src/treasury-report.ts', import.meta.url)
    ),
    'utf8'
  );
  const union = /status:\s*((?:'[a-z_]+'\s*\|\s*)+'[a-z_]+')/.exec(source);
  expect(union, 'the report still declares a status union').not.toBeNull();
  return [...union![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('the per-tier status (D-35)', () => {
  it('labels EVERY status the report can answer', () => {
    const statuses = reportStatuses();
    expect(statuses).toContain('disabled');
    for (const status of statuses) {
      const label = statusLabel(status);
      expect(label, status).toBeTruthy();
      // The defect: `undefined` rendered as nothing at all.
      expect(label, status).not.toBe('undefined');
      expect(STATUS_LABEL[status as keyof typeof STATUS_LABEL], status).toBeTruthy();
    }
  });

  it('renders an unknown status verbatim rather than blank', () => {
    // A report that grows a status this page has not been taught must show
    // the raw value — a blank cell is how the finding hid for so long.
    expect(statusLabel('something_new')).toBe('something_new');
  });
});

describe('the provenance caption (D-41)', () => {
  it('never claims enablement is absent from the ledger', () => {
    for (const enablement of ['chain', 'ledger', 'launch_default', undefined] as const) {
      const caption = provenanceCaption({ policy_source: 'chain', enablement_source: enablement });
      expect(caption, String(enablement)).not.toMatch(/not on the event ledger/i);
      expect(caption).not.toMatch(/still shows here/i);
    }
  });

  it('says where the enablement came from, distinctly for each source', () => {
    const captions = (['chain', 'ledger', 'launch_default'] as const).map((s) =>
      provenanceCaption({ policy_source: 'chain', enablement_source: s })
    );
    expect(new Set(captions).size).toBe(3);
    expect(captions[1]).toMatch(/TiersOpened/);
    expect(captions[2]).toMatch(/launch posture/);
  });

  it('warns that a ledger-derived floor is a lower bound', () => {
    expect(provenanceCaption({ policy_source: 'ledger' })).toMatch(/lower bound/);
    expect(provenanceCaption({ policy_source: 'chain' })).not.toMatch(/lower bound/);
  });

  it('says it does not know, rather than guessing, for an older indexer', () => {
    expect(provenanceCaption({})).toMatch(/does not say/);
  });
});
