/**
 * Re-export of `@blotto/scoring` for the sealing package — the repository's
 * cross-package convention (see backend/indexer/src/shared.ts): a relative
 * re-export rather than an npm link, so type-checking sees one source tree.
 */
export * from '../../scoring/src';
