/*
 * The appeal panel in every ending of the read (audit 2026-09-11, C-04).
 *
 * Rendered with react-dom/server, no DOM. The two states the audit found
 * rendered NOTHING — service absent, service unreachable — now render the
 * heading, the note and (for unreachable) a control that tries again. The
 * answered states are unchanged, including "nothing to appeal" rendering
 * nothing.
 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { COPY } from '@/copy';
import { AppealPanel, type AppealPanelProps } from './appeal-panel';
import type { AppealRead } from './appeal';

const noop = () => {};

function panel(read: AppealRead | 'loading', over: Partial<AppealPanelProps> = {}): string {
  return renderToString(
    <AppealPanel
      read={read}
      grounds=""
      busy={false}
      outcome={null}
      onGroundsChange={noop}
      onSubmit={noop}
      onRetry={noop}
      {...over}
    />
  );
}

const c = COPY.results.appeal;
const empty = { forfeit: null, lodged: null, decided: null, lodgeUntil: null, decideBy: null };
const forfeited = {
  ...empty,
  forfeit: { decidedAt: '2026-09-10T10:00:00Z', decidedBy: 'reviewer-1', criterion: 'shared device' },
  lodgeUntil: '2026-09-17T10:00:00Z',
};

describe('AppealPanel', () => {
  it('renders nothing while loading', () => {
    expect(panel('loading')).toBe('');
  });

  it('with no review service configured, says so instead of vanishing', () => {
    const html = panel({ kind: 'not_configured' });
    expect(html).toContain(c.title);
    expect(html).toContain(c.note);
    // The COPY line that existed and could never render before.
    expect(html).toContain(c.outcome.not_configured);
  });

  it('when the service cannot be reached, explains and offers a way to try again', () => {
    for (const reason of ['network', 'status', 'malformed'] as const) {
      const html = panel({ kind: 'unreachable', reason });
      expect(html).toContain(c.title);
      expect(html).toContain(c.unreachable);
      expect(html).toContain('data-testid="appeal-retry"');
      expect(html).toContain(c.retry);
    }
  });

  it('renders nothing when the service confirms there is nothing to appeal', () => {
    expect(panel({ kind: 'position', position: empty })).toBe('');
  });

  it('renders the form for an upheld flag, the notice once lodged, the decision once decided', () => {
    const form = panel({ kind: 'position', position: forfeited });
    expect(form).toContain('id="appeal-grounds"');
    expect(form).toContain(c.submit);
    // 2026-09-16 (the founder's data-minimisation ruling of 2026-09-15): the
    // form says, before the player types, that the text is published.
    expect(form).toContain(c.groundsPublicNote);
    expect(form).toContain('aria-describedby="appeal-grounds-public"');

    const lodged = panel({
      kind: 'position',
      position: { ...forfeited, lodged: { decidedAt: '2026-09-11T10:00:00Z' } },
    });
    expect(lodged).toContain(c.lodgedOn('2026-09-11T10:00:00Z'));
    expect(lodged).not.toContain('id="appeal-grounds"');

    const upheld = panel({
      kind: 'position',
      position: {
        ...forfeited,
        decided: { decidedAt: '2026-09-12T10:00:00Z', action: 'appeal_upheld', criterion: 'x' },
      },
    });
    expect(upheld).toContain(c.upheld);
  });

  it('a failed lodge is named under the form', () => {
    const html = panel({ kind: 'position', position: forfeited }, { outcome: 'refused' });
    expect(html).toContain(c.outcome.refused);
  });
});
