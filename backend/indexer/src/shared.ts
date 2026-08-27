/**
 * Re-export of `@blotto/backend-shared` for the indexer.
 *
 * The shared package is consumed as co-located TypeScript source — no build step
 * and no workspace linkage. This one file isolates the relative path so the rest
 * of the service imports from `./shared`, and every future service follows the
 * same pattern. An infrastructure change can swap this for real package
 * resolution without touching a single consumer.
 */
export * from '../../_shared/src';
