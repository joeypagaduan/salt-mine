// Everything that talks to Firebase: sign-in, your profile and friend code, settings, decks, games, events and the game in progress.
// Firestore keeps a copy on the device, so all of this works offline and syncs when you're back online.
import { firebaseConfig, OWNER_UID, OWNER_CODE } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut as fbSignOut }
  from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, setDoc, updateDoc, onSnapshot,
  collection, writeBatch, serverTimestamp, deleteField, query, where, Timestamp }
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
/** Changes made on this device that haven't been sent yet (so a sync from the database doesn't undo them). */
export const pendingSettings = () => Object.assign({}, pending || {});
/** Saves settings changes, a moment after the last tap so quick changes become one write. */
export function saveSettings(uid, patch) {
  pending = Object.assign(pending || {}, patch);
  clearTimeout(timer);
  timer = setTimeout(() => flushSettings(uid), 500);
}
/** Sends any settings changes still waiting (when the app is being closed or put in the background). */
export function flushSettings(uid) {
  clearTimeout(timer);
  if (!pending || !uid) return;
  const p = pending; pending = null;
  setDoc(settingsRef(uid), p, { merge: true }).catch(() => {});
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

/* ---------- games ---------- */
// One record per game in the top-level "games" collection, readable by the accounts in its players list.
// Writes return right away and sync in the background: offline, they wait on the device until there's a connection.
const onErr = cb => err => { if (cb) cb(err); };
export function watchGames(uid, cb, errCb) {
  return onSnapshot(query(collection(db, 'games'), where('players', 'array-contains', uid)), { includeMetadataChanges: true },
    snap => cb(snap.docs.map(d => ({ id: d.id, data: d.data({ serverTimestamps: 'estimate' }), raw: d.data(), pending: d.metadata.hasPendingWrites }))),
    onErr(errCb));
}
/** A new game. Its ID comes from the draft, so saving the same game twice (say, from two devices) can't make two copies. */
export function createGame(uid, id, rec, errCb) {
  const data = Object.assign({}, rec, {
    createdBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: uid,
    players: [uid], accepted: { [uid]: true }, deleted: false, locked: false
  });
  setDoc(doc(db, 'games', id), data).catch(onErr(errCb));
}
/** Saves a copy of the game as it was (its history), then the changes, in one step. */
function historyAndUpdate(b, uid, id, prev, patch, why) {
  b.set(doc(collection(db, 'games', id, 'history')), { savedAt: serverTimestamp(), savedBy: uid, why: why, data: prev });
  b.update(doc(db, 'games', id), Object.assign({}, patch, { updatedAt: serverTimestamp(), updatedBy: uid }));
}
export function updateGame(uid, id, prev, rec, errCb) {
  const b = writeBatch(db);
  historyAndUpdate(b, uid, id, prev, rec, 'edit');
  b.commit().catch(onErr(errCb));
}
/** "Deleting" hides a game. It's kept (with its history) so the app's owner can restore it. */
export function hideGames(uid, items, errCb) {
  for (let i = 0; i < items.length; i += 200) {
    const b = writeBatch(db);
    items.slice(i, i + 200).forEach(it => historyAndUpdate(b, uid, it.id, it.prev, { deleted: true, deletedAt: serverTimestamp() }, 'delete'));
    b.commit().catch(onErr(errCb));
  }
}

/**
 * Games imported from classic (Phase 4), a batch at a time, waiting for each to reach the database.
 * New ones (no prev) are created with the classic game's created time, so games from the same day stay in order.
 * Ones fixed in classic (prev set) are updated, keeping the version before in the game's history.
 * items: [{ id, rec, source, created?, prev? }]
 */
export async function importGames(uid, items, onProgress) {
  let done = 0;
  for (let i = 0; i < items.length; i += 150) {
    const b = writeBatch(db), chunk = items.slice(i, i + 150);
    chunk.forEach(it => {
      const meta = { source: it.source, importedAt: serverTimestamp() };
      if (it.prev) historyAndUpdate(b, uid, it.id, it.prev, Object.assign({}, it.rec, meta), 'import');
      else b.set(doc(db, 'games', it.id), Object.assign({}, it.rec, meta, {
        createdBy: uid, createdAt: Timestamp.fromMillis(it.created || Date.now()), updatedAt: serverTimestamp(), updatedBy: uid,
        players: [uid], accepted: { [uid]: true }, deleted: false, locked: false
      }));
    });
    await b.commit();
    done += chunk.length;
    if (onProgress) onProgress(done);
  }
}
/** Events (prereleases) from classic, keeping their classic IDs so their games find them. */
export async function importEvents(uid, events) {
  const b = writeBatch(db);
  events.forEach(e => b.set(doc(db, 'users', uid, 'events', e.id), { date: e.date, format: e.format, set: e.set, store: e.store, colors: e.colors,
    status: e.status, createdAt: e.created ? Timestamp.fromMillis(e.created) : serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true }));
  await b.commit();
}

/* ---------- events (prereleases) ---------- */
export function watchEvents(uid, cb) {
  return onSnapshot(collection(db, 'users', uid, 'events'), snap => cb(snap.docs.map(d => Object.assign({ id: d.id }, d.data()))), () => cb(null));
}
export function saveEvent(uid, id, data) {
  return setDoc(doc(db, 'users', uid, 'events', id), Object.assign({}, data, { updatedAt: serverTimestamp() }), { merge: true }).catch(() => {});
}

/* ---------- the game in progress ---------- */
// Kept as one text field so a long game's life history (Phase 2b) fits without reshaping it for the database.
const draftRef = uid => doc(db, 'users', uid, 'meta', 'draft');
export function watchDraft(uid, cb) {
  return onSnapshot(draftRef(uid), snap => {
    if (!snap.exists()) return cb({ data: null });
    const v = snap.data();
    let data = null;
    try { data = v.data ? JSON.parse(v.data) : null; } catch (e) { data = null; }
    cb({ data: data, clearedId: v.clearedId || '', at: v.at || 0, pending: snap.metadata.hasPendingWrites });
  }, () => {});
}
export function pushDraft(uid, draft) {
  return setDoc(draftRef(uid), { data: JSON.stringify(draft), at: draft.updatedAt || Date.now(), clearedId: '' }).catch(() => {});
}
/** Clears the game in progress everywhere, noting which one, so other devices drop that one and nothing newer. */
export function clearDraft(uid, id) {
  return setDoc(draftRef(uid), { data: '', at: Date.now(), clearedId: id || '' }).catch(() => {});
}

export { serverTimestamp, deleteField };
