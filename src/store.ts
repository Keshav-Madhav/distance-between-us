// Big per-course recordings (your best run's ghost and inputs) in IndexedDB. They outgrew localStorage:
// a few hundred KB a course, and Firefox (Zen) allows ~5 MB per site there — past it every save failed
// silently, best times and settings with them.
const DB = 'dbu', ST = 'runs'
let dbp: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(ST)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  }))
}
function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then((d) => new Promise<T>((res, rej) => { const q = f(d.transaction(ST, mode).objectStore(ST)); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error) }))
}
export const idbGet = (k: string): Promise<ArrayBuffer | undefined> => tx('readonly', (s) => s.get(k)).catch(() => undefined)
/** Resolves true once stored, false if IndexedDB refused (a private window, a quota). */
export const idbSet = (k: string, v: ArrayBuffer): Promise<boolean> => tx('readwrite', (s) => s.put(v, k)).then(() => true, () => false)
/** Any structured-cloneable value (typed arrays and all), under its own key: the gorges' land (src/landjob.ts). */
export const idbGetAny = <T>(k: string): Promise<T | undefined> => tx('readonly', (s) => s.get(k) as IDBRequest<T>).catch(() => undefined)
export const idbSetAny = (k: string, v: unknown): Promise<boolean> => tx('readwrite', (s) => s.put(v, k)).then(() => true, () => false)
/** Remove keys starting with a prefix but not equal to `keep` (old versions of a cache). */
export const idbPrune = (prefix: string, keep: string): Promise<void> => db().then((d) => new Promise<void>((res) => {
  const st = d.transaction(ST, 'readwrite').objectStore(ST), r = st.openKeyCursor()
  r.onsuccess = () => { const c = r.result; if (!c) return res(); const k = String(c.key); if (k.startsWith(prefix) && k !== keep) st.delete(c.key); c.continue() }
  r.onerror = () => res()
})).catch(() => undefined)
