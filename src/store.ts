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
export const idbSet = (k: string, v: ArrayBuffer): Promise<unknown> => tx('readwrite', (s) => s.put(v, k)).catch(() => undefined)
