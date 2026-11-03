// Deleting your account (Phase 6). Erases your profile, friend code, decks, settings and the games only you played,
// takes you out of games others logged, leaves your playgroups, and removes your Google sign-in from the app.
// Games you logged with others stay with them (the database never erases a shared game), with your seat as a name.
import { S, uid, H } from './state.js';
import { esc, toast } from './util.js';
import * as D from './data.js';
import { GROUPS } from './groups.js';

const AC = { busy: '', err: '' };
const ownerOf = g => g.owner || g.createdBy;
/** Playgroups you organize that still have other members: hand them on first. */
const blocking = () => GROUPS.groups.filter(g => ownerOf(g) === uid() && (g.members || []).length > 1);
const myGames = () => S.games.filter(g => g.raw);
const solo = () => myGames().filter(g => g.createdBy === uid() && (g.raw.players || []).length === 1);
const sharedMine = () => myGames().filter(g => g.createdBy === uid() && (g.raw.players || []).length > 1);
const theirs = () => myGames().filter(g => g.createdBy && g.createdBy !== uid());

export function viewDelAcct() {
  let h = '<header class="top"><button class="link back" data-act="navback">\u2039 Back</button><h3>Delete account</h3><span style="width:60px"></span></header>';
  if (AC.busy) return h + '<p class="status delstatus">' + esc(AC.busy) + '</p><p class="muted"><small>Keep the app open until this finishes.</small></p>';
  if (D.isOwner(uid())) return h + '<div class="panel"><p style="margin:0">You run the app, so your account can\u2019t be deleted from here.</p></div>';
  if (!S.gamesLoaded || S.games.some(g => g.cached)) return h + '<p class="muted">Loading your games\u2026</p>';
  const block = blocking();
  h += '<div class="panel warnpanel"><p style="margin:0"><b>This can\u2019t be undone.</b> Your account and everything below is removed for good.</p></div><ul class="dellist">' +
    '<li>Your profile, display name and friend code</li><li>Your decks, settings and events</li>' +
    '<li>' + solo().length + (solo().length === 1 ? ' game' : ' games') + ' only you played</li>' +
    (theirs().length ? '<li>You\u2019re taken out of ' + theirs().length + (theirs().length === 1 ? ' game' : ' games') + ' others logged (your seat becomes your name, typed in)</li>' : '') +
    (GROUPS.groups.length ? '<li>You leave ' + GROUPS.groups.length + (GROUPS.groups.length === 1 ? ' playgroup' : ' playgroups') + '</li>' : '') +
    '<li>Your Google sign-in is removed from the app</li></ul>';
  if (sharedMine().length) h += '<p class="muted"><small>' + sharedMine().length + (sharedMine().length === 1 ? ' game you logged with others stays' : ' games you logged with others stay') + ' with them, with your name on your seat.</small></p>';
  if (AC.err) h += '<div class="panel"><p style="margin:0">' + esc(AC.err) + '</p></div>';
  if (block.length) return h + '<div class="panel"><p style="margin:0">First, make someone else the organizer of ' + esc(block.map(g => g.name).join(', ')) + ' (or remove the other members), in Playgroups.</p></div>';
  if (!navigator.onLine) return h + '<p class="muted">You\u2019re offline. Connect to delete your account.</p>';
  return h + '<button class="btn danger" data-act="delgo">Delete my account</button><button class="btn" style="margin-top:8px" data-act="navback">Keep my account</button>';
}

async function run() {
  if (!confirm('Delete your account? This cannot be reversed.')) return;
  const me = uid(), code = (S.profile || {}).code, say = t => { AC.busy = t; const el = document.querySelector('.delstatus'); if (el) el.textContent = t; else H.rerenderKeep(); };
  AC.err = '';
  try {
    say('Leaving your playgroups\u2026');
    for (const g of GROUPS.groups) { if (ownerOf(g) === me) await D.deleteGroup(g); else await D.leaveGroup(g.id, me); }
    for (const j of GROUPS.joins) await D.cancelJoin(me, j.id).catch(() => D.dropJoin(me, j.id).catch(() => {}));
    const out = theirs();
    for (let i = 0; i < out.length; i++) {
      say('Leaving games others logged: ' + (i + 1) + ' of ' + out.length + '\u2026');
      const g = out[i];
      if (!g.accepted) await D.acceptGames(me, [{ id: g.gameId }]);
      const seats = (g.raw.seats || []).map(x => { if (x.uid !== me) return x; const c = Object.assign({}, x, { uid: null, name: x.guestName || x.name }); delete c.guestName; return c; });
      await D.leaveGame(me, g.gameId, g.doc || g.raw, seats);
    }
    const mine = solo();
    for (let i = 0; i < mine.length; i++) { if (i % 10 === 0) say('Erasing your games: ' + (i + 1) + ' of ' + mine.length + '\u2026'); await D.eraseSoloGame(mine[i].gameId); }
    say('Erasing your profile, decks and settings\u2026');
    await D.eraseUserData(me, code);
    say('Removing your sign-in\u2026');
    await D.deleteSignIn();
    try { Object.keys(localStorage).filter(k => /^smb_/.test(k)).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    AC.busy = '';
    toast('Your account was deleted.');
    await D.signOut().catch(() => {});
    H.rerenderKeep();
  } catch (e) {
    AC.busy = ''; AC.err = 'Stopped partway: ' + (e.code || e.message) + '. Try again; it picks up where it stopped.';
    H.rerenderKeep();
  }
}
export function onAccountAct(act) {
  if (act === 'delacct') { AC.err = ''; H.go('delacct'); return true; }
  if (act === 'delgo') { if (!AC.busy) run(); return true; }
  return false;
}
