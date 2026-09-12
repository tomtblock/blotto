/**
 * The terms edition ledger (audit 2026-09-11, B-44).
 *
 * THE DEFECT. The clickwrap signature covers the edition's DATE — founder
 * ruling 2026-09-09, because "terms dated 6 September 2026" reads the way a
 * contract does and "terms version 2" does not. The consent record stores
 * the VERSION, because that is what the entry packet carries as a u16. So
 * the legal value of the whole mechanism rests on one unstated assumption:
 * that a date names exactly one edition.
 *
 * Nothing enforced it. `config/terms.json` held a single edition and no
 * history, so a same-day correction — an ordinary thing to do to a legal
 * document — would produce two editions sharing a date. A signature
 * captured for the first would then verify byte-for-byte for the second,
 * and the service would store it as consent to terms that signer never saw.
 * The signer's own bytes would be the evidence against them.
 *
 * THE FIX. The config carries the append-only ledger of every edition, and
 * the loader refuses to boot on a ledger where a date repeats or goes
 * backwards. The statement's wording is untouched, because it is founder-
 * owned and dated; the invariant is enforced around it.
 */
import { expect } from 'chai';
import { join } from 'path';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import {
  assertEditionLedger,
  attestationMessage,
  loadTerms,
  type TermsEdition,
  type TermsLedger,
} from '../src/attestations';

const CONFIG = join(__dirname, '..', '..', '..', 'config', 'terms.json');

/** Write a candidate terms config to a scratch file and load it. */
function loadDoc(doc: unknown): TermsEdition {
  const dir = mkdtempSync(join(tmpdir(), 'blotto-terms-'));
  const path = join(dir, 'terms.json');
  writeFileSync(path, JSON.stringify(doc));
  return loadTerms(path);
}

function refusal(doc: unknown): string {
  try {
    loadDoc(doc);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('expected the loader to refuse this config, it accepted it');
}

describe('the committed config/terms.json (B-44)', () => {
  it('loads, and its ledger holds', () => {
    const terms = loadTerms(CONFIG);
    expect(terms.version).to.be.at.least(1);
    expect(terms.updated).to.match(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('every edition in it has a date of its own', () => {
    // The property the signed statement depends on, asserted against the
    // real file rather than a fixture: no two editions may share a date.
    const doc = JSON.parse(
      require('fs').readFileSync(CONFIG, 'utf8') as string
    ) as { editions: TermsEdition[] };
    const dates = doc.editions.map((e) => e.updated);
    expect(new Set(dates).size, `dates repeat in the ledger: ${dates.join(', ')}`).to.equal(
      dates.length
    );
    const versions = doc.editions.map((e) => e.version);
    expect(new Set(versions).size).to.equal(versions.length);
  });

  it('each edition renders a distinct signed statement', () => {
    // The end-to-end form of the same property: two editions that produced
    // identical bytes would be indistinguishable to a verifier.
    const doc = JSON.parse(
      require('fs').readFileSync(CONFIG, 'utf8') as string
    ) as { editions: TermsEdition[] };
    const wallet = '11111111111111111111111111111111';
    const texts = doc.editions.map((e) => new TextDecoder().decode(attestationMessage(wallet, e)));
    expect(new Set(texts).size, 'two editions sign the same bytes').to.equal(texts.length);
  });
});

describe('loadTerms refuses a config that cannot name one edition (B-44)', () => {
  const LEDGER = [
    { version: 1, updated: '2026-08-27' },
    { version: 2, updated: '2026-09-06' },
  ];

  it('accepts the well-formed case', () => {
    expect(loadDoc({ version: 2, updated: '2026-09-06', editions: LEDGER })).to.deep.equal({
      version: 2,
      updated: '2026-09-06',
    });
  });

  it('refuses two editions on the same date — the replay this exists to stop', () => {
    const msg = refusal({
      version: 3,
      updated: '2026-09-06',
      editions: [...LEDGER, { version: 3, updated: '2026-09-06' }],
    });
    expect(msg).to.contain('strictly increase');
    expect(msg, 'the message must say why, not just that').to.contain('signed statement names the date');
  });

  it('refuses a date that goes backwards', () => {
    expect(
      refusal({
        version: 3,
        updated: '2026-09-01',
        editions: [...LEDGER, { version: 3, updated: '2026-09-01' }],
      })
    ).to.contain('strictly increase');
  });

  it('refuses a version that does not move forward', () => {
    expect(
      refusal({
        version: 2,
        updated: '2026-09-20',
        editions: [...LEDGER, { version: 2, updated: '2026-09-20' }],
      })
    ).to.contain('versions must strictly increase');
  });

  it('refuses a current edition that is not the newest in the ledger', () => {
    expect(refusal({ version: 1, updated: '2026-08-27', editions: LEDGER })).to.contain(
      'must be the newest'
    );
  });

  it('refuses a config with no ledger at all', () => {
    expect(refusal({ version: 2, updated: '2026-09-06' })).to.contain('every published edition');
  });

  it('refuses an empty ledger', () => {
    expect(refusal({ version: 2, updated: '2026-09-06', editions: [] })).to.contain(
      'non-empty array'
    );
  });

  it('refuses an edition whose date is not a plain ISO date', () => {
    expect(
      refusal({
        version: 2,
        updated: '2026-09-06',
        editions: [{ version: 1, updated: '27 August 2026' }, { version: 2, updated: '2026-09-06' }],
      })
    ).to.contain('YYYY-MM-DD');
  });

  it('refuses an edition with no usable version number', () => {
    expect(
      refusal({
        version: 2,
        updated: '2026-09-06',
        editions: [{ version: 0, updated: '2026-08-27' }, { version: 2, updated: '2026-09-06' }],
      })
    ).to.contain('positive integer version');
  });
});

describe('assertEditionLedger, on its own', () => {
  it('accepts a single edition', () => {
    const one: TermsLedger = [{ version: 1, updated: '2026-08-27' }];
    expect(() => assertEditionLedger(one, one[0])).to.not.throw();
  });

  it('allows a skipped version number: contiguity is the founder’s call, not an invariant', () => {
    const ledger: TermsLedger = [
      { version: 1, updated: '2026-08-27' },
      { version: 5, updated: '2026-09-06' },
    ];
    expect(() => assertEditionLedger(ledger, ledger[1])).to.not.throw();
  });
});
