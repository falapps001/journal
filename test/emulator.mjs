// Integration test against the Firebase emulators, including firestore.rules.
// Run with: firebase emulators:exec --only auth,firestore --project demo-daybook "node test/emulator.mjs"
import assert from 'node:assert/strict';
import { useEmulator, backend } from '../src/firebase.js';
import { syncNow, emptyDirty, emptyTomb, touch, removeRecord } from '../src/sync-core.js';
import { getAuth, signInWithCredential, GoogleAuthProvider, signOut } from 'firebase/auth';

useEmulator({ apiKey: 'demo-key', projectId: 'demo-daybook', authDomain: 'demo-daybook.firebaseapp.com', appId: 'demo' });
await backend('warmup'); // initializes the app inside firebase.js
const login = sub => signInWithCredential(getAuth(), GoogleAuthProvider.credential(JSON.stringify({ sub, email: sub + '@example.com' })));
const state = () => ({ entries: [], cats: [], milestones: [], birth: null, lifeYears: 90, profileMt: 0, tomb: emptyTomb(), dirty: emptyDirty(), sync: { lastPull: 0 } });

const uid = (await login('user-a')).user.uid;
const be = await backend(uid);
const A = state(), B = state();
const e = { id: 'e1', ts: Date.now(), cat: 'work', title: 'Hello from the laptop', body: 'Blood pressure 118/76', tags: ['health'] };
A.entries.push(e); touch(A, 'entries', e);
await syncNow(A, be, { id: 'devA', name: 'Laptop', kind: 'laptop' });
const r = await syncNow(B, be, { id: 'devB', name: 'Phone', kind: 'phone' });
assert.equal(B.entries[0].title, 'Hello from the laptop');
assert.deepEqual(B.entries[0].tags, ['health']);
assert.equal(r.devices.length, 2);

// incremental pull + deletion
await new Promise(res => setTimeout(res, 20));
removeRecord(B, 'entries', 'e1');
await syncNow(B, be, { id: 'devB', name: 'Phone', kind: 'phone' });
await syncNow(A, be, { id: 'devA', name: 'Laptop', kind: 'laptop' });
assert.equal(A.entries.length, 0);

// removing a device signs it out on its next sync
await be.removeDevice('devB');
assert.equal((await be.devices()).length, 1);
assert.equal((await syncNow(B, be, { id: 'devB', name: 'Phone', kind: 'phone' })).revoked, true);

// security rules: another account cannot read user A's journal
await signOut(getAuth());
await login('user-b');
const other = await backend(uid);
await assert.rejects(other.get('meta/profile'), err => String(err.code).includes('permission-denied'));
await assert.rejects(other.since('entries', 0), err => String(err.code).includes('permission-denied'));
const mine = await backend(getAuth().currentUser.uid);
assert.equal((await mine.since('entries', 0)).length, 0);

// signed-out visitors cannot read anything
await signOut(getAuth());
await assert.rejects((await backend(uid)).get('meta/profile'), err => String(err.code).includes('permission-denied'));
console.log('emulator integration: all checks passed');
process.exit(0);
