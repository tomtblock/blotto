/*
 * The complaint form's renderings (2026-09-19). Rendered with
 * react-dom/server, no DOM (see vitest.config.mts), so every ending is
 * asserted as the text a player actually reads.
 *
 * These replace `appeal-panel.test.tsx`, which went with the panel this
 * form supersedes. What they pin is the property that panel's own tests
 * existed for (audit C-04): an absent or unreachable service renders as
 * ITSELF, not as a refusal and not as nothing at all. On this surface it
 * matters more, because a complaint is the last route a player has.
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
  COMPLAINT_ACKNOWLEDGE_WORKING_DAYS,
  COMPLAINT_RESOLVE_DAYS,
} from '@blotto/detection/complaints';
import { COPY } from '@/copy';
import { ComplaintForm, type ComplaintFormProps } from './complaint-form';
import { ComplaintStatusPanel } from './complaint-status';

const c = COPY.complaints;

/* react-dom/server splits adjacent text nodes with an empty comment; drop
   them so assertions read the text a player sees. */
const render = (node: React.ReactElement) => renderToString(node).replaceAll('<!-- -->', '');

function props(over: Partial<ComplaintFormProps> = {}): ComplaintFormProps {
  return {
    category: 'other',
    text: '',
    busy: false,
    outcome: null,
    reference: null,
    canSign: true,
    onCategoryChange: () => {},
    onTextChange: () => {},
    onSubmit: () => {},
    ...over,
  };
}

describe('ComplaintForm', () => {
  it('offers every published category', () => {
    const html = render(<ComplaintForm {...props()} />);
    for (const label of Object.values(c.categories)) expect(html).toContain(label);
  });

  it('says a signature is needed BEFORE the player writes, per category', () => {
    expect(render(<ComplaintForm {...props({ category: 'decision' })} />)).toContain(
      c.signatureNeeded
    );
    expect(render(<ComplaintForm {...props({ category: 'payment' })} />)).toContain(
      c.signatureNeeded
    );
    expect(render(<ComplaintForm {...props({ category: 'site' })} />)).toContain(
      c.signatureNotNeeded
    );
  });

  it('publishes both response windows, from the constants', () => {
    const html = render(<ComplaintForm {...props()} />);
    expect(html).toContain(
      c.windows(COMPLAINT_ACKNOWLEDGE_WORKING_DAYS, COMPLAINT_RESOLVE_DAYS)
    );
    // The figures a player reads ARE the service's, not a copy of them.
    expect(html).toContain(String(COMPLAINT_ACKNOWLEDGE_WORKING_DAYS));
    expect(html).toContain(String(COMPLAINT_RESOLVE_DAYS));
  });

  it('says the text is not published — the opposite of the appeal form it replaces', () => {
    expect(render(<ComplaintForm {...props()} />)).toContain(c.publishedNote);
  });

  it('disables submit on an empty draft, and while busy', () => {
    expect(render(<ComplaintForm {...props({ text: '   ' })} />)).toContain('disabled=""');
    expect(render(<ComplaintForm {...props({ text: 'a real complaint', busy: true })} />)).toContain(
      'disabled=""'
    );
  });

  it('disables submit when the category needs a signature this wallet cannot give', () => {
    const html = render(
      <ComplaintForm {...props({ category: 'decision', text: 'look again', canSign: false })} />
    );
    expect(html).toContain('disabled=""');
  });

  it('enables submit on a valid unsigned draft with no wallet at all', () => {
    const html = render(
      <ComplaintForm {...props({ category: 'site', text: 'the page will not load', canSign: false })} />
    );
    expect(html).not.toContain('disabled=""');
  });

  it('replaces the form with the reference once it is sent', () => {
    const html = render(
      <ComplaintForm {...props({ outcome: 'submitted', reference: 'BC-7K2M4QPT' })} />
    );
    expect(html).toContain(c.referenceKeep('BC-7K2M4QPT'));
    expect(html).toContain('complaint-sent');
    // Nothing invites a second submission of the same complaint.
    expect(html).not.toContain('complaint-submit');
  });

  it('renders an absent service and an unreachable one as themselves, never as a refusal', () => {
    const absent = render(<ComplaintForm {...props({ outcome: 'not_configured' })} />);
    const down = render(<ComplaintForm {...props({ outcome: 'unreachable' })} />);
    expect(absent).toContain(c.outcome.not_configured);
    expect(down).toContain(c.outcome.unreachable);
    expect(absent).not.toContain(c.outcome.refused);
    expect(down).not.toContain(c.outcome.refused);
  });

  it('keeps the draft on screen when a submission fails', () => {
    const html = render(
      <ComplaintForm {...props({ text: 'my words', outcome: 'unreachable' })} />
    );
    // Our failure must not throw away what the player wrote.
    expect(html).toContain('my words');
    expect(html).toContain('complaint-text');
  });

  it('has a rendering for every named outcome', () => {
    const outcomes: ComplaintFormProps['outcome'][] = [
      'not_configured',
      'unreachable',
      'signature_required',
      'cannot_sign',
      'declined',
      'clock_skew',
      'refused',
      'already_lodged',
      'too_long',
      'not_accepted',
    ];
    for (const outcome of outcomes) {
      const html = render(<ComplaintForm {...props({ outcome })} />);
      expect(html, String(outcome)).toContain(c.outcome[outcome as string]);
    }
  });

  it('takes the caller’s heading and lead, for the inline use on a results page', () => {
    const html = render(
      <ComplaintForm {...props({ heading: 'Challenge this decision', lead: 'why you see this' })} />
    );
    expect(html).toContain('Challenge this decision');
    expect(html).toContain('why you see this');
  });
});

