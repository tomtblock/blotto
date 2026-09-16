import { describe, expect, it } from 'vitest';
import {
  INITIAL_SEAL_STAGE,
  reduceSealStage,
  sealStageVisual,
  type SealStageEvent,
  type SealStagePhase,
} from './seal-stage-machine';

const run = (events: SealStageEvent['type'][], from: SealStagePhase = INITIAL_SEAL_STAGE) =>
  events.reduce((p, type) => reduceSealStage(p, { type }), from);

describe('the seal stage phase machine', () => {
  it('walks the happy path in the founder\'s order', () => {
    expect(run(['arm'])).toBe('armed');
    expect(run(['arm', 'confirm'])).toBe('signing');
    expect(run(['arm', 'confirm', 'message-signed'])).toBe('locked');
    expect(run(['arm', 'confirm', 'message-signed', 'transaction-signed'])).toBe('blending');
    expect(run(['arm', 'confirm', 'message-signed', 'transaction-signed', 'confirmed'])).toBe('done');
  });

  it('disarms back to made, and only from armed', () => {
    expect(run(['arm', 'disarm'])).toBe('made');
    expect(run(['disarm'])).toBe('made');
    expect(run(['arm', 'confirm', 'disarm'])).toBe('signing');
  });

  it('the blender runs only once the transaction is signed', () => {
    expect(sealStageVisual(run(['arm', 'confirm'])).clip).toBe('idle');
    expect(sealStageVisual(run(['arm', 'confirm', 'message-signed'])).clip).toBe('idle');
    expect(sealStageVisual(run(['arm', 'confirm', 'message-signed', 'transaction-signed'])).clip).toBe('run');
  });

  it('a failure from any in-flight phase stops everything and never blends', () => {
    for (const path of [
      ['arm', 'confirm'],
      ['arm', 'confirm', 'message-signed'],
      ['arm', 'confirm', 'message-signed', 'transaction-signed'],
    ] as SealStageEvent['type'][][]) {
      const failed = run([...path, 'failed']);
      expect(failed).toBe('failed');
      const v = sealStageVisual(failed);
      expect(v.clip).toBe('idle');
      expect(v.beltRunning).toBe(false);
      expect(v.settled).toBe(false);
    }
  });

  it('a failure before confirm, or after done, changes nothing', () => {
    expect(run(['failed'])).toBe('made');
    expect(run(['arm', 'failed'])).toBe('armed');
    expect(run(['arm', 'confirm', 'transaction-signed', 'confirmed', 'failed'])).toBe('done');
  });

  it('retry re-enters the flight from failed only', () => {
    expect(run(['arm', 'confirm', 'failed', 'retry'])).toBe('signing');
    expect(run(['retry'])).toBe('made');
    expect(run(['arm', 'confirm', 'retry'])).toBe('signing');
  });

  it('reset returns to made from anywhere', () => {
    for (const p of ['made', 'armed', 'signing', 'locked', 'blending', 'done', 'failed'] as const) {
      expect(reduceSealStage(p, { type: 'reset' })).toBe('made');
    }
  });

  it('confirmed settles from any in-flight phase and nowhere else', () => {
    expect(run(['arm', 'confirm', 'confirmed'])).toBe('done');
    expect(run(['confirmed'])).toBe('made');
    expect(sealStageVisual('done').settled).toBe(true);
  });

  it('a wallet that signs the transaction without a separate message still blends', () => {
    expect(run(['arm', 'confirm', 'transaction-signed'])).toBe('blending');
  });

  it('the key pulses only while the seal is still the player\'s to press', () => {
    expect(sealStageVisual('made').keyPulse).toBe(true);
    expect(sealStageVisual('armed').keyPulse).toBe(true);
    for (const p of ['signing', 'locked', 'blending', 'done', 'failed'] as const) {
      expect(sealStageVisual(p).keyPulse).toBe(false);
    }
  });
});
