/**
 * @blotto/scoring — the one scoring module, two runtimes (R20): the
 * settlement crank imports it in Node; the verify page bundles it for the
 * browser. Pure functions only — no I/O, no Date, no randomness — which is
 * what makes "recompute in-browser and compare to the on-chain root" an
 * honest claim rather than a mock.
 */
export * from './allocation';
export * from './engine';
export * from './prizes';
export * from './merkle';
