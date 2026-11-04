// Everything that talks to Firebase: sign-in, your profile and friend code, settings, decks, games, events and the game in progress.
// Firestore keeps a copy on the device, so all of this works offline and syncs when you're back online.
import { firebaseConfig, OWNER_UID, OWNER_CODE } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut as fbSignOut,
  deleteUser, reauthenticateWithPopup }
  from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot,
  collection, writeBatch, serverTimestamp, deleteField, query, where, Timestamp, arrayUnion, arrayRemove }
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

/* ---------- playgroups (Phase 5a) ----------
 * groups/{gid}: { name, createdBy, createdAt, updatedAt, members: [uid], admins: [uid], invite, inviteOn }
 *   Members can read it. The organizer (createdBy, always an admin) changes it; members can only remove themselves.
 * groups/{gid}/requests/{uid}: { uid, name, code, photo, token, at } a request to join, made with a working invite.
 * invites/{token}: { gid, name, byName, on, createdAt } what an invite link shows before you join. Anyone signed in
 *   can open one by its code, but nobody can list them.
 * users/{uid}/joins/{gid}: { gid, name, byName, token, at } your own requests, so you can see what's still waiting.
 */
const INVITE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newInviteCode() {
  const a = new Uint8Array(10); crypto.getRandomValues(a);
  return Array.from(a, n => INVITE_CHARS[n % INVITE_CHARS.length]).join('');
}
const live = d => d.data({ serverTimestamps: 'estimate' });
export function watchGroups(uid, cb, errCb) {
  return onSnapshot(query(collection(db, 'groups'), where('members', 'array-contains', uid)),
    snap => cb(snap.docs.map(d => Object.assign({ id: d.id }, live(d)))), errCb);
}
export function watchRequests(gid, cb, errCb) {
  return onSnapshot(collection(db, 'groups', gid, 'requests'), snap => cb(snap.docs.map(d => Object.assign({ id: d.id }, live(d)))), errCb);
}
export function watchJoins(uid, cb) {
  return onSnapshot(collection(db, 'users', uid, 'joins'), snap => cb(snap.docs.map(d => Object.assign({ id: d.id }, live(d)))), () => {});
}
export async function createGroup(uid, name, byName) {
  const ref = doc(collection(db, 'groups')), token = newInviteCode(), b = writeBatch(db);
  b.set(ref, { name: name, createdBy: uid, owner: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), members: [uid], admins: [uid], invite: token, inviteOn: true });
  b.set(doc(db, 'invites', token), { gid: ref.id, name: name, byName: byName, on: true, createdAt: serverTimestamp() });
  await b.commit();
  return ref.id;
}
export async function renameGroup(g, name) {
  const b = writeBatch(db);
  b.update(doc(db, 'groups', g.id), { name: name, updatedAt: serverTimestamp() });
  if (g.invite) b.set(doc(db, 'invites', g.invite), { name: name }, { merge: true });
  await b.commit();
}
export async function setInviteOn(g, on) {
  const b = writeBatch(db);
  b.update(doc(db, 'groups', g.id), { inviteOn: on, updatedAt: serverTimestamp() });
  if (g.invite) b.set(doc(db, 'invites', g.invite), { on: on }, { merge: true });
  await b.commit();
}
/** A new invite code; the old link stops working. */
export async function newInvite(g, byName) {
  const token = newInviteCode(), b = writeBatch(db);
  if (g.invite) b.delete(doc(db, 'invites', g.invite));
  b.set(doc(db, 'invites', token), { gid: g.id, name: g.name, byName: byName, on: true, createdAt: serverTimestamp() });
  b.update(doc(db, 'groups', g.id), { invite: token, inviteOn: true, updatedAt: serverTimestamp() });
  await b.commit();
}
export async function getInvite(token) {
  const snap = await getDoc(doc(db, 'invites', token));
  return snap.exists() ? Object.assign({ token: token }, snap.data()) : null;
}
export async function requestJoin(uid, profile, inv) {
  const b = writeBatch(db);
  b.set(doc(db, 'groups', inv.gid, 'requests', uid), { uid: uid, name: profile.name, code: profile.code, photo: profile.photo || '', token: inv.token, at: serverTimestamp() });
  b.set(doc(db, 'users', uid, 'joins', inv.gid), { gid: inv.gid, name: inv.name, byName: inv.byName || '', token: inv.token, at: serverTimestamp() });
  await b.commit();
}
/** Whether your request to join is still waiting (false once it's approved or declined). */
export async function requestWaiting(gid, uid) {
  const snap = await getDoc(doc(db, 'groups', gid, 'requests', uid));
  return snap.exists();
}
export async function cancelJoin(uid, gid) {
  const b = writeBatch(db);
  b.delete(doc(db, 'groups', gid, 'requests', uid));
  b.delete(doc(db, 'users', uid, 'joins', gid));
  await b.commit();
}
export function dropJoin(uid, gid) { return writeBatch(db).delete(doc(db, 'users', uid, 'joins', gid)).commit(); }
export async function approveRequest(gid, who) {
  const b = writeBatch(db);
  b.update(doc(db, 'groups', gid), { members: arrayUnion(who), updatedAt: serverTimestamp() });
  b.delete(doc(db, 'groups', gid, 'requests', who));
  await b.commit();
}
export function declineRequest(gid, who) { return writeBatch(db).delete(doc(db, 'groups', gid, 'requests', who)).commit(); }
/** Removes someone (or yourself, to leave). */
export function removeMember(gid, who) {
  return updateDoc(doc(db, 'groups', gid), { members: arrayRemove(who), admins: arrayRemove(who), updatedAt: serverTimestamp() });
}
export async function leaveGroup(gid, who) {
  return updateDoc(doc(db, 'groups', gid), { members: arrayRemove(who), updatedAt: serverTimestamp() });
}
export async function deleteGroup(g) {
  const b = writeBatch(db);
  if (g.invite) b.delete(doc(db, 'invites', g.invite));
  b.delete(doc(db, 'groups', g.id));
  await b.commit();
}
/** Public profiles (name, friend code, photo) for the people in your playgroups. */
export async function loadProfiles(uids) {
  const out = {};
  await Promise.all(uids.map(u => getDoc(doc(db, 'profiles', u)).then(s => { if (s.exists()) out[u] = s.data(); }).catch(() => {})));
  return out;
}

