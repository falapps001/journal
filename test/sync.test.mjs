import test from 'node:test';
import assert from 'node:assert/strict';
import { syncNow, emptyDirty, emptyTomb, SERVER_TS, isDirty, touch, removeRecord, touchProfile } from '../src/sync-core.js';

// In-memory stand-in for Firestore: each write replaces the whole document.
function fakeBackend() {
  const docs = {};
  let clock = 1000;
  return {
    docs,
    fail: false,
    async get(p) { return docs[p] ? structuredClone(docs[p]) : null; },
    async since(kind, ms) {
      return Object.keys(docs).filter(p => p.startsWith(kind + '/') && docs[p].u >= ms)
        .map(p => ({ id: p.slice(kind.length + 1), ...structuredClone(docs[p]) }));
    },
    async commit(writes) {
      if (this.fail) { const e = new Error('offline'); e.code = 'unavailable'; throw e; }
      for (const w of writes) {
        const data = structuredClone(w.data);
        for (const k in data) if (data[k] === SERVER_TS) data[k] = Date.now() + (clock++);
        docs[w.path] = data;
      }
    },
    async devices() { return Object.keys(docs).filter(p => p.startsWith('devices/')).map(p => ({ id: p.slice(8), ...docs[p] })); }
  };
}

const state = () => ({ entries: [], cats: [{ id: 'work', name: 'Work', c: '--c-work', tpl: '', archived: false, mt: 0 }], milestones: [],
  birth: null, lifeYears: 90, profileMt: 0, tomb: emptyTomb(), dirty: emptyDirty(), sync: { lastPull: 0 } });
const dev = id => ({ id, name: id, kind: 'phone' });
const addEntry = (S, id, title, extra = {}) => { const e = { id, ts: Date.now(), cat: 'work', title, body: '', tags: [], ...extra }; S.entries.push(e); touch(S, 'entries', e); return e; };
const wait = () => new Promise(r => setTimeout(r, 3));

test('two devices exchange entries, categories, milestones and profile', async () => {
  const be = fakeBackend();
  const A = state(), B = state();
  addEntry(A, 'e1', 'First day', { tags: ['knee'] });
  const c = { id: 'c1', name: 'Travel', c: '--c-sky', tpl: 'Where:', archived: false }; A.cats.push(c); touch(A, 'cats', c);
  const m = { id: 'm1', date: '2016-08-15', title: 'First job', type: 'career', note: '' }; A.milestones.push(m); touch(A, 'milestones', m);
  A.birth = '1994-03-12'; A.lifeYears = 89; touchProfile(A);
  await syncNow(A, be, dev('A'));
  assert.equal(isDirty(A), false);
  const r = await syncNow(B, be, dev('B'));
  assert.equal(B.entries[0].title, 'First day');
  assert.deepEqual(B.entries[0].tags, ['knee']);
  assert.ok(B.cats.find(x => x.id === 'c1' && x.tpl === 'Where:'));
  assert.equal(B.milestones[0].title, 'First job');
  assert.equal(B.birth, '1994-03-12');
  assert.equal(B.lifeYears, 89);
  assert.equal(r.devices.length, 2);
});

test('edits to different entries on two devices both survive', async () => {
  const be = fakeBackend();
  const A = state(), B = state();
  addEntry(A, 'e1', 'one'); addEntry(A, 'e2', 'two');
  await syncNow(A, be, dev('A')); await syncNow(B, be, dev('B'));
  await wait();
  const a1 = A.entries.find(e => e.id === 'e1'); a1.title = 'one (A)'; touch(A, 'entries', a1);
  const b2 = B.entries.find(e => e.id === 'e2'); b2.title = 'two (B)'; touch(B, 'entries', b2);
  await syncNow(A, be, dev('A')); await syncNow(B, be, dev('B')); await syncNow(A, be, dev('A'));
  for (const S of [A, B]) {
    assert.equal(S.entries.find(e => e.id === 'e1').title, 'one (A)');
    assert.equal(S.entries.find(e => e.id === 'e2').title, 'two (B)');
  }
});

test('the newest edit of the same entry wins', async () => {
  const be = fakeBackend();
  const A = state(), B = state();
  addEntry(A, 'e1', 'v1');
  await syncNow(A, be, dev('A')); await syncNow(B, be, dev('B'));
  await wait();
  const a = A.entries[0]; a.title = 'older'; touch(A, 'entries', a);
  await wait();
  const b = B.entries[0]; b.title = 'newer'; touch(B, 'entries', b);
  await syncNow(B, be, dev('B')); await syncNow(A, be, dev('A')); await syncNow(B, be, dev('B'));
  assert.equal(A.entries[0].title, 'newer');
  assert.equal(B.entries[0].title, 'newer');
});

test('deleting an entry or category reaches the other device', async () => {
  const be = fakeBackend();
  const A = state(), B = state();
  addEntry(A, 'e1', 'to delete');
  const c = { id: 'c1', name: 'Old', c: '--c-slate', tpl: '', archived: false }; A.cats.push(c); touch(A, 'cats', c);
  await syncNow(A, be, dev('A')); await syncNow(B, be, dev('B'));
  assert.equal(B.entries.length, 1);
  await wait();
  removeRecord(B, 'entries', 'e1'); removeRecord(B, 'cats', 'c1');
  await syncNow(B, be, dev('B')); await syncNow(A, be, dev('A'));
  assert.equal(A.entries.length, 0);
  assert.equal(A.cats.find(x => x.id === 'c1'), undefined);
  // a later sync does not bring it back
  await syncNow(A, be, dev('A'));
  assert.equal(A.entries.length, 0);
});

test('archiving a category syncs', async () => {
  const be = fakeBackend();
  const A = state(), B = state();
  await wait();
  const w = A.cats[0]; w.archived = true; touch(A, 'cats', w);
  await syncNow(A, be, dev('A')); await syncNow(B, be, dev('B'));
  assert.equal(B.cats[0].archived, true);
});

test('a failed upload keeps the changes queued', async () => {
  const be = fakeBackend();
  const A = state();
  addEntry(A, 'e1', 'offline entry');
  be.fail = true;
  await assert.rejects(syncNow(A, be, dev('A')));
  assert.equal(isDirty(A), true);
  be.fail = false;
  await syncNow(A, be, dev('A'));
  assert.equal(isDirty(A), false);
  assert.equal(be.docs['entries/e1'].title, 'offline entry');
});

test('a removed device is told to sign out', async () => {
  const be = fakeBackend();
  const A = state();
  be.docs['meta/revoked'] = { ids: { A: Date.now() } };
  const r = await syncNow(A, be, dev('A'));
  assert.equal(r.revoked, true);
});

test('only changed records are downloaded after the first sync', async () => {
  const be = fakeBackend();
  const A = state(), B = state();
  for (let i = 0; i < 5; i++) addEntry(A, 'e' + i, 'entry ' + i);
  await syncNow(A, be, dev('A')); await syncNow(B, be, dev('B'));
  let seen = 0; const orig = be.since.bind(be);
  be.since = async (k, ms) => { const r = await orig(k, ms); if (k === 'entries') seen = r.length; return r; };
  B.sync.lastPull = Date.now() + 11 * 60 * 1000; // pretend the last pull was after everything above
  await syncNow(B, be, dev('B'));
  assert.equal(seen, 0);
});