describe('ComplaintStatusPanel', () => {
  it('asks for a reference and refuses to check a malformed one', () => {
    const html = renderToString(
      <ComplaintStatusPanel reference="nope" read="idle" onReferenceChange={() => {}} onCheck={() => {}} />
    );
    expect(html).toContain(c.statusRefLabel);
    expect(html).toContain('disabled=""');
  });

  it('renders each status state and whether the complaint was signed', () => {
    const base = {
      reference: 'BC-7K2M4QPT',
      category: 'decision' as const,
      receivedAt: '2026-09-19T12:00:00.000Z',
      text: 'look again',
      note: null,
      acknowledgeWorkingDays: COMPLAINT_ACKNOWLEDGE_WORKING_DAYS,
      resolveDays: COMPLAINT_RESOLVE_DAYS,
    };
    for (const status of ['received', 'acknowledged', 'resolved'] as const) {
      const html = render(
        <ComplaintStatusPanel
          reference={base.reference}
          read={{ kind: 'status', status: { ...base, status, signed: true } }}
          onReferenceChange={() => {}}
          onCheck={() => {}}
        />
      );
      expect(html).toContain(c.statusStates[status]);
      expect(html).toContain(c.statusSignedYes);
    }
    const unsigned = render(
      <ComplaintStatusPanel
        reference={base.reference}
        read={{ kind: 'status', status: { ...base, status: 'received', signed: false } }}
        onReferenceChange={() => {}}
        onCheck={() => {}}
      />
    );
    expect(unsigned).toContain(c.statusSignedNo);
  });

  it('shows the operator’s note when there is one', () => {
    const html = render(
      <ComplaintStatusPanel
        reference="BC-7K2M4QPT"
        read={{
          kind: 'status',
          status: {
            reference: 'BC-7K2M4QPT',
            status: 'resolved',
            category: 'payment',
            receivedAt: '2026-09-19T12:00:00.000Z',
            signed: true,
            text: 'no prize arrived',
            note: 'Paid in full on 20 September.',
            acknowledgeWorkingDays: COMPLAINT_ACKNOWLEDGE_WORKING_DAYS,
            resolveDays: COMPLAINT_RESOLVE_DAYS,
          },
        }}
        onReferenceChange={() => {}}
        onCheck={() => {}}
      />
    );
    expect(html).toContain('Paid in full on 20 September.');
  });

  it('distinguishes a reference we do not hold from a service we cannot reach', () => {
    const notFound = render(
      <ComplaintStatusPanel
        reference="BC-7K2M4QPT"
        read={{ kind: 'not_found' }}
        onReferenceChange={() => {}}
        onCheck={() => {}}
      />
    );
    const down = render(
      <ComplaintStatusPanel
        reference="BC-7K2M4QPT"
        read={{ kind: 'unreachable' }}
        onReferenceChange={() => {}}
        onCheck={() => {}}
      />
    );
    expect(notFound).toContain(c.statusNotFound);
    expect(down).toContain(c.outcome.unreachable);
    expect(notFound).not.toContain(c.outcome.unreachable);
  });
});
