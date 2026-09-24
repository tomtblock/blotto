/*
 * The seal stage's phase machine (founder 2026-09-16,
 * CHANGE-2026-09-16_ui-uplift.md §A8). Pure: the component draws it, the
 * page feeds it.
 *
 * It models ONLY THE SCENE — the belt, the lid, the blender — never the
 * entry. The entry path (src/entry) and the board's reducer
 * (src/battle/board/machine.ts) are untouched; nothing here can sign, send
 * or settle anything. Every event is a fact the page already has: the
 * player armed or confirmed the seal (the seal keys play-client.tsx draws
 * under the stage), the wallet finished a signature (observed-signer.ts),
 * the reveal machine reached a terminal beat (reveal-host.tsx).
 *
 * Honest states: the blender runs only once the TRANSACTION is signed (the
 * founder's "once the transactions are signed"), and a failure from any
 * in-flight phase stops it — nothing landed, so nothing was blended.
 */

export type SealStagePhase =
  /** Seven made; the belt loops, the lid is off, the key invites. */
  | 'made'
  /** Step one pressed; the confirm is on screen (the two-step seal, unchanged). */
  | 'armed'
  /** Confirmed; the wallet is being asked. The belt keeps looping. */
  | 'signing'
  /** The message is signed (the packet); the lid comes down. */
  | 'locked'
  /** The transaction is signed; the blender runs while the network confirms. */
  | 'blending'
  /** The network confirmed the entry; the blend settles, the pass rises. */
  | 'done'
  /** The entry failed or was refused; the belt stops, nothing blends. */
  | 'failed';

export type SealStageEvent =
  | { type: 'arm' }
  | { type: 'disarm' }
  | { type: 'confirm' }
  | { type: 'message-signed' }
  | { type: 'transaction-signed' }
  | { type: 'confirmed' }
  | { type: 'failed' }
  | { type: 'retry' }
  /** The flow starts over (nothing landed and nothing can): back to the first picture. */
  | { type: 'reset' };

export const INITIAL_SEAL_STAGE: SealStagePhase = 'made';

const IN_FLIGHT: ReadonlySet<SealStagePhase> = new Set(['signing', 'locked', 'blending']);

export function reduceSealStage(phase: SealStagePhase, event: SealStageEvent): SealStagePhase {
  switch (event.type) {
    case 'arm':
      return phase === 'made' ? 'armed' : phase;
    case 'disarm':
      return phase === 'armed' ? 'made' : phase;
    case 'confirm':
      // The confirm control exists only once armed (play-client.tsx); a
      // confirm from `made` is tolerated so a retry path that re-submits
      // without re-arming still reads as in flight.
      return phase === 'armed' || phase === 'made' ? 'signing' : phase;
    case 'message-signed':
      return phase === 'signing' ? 'locked' : phase;
    case 'transaction-signed':
      // A wallet without signMessage cannot enter at all (services.ts fails
      // closed), so the message always comes first — but the scene must
      // not depend on it.
      return phase === 'signing' || phase === 'locked' ? 'blending' : phase;
    case 'confirmed':
      return IN_FLIGHT.has(phase) ? 'done' : phase;
    case 'failed':
      return IN_FLIGHT.has(phase) ? 'failed' : phase;
    case 'retry':
      return phase === 'failed' ? 'signing' : phase;
    case 'reset':
      return 'made';
  }
}

/** What the scene shows for a phase — the component reads this, never the phase name. */
export interface SealStageVisual {
  /** Which clip is on screen. */
  clip: 'idle' | 'run';
  /** The belt is moving (false when stopped by a failure, or once done). */
  beltRunning: boolean;
  /** The lid is down (locked, blending, done). */
  lidDown: boolean;
  /** The seal key invites a press (a slow glow pulse). */
  keyPulse: boolean;
  /** The blend finished and the pass may rise. */
  settled: boolean;
}

export function sealStageVisual(phase: SealStagePhase): SealStageVisual {
  switch (phase) {
    case 'made':
      return { clip: 'idle', beltRunning: true, lidDown: false, keyPulse: true, settled: false };
    case 'armed':
      return { clip: 'idle', beltRunning: true, lidDown: false, keyPulse: true, settled: false };
    case 'signing':
      return { clip: 'idle', beltRunning: true, lidDown: false, keyPulse: false, settled: false };
    case 'locked':
      return { clip: 'idle', beltRunning: true, lidDown: true, keyPulse: false, settled: false };
    case 'blending':
      return { clip: 'run', beltRunning: false, lidDown: true, keyPulse: false, settled: false };
    case 'done':
      return { clip: 'run', beltRunning: false, lidDown: true, keyPulse: false, settled: true };
    case 'failed':
      return { clip: 'idle', beltRunning: false, lidDown: false, keyPulse: false, settled: false };
  }
}
