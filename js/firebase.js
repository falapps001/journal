// Firebase sign-in + Firestore backend. Loaded lazily so the app opens fast and works offline.
import { firebaseConfig } from './firebase-config.js';
import { SERVER_TS } from './sync-core.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.6.0/';
export const configured = !!firebaseConfig.apiKey;
let mods = null;

async function fb() {
  if (mods) return mods;
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore-lite.js')
  ]);
  const cfg = { ...firebaseConfig };
  // On Firebase Hosting, sign in through the app's own domain so redirects also work on iPhone/Safari.
  if (typeof location !== 'undefined' && /\.(web\.app|firebaseapp\.com)$/.test(location.hostname)) cfg.authDomain = location.hostname;
  const app = initializeApp(cfg);
  mods = { auth, fs, a: auth.getAuth(app), db: fs.getFirestore(app) };
  return mods;
}

const userInfo = u => (u ? { uid: u.uid, email: u.email || u.displayName || 'Signed in' } : null);

// Resolves the signed-in user (also finishes a pending redirect sign-in).
export async function currentUser() {
  if (!configured) return null;
  const m = await fb();
  try { await m.auth.getRedirectResult(m.a); } catch (e) { /* no redirect pending */ }
  await m.a.authStateReady();
  return userInfo(m.a.currentUser);
}

export async function signIn() {
  const m = await fb();
  const provider = new m.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const r = await m.auth.signInWithPopup(m.a, provider);
    return userInfo(r.user);
  } catch (e) {
    if (e && e.code === 'auth/operation-not-supported-in-this-environment') {
      await m.auth.signInWithRedirect(m.a, provider);
      return null;
    }
    throw e;
  }
}

export async function signOutUser() {
  const m = await fb();
  await m.auth.signOut(m.a);
}

export async function backend(uid) {
  const m = await fb();
  const { doc, getDoc, getDocs, collection, query, where, writeBatch, serverTimestamp, Timestamp, deleteDoc, setDoc } = m.fs;
  const ref = p => doc(m.db, `users/${uid}/${p}`);
  const col = p => collection(m.db, `users/${uid}/${p}`);
  const fix = data => {
    const o = { ...data };
    for (const k in o) if (o[k] === SERVER_TS) o[k] = serverTimestamp();
    return o;
  };
  return {
    async get(path) {
      const s = await getDoc(ref(path));
      return s.exists() ? s.data() : null;
    },
    // Records of one kind changed since the given time (all of them when ms is 0).
    async since(kind, ms) {
      const q = ms ? query(col(kind), where('u', '>=', Timestamp.fromMillis(ms))) : col(kind);
      const r = await getDocs(q);
      return r.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    async commit(writes) {
      for (let i = 0; i < writes.length; i += 400) {
        const b = writeBatch(m.db);
        writes.slice(i, i + 400).forEach(w => b.set(ref(w.path), fix(w.data)));
        await b.commit();
      }
    },
    async devices() {
      const r = await getDocs(col('devices'));
      return r.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    // Removes the device from the list and signs it out the next time it opens Daybook.
    async removeDevice(id) {
      await setDoc(ref('meta/revoked'), { ids: { [id]: Date.now() } }, { merge: true });
      await deleteDoc(ref(`devices/${id}`));
    }
  };
}
