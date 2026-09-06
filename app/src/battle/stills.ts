/*
 * Lock-in stills, client-side only (master prompt C4/C5): each locked
 * battle's 1024×1024 PNG goes into IndexedDB under the pool id, and the
 * Profile's My Blots grid reads the same store. NOTHING here touches the
 * network — a still is a readable projection of the allocation, so it is
 * treated exactly like the allocation itself: on this device until the
 * pool closes. The sealed payload's own encryption flow is untouched.
 *
 * Every operation is best-effort: a browser that refuses IndexedDB
 * (private mode) costs the montage and the gallery, never the seal.
 */

import type { Allocation } from './allocation';

const DB_NAME = 'blotto-blots';
const STORE = 'stills';

export interface StoredStill {
  /** `${pool}:${battle}` — one row per locked battle per pool. */
  key: string;
  pool: string;
  battle: number; // 1-based
  allocation: Allocation;
  png: Blob;
  lockedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('pool', 'pool');
      }
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

export async function stillsForPool(pool: string): Promise<StoredStill[]> {
  try {
    const db = await openDb();
    const rows = await new Promise<StoredStill[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).index('pool').getAll(pool);
      req.onsuccess = () => resolve(req.result as StoredStill[]);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
    });
    db.close();
    return rows.sort((a, b) => a.battle - b.battle);
  } catch {
    return [];
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
