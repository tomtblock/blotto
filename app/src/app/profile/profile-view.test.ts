/*
 * C-15 / D-16 (audit 2026-09-11): the profile page reported an indexer
 * outage as "No entries yet" — the exact conflation `live()` exists to
 * prevent.
 *
 * Both halves matter. An outage must not be reported as a fact about the
 * player, and a genuinely empty career must still say so: an "unavailable"
 * card shown to a new player would be the same mistake in the other
 * direction.
 */
import { describe, expect, it } from 'vitest';
import { profileView } from './profile-client';
import type { Live } from '@/data/api';
import type { ProfileRow } from '@/data/types';

const ROW: ProfileRow = {
  player: 'P1ayer11111111111111111111111111111111111111',
  pools_entered: '3',
  seats_paid: '1',
  total_won_lamports: '1000000000',
  class_counts: [1, 0, 2, 0, 0],
};

describe('profileView', () => {
  it('holds while nothing has been read', () => {
    expect(profileView(null)).toBe('loading');
  });

  it('says the data service is unavailable when the read FAILED', () => {
    // The finding: this used to render "No entries yet." to a player with
    // a career, because a failure and an empty answer were the same branch.
    expect(profileView({ ok: false })).toBe('unavailable');
  });

  it('still says "no entries" when the indexer answered with none', () => {
    const empty: Live<ProfileRow | null> = { ok: true, value: null };
    expect(profileView(empty)).toBe('empty');
  });

  it('renders the record when there is one', () => {
    expect(profileView({ ok: true, value: ROW })).toEqual({ row: ROW });
  });
});
