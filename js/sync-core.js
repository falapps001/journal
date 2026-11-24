// Sync logic, independent of Firebase so it can be tested with a fake backend.
//
// Remote layout (all under users/{uid}/):
//   entries/{id}     { id, ts, cat, title, body, tags, mt, deleted, u }
//   cats/{id}        { id, name, c, tpl, archived, mt, deleted, u }
//   milestones/{id}  { id, date, title, type, note, mt, deleted, u }
//   meta/profile     { birth, lifeYears, mt }
//   meta/revoked     { ids: { [deviceId]: removedAtMs } }
//   devices/{id}     { name, kind, last }
//
// Every record carries "mt", the time it was last changed (ms). The newest version wins per
// record, so two devices can edit different entries without overwriting each other.
// Deletions are kept as small "deleted" records so they reach the other devices too.
// "u" is the server time of the last write; it lets a sync download only what changed.

export const SERVER_TS = '__SERVER_TS__';
export const KINDS = ['entries', 'cats', 'milestones'];
const MARGIN = 10 * 60 * 1000; // re-read 10 minutes of overlap to absorb clock differences

export const emptyDirty = () => ({ entries: {}, cats: {}, milestones: {}, profile: false });
export const emptyTomb = () => ({ entries: {}, cats: {}, milestones: {} });

export function isDirty(S) {
  const d = S.dirty;
  return !!(d && (d.profile || KINDS.some(k => Object.keys(d[k] || {}).length)));
}

const clean = o => JSON.parse(JSON.stringify(o));

// Mark a record as changed so the next sync uploads it.
export function touch(S, kind, obj) {
  obj.mt = Math.max(Date.now(), (obj.mt || 0) + 1);
  S.dirty[kind][obj.id] = 1;
  delete S.tomb[kind][obj.id];
}

// Delete a record locally and remember the deletion for the other devices.
export function removeRecord(S, kind, id) {
  S[kind] = S[kind].filter(x => x.id !== id);
  S.tomb[kind][id] = Date.now();
  S.dirty[kind][id] = 1;
}

export function touchProfile(S) {
  S.profileMt = Math.max(Date.now(), (S.profileMt || 0) + 1);
  S.dirty.profile = true;
}

// Fields stored for each kind; anything else on the object stays local.
const FIELDS = {
  entries: o => ({ id: o.id, ts: o.ts, cat: o.cat ?? null, title: o.title || '', body: o.body || '', tags: Array.isArray(o.tags) ? o.tags : [], mt: o.mt || 0 }),
  cats: o => ({ id: o.id, name: o.name || '', c: o.c || '--c-work', tpl: o.tpl || '', archived: !!o.archived, mt: o.mt || 0 }),
  milestones: o => ({ id: o.id, date: o.date, title: o.title || '', type: o.type || 'career', note: o.note || '', mt: o.mt || 0 })
};
export const pick = (kind, o) => FIELDS[kind](o);

export function mergeDocs(S, kind, docs) {
  for (const d of docs || []) {
    if (!d || !d.id) continue;
    const i = S[kind].findIndex(x => x.id === d.id);
    const localMt = Math.max(i >= 0 ? S[kind][i].mt || 0 : 0, S.tomb[kind][d.id] || 0);
    if ((d.mt || 0) <= localMt) continue; // ours is the same or newer
    if (d.deleted) {
      if (i >= 0) S[kind].splice(i, 1);
      S.tomb[kind][d.id] = d.mt || 0;
    } else {
      const obj = clean(pick(kind, d));
      if (i >= 0) S[kind][i] = Object.assign(S[kind][i], obj); else S[kind].push(obj);
      delete S.tomb[kind][d.id];
    }
    delete S.dirty[kind][d.id];
  }
}

export function mergeProfile(S, p) {
  if (!p || (p.mt || 0) <= (S.profileMt || 0)) return;
  S.birth = p.birth || null;
  S.lifeYears = p.lifeYears || 90;
  S.profileMt = p.mt;
  S.dirty.profile = false;
}

export function buildWrites(S, dirty) {
  const writes = [];
  for (const kind of KINDS) {
    for (const id in dirty[kind] || {}) {
      const obj = S[kind].find(x => x.id === id);
      if (obj) writes.push({ path: `${kind}/${id}`, data: { ...pick(kind, obj), deleted: false, u: SERVER_TS } });
      else if (S.tomb[kind][id]) writes.push({ path: `${kind}/${id}`, data: { id, deleted: true, mt: S.tomb[kind][id], u: SERVER_TS } });
    }
  }
  if (dirty.profile) writes.push({ path: 'meta/profile', data: { birth: S.birth || null, lifeYears: S.lifeYears || 90, mt: S.profileMt || Date.now() } });
  return writes;
}

function restoreDirty(S, d) {
  for (const kind of KINDS) for (const id in d[kind] || {}) S.dirty[kind][id] = 1;
  if (d.profile) S.dirty.profile = true;
}

// backend: { get(path), since(kind, ms), commit(writes), devices() }
// Returns { revoked: true } when this device was removed from another device.
export async function syncNow(S, be, device) {
  const started = Date.now();
  const revoked = await be.get('meta/revoked');
  if (revoked && revoked.ids && revoked.ids[device.id]) return { revoked: true };

  mergeProfile(S, await be.get('meta/profile'));
  const since = S.sync.lastPull ? S.sync.lastPull - MARGIN : 0;
  for (const kind of KINDS) mergeDocs(S, kind, await be.since(kind, since));

  // Take the pending changes now; anything changed while we upload stays queued.
  const pending = S.dirty;
  S.dirty = emptyDirty();
  const writes = buildWrites(S, pending);
  writes.push({ path: `devices/${device.id}`, data: { name: device.name, kind: device.kind, last: Date.now() } });
  try {
    await be.commit(writes);
  } catch (e) {
    restoreDirty(S, pending);
    throw e;
  }
  S.sync.lastPull = started;
  S.sync.lastSync = Date.now();
  return { pushed: writes.length - 1, devices: await be.devices() };
}
