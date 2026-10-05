/**
 * The playground's IndexedDB key-value store: file and folder handles (fonts folder, recent
 * files) are structured-cloneable, unlike anything localStorage can hold.
 */

const DB = "truedxf-playground";
const STORE = "handles";

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
  try {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    return await new Promise<T>((ok, fail) => {
      req.onsuccess = () => ok(req.result as T);
      req.onerror = () => fail(req.error);
    });
  } finally {
    db.close();
  }
}

/** The stored value, or undefined (also when storage is unavailable: private mode, blocked). */
export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    return await withStore<T | undefined>("readonly", (s) => s.get(key));
  } catch {
    return undefined;
  }
}

/** Stores a value; false when storage is unavailable or the value cannot be cloned. */
export async function idbPut(key: string, value: unknown): Promise<boolean> {
  try {
    await withStore("readwrite", (s) => s.put(value, key));
    return true;
  } catch {
    return false;
  }
}

export async function idbDelete(key: string): Promise<boolean> {
  try {
    await withStore("readwrite", (s) => s.delete(key));
    return true;
  } catch {
    return false;
  }
}
