/** Cross-package re-exports (repository convention — see backend/indexer/src/shared.ts). */
export * from '../../scoring/src';
export { base58Decode, base58Encode } from '../../_shared/src/blotto-events';
// `BoardMode`, `boardModeOf`, `encodeBattleSet` come with the scoring
// re-export above (Phase B).
export {
  sealOpen,
  publicKeyOf,
  decodePayload,
  type SealedPayload,
  type PoolKeyCustody,
  ExportRefusedError,
  type CiphertextStore,
  type X25519Keypair,
} from '../../sealing/src';
