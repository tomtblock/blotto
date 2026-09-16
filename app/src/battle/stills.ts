/*
 * Lock-in stills, client-side only (master prompt C4/C5): each locked
 * battle's 1024×1024 PNG goes into IndexedDB under the pool address, and the
 * Profile's My Blots grid reads the same store. NOTHING here touches the
 * network.
 *
 * WHAT A STILL IS. The Blott's silhouette is a deterministic, per-stat-
 * monotone function of its five stats (components/blott/warp.ts), so a still
 * is the allocation drawn, and is treated like the allocation itself.
 *
 * WHAT CHANGED 2026-09-16 (the founder's data-minimisation ruling of
 * 2026-09-15). Until then each row ALSO carried the five raw integers of the
 * allocation — read by nothing: the grid and the montage use the PNG — and
 * nothing ever deleted a row, so a device held every allocation it had ever
 * made, for every pool, including pools still open. Now:
 *
 *   - the integers are gone from the row, and database version 2 strips
 *     them from every existing row on first open;
 *   - `stills-sweep.ts` forgets a pool's stills once its allocation will
 *     never be published — a pool that refunded, or closed unrevealed.
 *     Stills of an open pool stay (the run needs them) and stills of a
 *     revealed pool stay (they depict published data; the montage share and
 *     the gallery read them after close).
 *
 * Every operation is best-effort: a browser that refuses IndexedDB
 * (private mode) costs the montage and the gallery, never the seal.
 */

const DB_NAME = 'blotto-blots';
const DB_VERSION = 2;
const STORE = 'stills';

export interface StoredStill {
  /** `${pool}:${battle}` — one row per locked battle per pool. */
  key: string;
  pool: string;
  battle: number; // 1-based
  png: Blob;
  lockedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('pool', 'pool');
        return;
      }
      // Version 1 → 2: the raw allocation leaves every existing row.
      const tx = req.transaction;
      if (!tx) return;
      const cursor = tx.objectStore(STORE).openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        const row = { ...(c.value as StoredStill & { allocation?: unknown }) };
        if ('allocation' in row) {
          delete row.allocation;
          c.update(row);
        }
        c.continue();
      };
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB refused'));
  });
}

export async function saveStill(still: Omit<StoredStill, 'key' | 'lockedAt'>): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({
        ...still,
        key: `${still.pool}:${still.battle}`,
        lockedAt: Date.now(),
      } satisfies StoredStill);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    });
    db.close();
  } catch {
    // Best-effort by design — see the module header.
  }
}

export async function allStills(): Promise<StoredStill[]> {
  try {
    const db = await openDb();
    const rows = await new Promise<StoredStill[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as StoredStill[]);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
    });
    db.close();
    return rows.sort((a, b) => b.lockedAt - a.lockedAt);
  } catch {
    return [];
  }
}

/** Delete every still of one pool. Best-effort, like everything here. */
export async function forgetStills(pool: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.index('pool').openKeyCursor(IDBKeyRange.only(pool));
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        store.delete(c.primaryKey);
        c.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
    });
    db.close();
  } catch {
    // Best-effort by design — see the module header.
  }
}
