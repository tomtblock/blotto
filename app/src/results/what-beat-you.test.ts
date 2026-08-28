/*
 * What-beat-you specs (v3 D3): a real seal → decrypt round trip with the
 * production sealing code, and the head-to-head recomputation pinned
 * against hand-computed comparisons.
 */
import { describe, expect, it } from 'vitest';
import { generateKeypair, seal, encodePayload } from '@blotto/sealing';
import type { BattleSet } from '@blotto/scoring';
import { decryptSeatBattles, whatFinishedAbove } from './what-beat-you';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

const flat: BattleSet = Array.from({ length: 7 }, () => [20, 20, 20, 20, 20] as const);
// Beats `flat` in every battle: three stats strictly higher (21 > 20).
const spiky: BattleSet = Array.from({ length: 7 }, () => [21, 21, 21, 17, 20] as const);

function sealed(battles: BattleSet, recipientPk: Uint8Array): string {
  return hex(
    seal(
      encodePayload({
        battles,
        salt: new Uint8Array(32).fill(7),
        timingsMs: Array.from({ length: 7 }, () => 1000),
        deviceHash: new Uint8Array(32).fill(9),
      }),
      recipientPk
    )
  );
}

describe('what finished above you', () => {
  const kp = generateKeypair();
  const rows = [
    { seat: 0, ciphertext_hex: sealed(flat, kp.publicKey) },
    { seat: 1, ciphertext_hex: sealed(spiky, kp.publicKey) },
  ];

  it('decrypts served ciphertexts with the revealed secret, skipping garbage', () => {
    const battles = decryptSeatBattles(hex(kp.secretKey), [
      ...rows,
      { seat: 2, ciphertext_hex: 'ab'.repeat(75) },
    ]);
    expect(battles.size).toBe(2);
    expect(battles.get(0)).toEqual(flat);
    expect(battles.get(1)).toEqual(spiky);
  });

  it('recomputes the head-to-head for every seat committed above yours', () => {
    const battles = decryptSeatBattles(hex(kp.secretKey), rows);
    const results = [
      { seat: 0, amount: '0' },
      { seat: 1, amount: '1350000000' },
    ];
    const above = whatFinishedAbove(0, results, battles);
    expect(above.length).toBe(1);
    expect(above[0].seat).toBe(1);
    // spiky takes 3 of 5 stats in every one of the 7 battles.
    expect(above[0].wins).toBe(0);
    expect(above[0].draws).toBe(0);
    expect(above[0].losses).toBe(7);
    // flat takes only the fourth stat (20 > 17); the fifth ties at 20.
    expect(above[0].comparisons[0]).toEqual({ outcome: 'loss', statsA: 1, statsB: 3 });

    // From the winner's seat, nothing is above.
    expect(whatFinishedAbove(1, results, battles)).toEqual([]);
  });
});