/** Hands the organizer role to another member (only the organizer can). The invite's "organized by" changes first. */
export async function transferGroup(g, to, toName) {
  if (g.invite) await setDoc(doc(db, 'invites', g.invite), { byName: toName }, { merge: true });
  await updateDoc(doc(db, 'groups', g.id), { owner: to, admins: [to], updatedAt: serverTimestamp() });
}

/* ---------- shared games (Phase 5b) ----------
 * games/{id} also has: declined {uid: true}, linkedUid and linkVia (the last person linked, and the playgroup you share).
 * A linked seat keeps the name it was typed in as, in guestName.
 */
/** Adds playgroup-mates to a game, one at a time (the rules check each one). links: [{ uid, via }] */
export function linkPlayers(uid, id, links, errCb) {
  links.forEach(l => updateDoc(doc(db, 'games', id), { players: arrayUnion(l.uid), linkedUid: l.uid, linkVia: l.via, updatedAt: serverTimestamp(), updatedBy: uid }).catch(onErr(errCb)));
}
/** Accepting games someone else logged. items: [{ id, seats? }] (seats when you tagged your deck). */
export async function acceptGames(uid, items) {
  for (let i = 0; i < items.length; i += 300) {
    const b = writeBatch(db);
    items.slice(i, i + 300).forEach(it => {
      const patch = { ['accepted.' + uid]: true, ['declined.' + uid]: deleteField(), updatedAt: serverTimestamp() };
      if (it.seats) patch.seats = it.seats;
      b.update(doc(db, 'games', it.id), patch);
    });
    await b.commit();
  }
}
export async function declineGames(uid, ids) {
  for (let i = 0; i < ids.length; i += 300) {
    const b = writeBatch(db);
    ids.slice(i, i + 300).forEach(id => b.update(doc(db, 'games', id), { ['declined.' + uid]: true, ['accepted.' + uid]: deleteField(), updatedAt: serverTimestamp() }));
    await b.commit();
  }
}
/** "That wasn't me": your seat goes back to a typed-in name, and the game leaves your list. */
export async function leaveGame(uid, id, prev, seats) {
  // not an edit to the game itself, so it doesn't show as "Edited by" you
  const b = writeBatch(db);
  b.set(doc(collection(db, 'games', id, 'history')), { savedAt: serverTimestamp(), savedBy: uid, why: 'leave', data: prev });
  b.update(doc(db, 'games', id), { seats: seats, players: arrayRemove(uid), ['accepted.' + uid]: deleteField(), ['declined.' + uid]: deleteField(), updatedAt: serverTimestamp() });
  await b.commit();
}
/** Links a typed-in name to a playgroup-mate across many games. items: [{ id, prev, seats }] */
export async function linkGuestGames(uid, to, via, items, onProgress) {
  let done = 0;
  for (let i = 0; i < items.length; i += 150) {
    const b = writeBatch(db), chunk = items.slice(i, i + 150);
    chunk.forEach(it => historyAndUpdate(b, uid, it.id, it.prev, { seats: it.seats, players: arrayUnion(to), linkedUid: to, linkVia: via }, 'link'));
    await b.commit();
    done += chunk.length; if (onProgress) onProgress(done);
  }
}

