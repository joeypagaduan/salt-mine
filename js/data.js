// Everything that talks to Firebase: sign-in, your profile and friend code, settings, and decks.
// Firestore keeps a copy on the device, so all of this works offline and syncs when you're back online.
import { firebaseConfig, OWNER_UID, OWNER_CODE } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut as fbSignOut }
  from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, setDoc, updateDoc, onSnapshot,
  collection, writeBatch, serverTimestamp, deleteField }
  from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
let db;
try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch (e) { db = initializeFirestore(app, {}); } // private browsing can block the offline copy; still works online

export const isOwner = uid => uid === OWNER_UID;

/* ---------- sign-in ---------- */
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });
export function watchAuth(cb) {
  getRedirectResult(auth).catch(err => cb(null, err));
  return onAuthStateChanged(auth, user => cb(user, null));
}
export async function signIn() {
  try { await signInWithPopup(auth, provider); }
  catch (err) {
    // Popups can be blocked (home screen apps especially); a full-page redirect works there
    if (/popup-blocked|operation-not-supported|web-storage-unsupported/.test(err.code || '')) return signInWithRedirect(auth, provider);
    throw err;
  }
}
export const signOut = () => fbSignOut(auth);

/* ---------- profile and friend code ---------- */
// Friend codes look like "alex-4821": a name part and a number. They never change once claimed.
export function codeBase(name) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'player';
  const base = first.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '').slice(0, 12);
  return /^[a-z]/.test(base) && base.length >= 2 ? base : 'player';
}
export function suggestCode(uid, name) {
  if (isOwner(uid)) return OWNER_CODE;
  return codeBase(name) + '-' + (1000 + Math.floor(Math.random() * 9000));
}
export async function loadProfile(uid) {
  const snap = await getDoc(doc(db, 'profiles', uid));
  return snap.exists() ? snap.data() : null;
}
/**
 * Claims a friend code and creates the profile in one step. Codes are first come, first served,
 * so if the number is taken it tries another.
 */
export async function createProfile(user, name) {
  name = String(name || '').trim().slice(0, 40) || 'Player';
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = attempt === 0 ? suggestCode(user.uid, name) : codeBase(name) + '-' + (1000 + Math.floor(Math.random() * 9000));
    const b = writeBatch(db);
    b.set(doc(db, 'codes', code), { uid: user.uid, createdAt: serverTimestamp() });
    b.set(doc(db, 'profiles', user.uid), { name: name, code: code, photo: user.photoURL || '', createdAt: serverTimestamp() });
    b.set(doc(db, 'users', user.uid), { email: user.email || '', createdAt: serverTimestamp() }, { merge: true });
    try { await b.commit(); return { name: name, code: code, photo: user.photoURL || '' }; }
    catch (err) { lastErr = err; if (isOwner(user.uid)) break; } // the owner's code is reserved; anything else, try a new number
  }
  throw lastErr;
}
export async function renameProfile(uid, name) {
  name = String(name || '').trim().slice(0, 40);
  if (!name) return;
  await updateDoc(doc(db, 'profiles', uid), { name: name });
}

/* ---------- settings ---------- */
const settingsRef = uid => doc(db, 'users', uid, 'meta', 'settings');
export function watchSettings(uid, cb) {
  return onSnapshot(settingsRef(uid), snap => cb(snap.exists() ? snap.data() : {}), () => cb(null));
}
let pending = null, timer = null;
/** Saves settings changes, a moment after the last tap so quick changes become one write. */
export function saveSettings(uid, patch) {
  pending = Object.assign(pending || {}, patch);
  clearTimeout(timer);
  timer = setTimeout(() => { const p = pending; pending = null; setDoc(settingsRef(uid), p, { merge: true }).catch(() => {}); }, 500);
}

/* ---------- decks ---------- */
export function watchDecks(uid, cb) {
  return onSnapshot(collection(db, 'users', uid, 'decks'), snap => cb(snap.docs.map(d => Object.assign({ id: d.id }, d.data()))), () => cb(null));
}
/** Writes many deck changes at once (Firestore allows up to 500 per batch). */
export async function saveDecks(uid, decks) {
  for (let i = 0; i < decks.length; i += 400) {
    const b = writeBatch(db);
    decks.slice(i, i + 400).forEach(d => {
      const data = Object.assign({}, d); delete data.id;
      b.set(doc(db, 'users', uid, 'decks', d.id), data, { merge: true });
    });
    await b.commit();
  }
}
export const saveDeck = (uid, d) => saveDecks(uid, [d]);
export { serverTimestamp, deleteField };
