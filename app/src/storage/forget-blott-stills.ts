/*
 * FORGET THE BLOTT STILLS (2026-09-24). The dial run drew each locked
 * battle as a 1024² picture of the Blott and kept it in this browser's
 * IndexedDB, in the database named below, for the profile's "My Blotts"
 * grid and the results page's "Share your seven". A Blott's silhouette is
 * its allocation drawn, so each picture is an allocation. The board draws
 * no pictures, and both features were retired with the dial run; this
 * deletes what earlier visits left on the device, in line with the
 * founder's data-minimisation ruling of 2026-09-15.
 *
 * Best-effort and idempotent: deleting a database that does not exist is
 * a no-op, a browser without IndexedDB (or one that refuses it, as some
 * private modes do) simply keeps nothing to delete, and no failure here may
 * reach a player. Nothing touches the network.
 */

/** The IndexedDB database the dial run wrote (formerly `battle/stills.ts`). */
export const BLOTT_STILLS_DB = 'blotto-blots';

/** Minimal shape of the IndexedDB factory this needs; `globalThis.indexedDB` in a browser. */
export interface DeleteOnlyIdbFactory {
  deleteDatabase(name: string): unknown;
}

/** Ask the browser to drop the stills database. Returns whether a request was made. */
export function forgetBlottStills(idb: DeleteOnlyIdbFactory | undefined = globalThis.indexedDB): boolean {
  if (!idb) return false;
  try {
    idb.deleteDatabase(BLOTT_STILLS_DB);
    return true;
  } catch {
    return false;
  }
}