/* ---------- owner controls (Phase 5c): only the app's owner can read history; lock and restore are owner-only in the app ---------- */
export async function loadHistory(id) {
  const snap = await getDocs(collection(db, 'games', id, 'history'));
  return snap.docs.map(d => Object.assign({ id: d.id }, d.data({ serverTimestamps: 'estimate' })));
}
const CONTENT = ['schema', 'date', 'format', 'set', 'startLife', 'bo3', 'matchScore', 'playDraw', 'eventId', 'podSize', 'turns', 'winCondition', 'winOther', 'draw', 'notes', 'seats'];
/** Puts a game back the way an earlier version had it (who played stays as it is now). */
export async function restoreVersion(uid, id, prev, old) {
  const patch = {};
  CONTENT.forEach(f => { patch[f] = old[f] === undefined ? null : old[f]; });
  patch.deleted = !!old.deleted;
  const b = writeBatch(db);
  historyAndUpdate(b, uid, id, prev, patch, 'restore');
  await b.commit();
}
export async function undeleteGame(uid, id, prev) {
  const b = writeBatch(db);
  historyAndUpdate(b, uid, id, prev, { deleted: false, deletedAt: deleteField() }, 'restore');
  await b.commit();
}
export async function setLocked(uid, id, prev, locked) {
  // not an edit to the game itself, so it doesn't show as "Edited by"
  const b = writeBatch(db);
  b.set(doc(collection(db, 'games', id, 'history')), { savedAt: serverTimestamp(), savedBy: uid, why: locked ? 'lock' : 'unlock', data: prev });
  b.update(doc(db, 'games', id), { locked: !!locked, updatedAt: serverTimestamp() });
  await b.commit();
}

/** When you last opened the app and which version (for the owner's dashboard). Merged, so nothing else on users/{uid} changes. */
export function touchSeen(uid, version) {
  return setDoc(doc(db, 'users', uid), { lastSeen: serverTimestamp(), appVersion: version }, { merge: true });
}
/* ---------- deleting your account (Phase 6) ---------- */
async function deleteAll(paths) {
  for (let i = 0; i < paths.length; i += 400) {
    const b = writeBatch(db);
    paths.slice(i, i + 400).forEach(p => b.delete(doc(db, ...p)));
    await b.commit();
  }
}
const idsIn = async path => (await getDocs(collection(db, ...path))).docs.map(d => d.id);
/** A game only you played: its history first, then the game itself. */
export async function eraseSoloGame(id) {
  const hist = await idsIn(['games', id, 'history']);
  await deleteAll(hist.map(h => ['games', id, 'history', h]).concat([['games', id]]));
}
/** Everything under users/{uid} (settings, game in progress, decks, events, join requests), then your profile and friend code. */
export async function eraseUserData(uid, code) {
  const paths = [['users', uid, 'meta', 'settings'], ['users', uid, 'meta', 'draft']];
  for (const sub of ['decks', 'events', 'joins']) (await idsIn(['users', uid, sub])).forEach(id => paths.push(['users', uid, sub, id]));
  paths.push(['users', uid]);
  await deleteAll(paths);
  const b = writeBatch(db);
  b.delete(doc(db, 'profiles', uid));
  if (code) b.delete(doc(db, 'codes', code));
  await b.commit();
}
/** Removes the Google sign-in from the app. Google may ask you to sign in once more first. */
export async function deleteSignIn() {
  const u = auth.currentUser;
  if (!u) return;
  try { await deleteUser(u); }
  catch (e) {
    if (e && e.code === 'auth/requires-recent-login') { await reauthenticateWithPopup(u, provider); await deleteUser(u); }
    else throw e;
  }
}
