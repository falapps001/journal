// Local persistence: one IndexedDB key-value store, with localStorage as a fallback.
const DB = 'daybook';
const ST = 'kv';
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(ST);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbp;
}

function tx(mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(ST, mode);
    const req = fn(t.objectStore(ST));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export async function loadState() {
  try {
    const v = await tx('readonly', s => s.get('state'));
    if (v) return v;
  } catch (e) { /* fall through */ }
  try {
    const s = localStorage.getItem('daybook-state');
    return s ? JSON.parse(s) : null;
  } catch (e) { return null; }
}

export async function saveState(state) {
  const plain = JSON.parse(JSON.stringify(state));
  try {
    await tx('readwrite', s => s.put(plain, 'state'));
  } catch (e) {
    try { localStorage.setItem('daybook-state', JSON.stringify(plain)); } catch (_) { /* storage full or blocked */ }
  }
}

export async function clearState() {
  try { await tx('readwrite', s => s.delete('state')); } catch (e) { /* ignore */ }
  try { localStorage.removeItem('daybook-state'); } catch (e) { /* ignore */ }
}

// Ask the browser not to evict our data when storage is low.
export async function askPersistent() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch (e) { /* not supported */ }
}
