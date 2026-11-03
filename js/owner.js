// Owner controls (Phase 5c), for the app's owner only: a game's edit history with restore, locking a game so only
// the owner can change it, and bringing back deleted games. The database rules enforce the same: only the owner can
// read history, lock or unlock, and change a locked game.
import { S, uid, H } from './state.js';
import { esc, toast } from './util.js';
import * as D from './data.js';
import { niceDate, ordinal, shortCmd } from './game.js';

const OW = { id: null, list: null, err: '', busy: false };
const isOwner = () => D.isOwner(uid());
const online = () => { if (navigator.onLine) return true; toast('You\u2019re offline. Try again when you\u2019re back online.', true); return false; };
const who = u => (u === uid() ? 'you' : (H.personName && H.personName(u)) || 'a player');
const WHY = { edit: 'Edited', delete: 'Deleted', link: 'Linked a player', leave: 'Took themselves out', import: 'Updated from classic', restore: 'Restored', lock: 'Locked', unlock: 'Unlocked' };
const when = t => { const ms = t && typeof t.toMillis === 'function' ? t.toMillis() : 0; return ms ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };

/** One line per player in a saved version: name, commander or deck, and finish. */
function seatsHtml(rec) {
  const cmd = !rec.format || rec.format === 'Commander';
  return '<ul class="podlist">' + (rec.seats || []).filter(s => s.name || s.c1 || s.deck).map(s =>
    '<li><b>' + esc((s.uid && H.personName && H.personName(s.uid)) || s.name || 'Player') + '</b><span>' +
    esc([cmd ? [s.c1, s.c2].filter(Boolean).map(shortCmd).join(' + ') : s.deck, s.place ? ordinal(+s.place) : ''].filter(Boolean).join(', ')) + '</span></li>').join('') + '</ul>';
}
function versionHtml(rec) {
  const bits = [niceDate(rec.date), rec.format && rec.format !== 'Commander' ? rec.format + (rec.matchScore ? ' ' + rec.matchScore : '') : '', rec.turns ? rec.turns + ' rounds' : '',
    rec.winCondition ? (rec.winCondition === 'Other' ? rec.winOther || 'Other' : rec.winCondition) : '', rec.draw ? 'Draw' : '', rec.deleted ? 'Deleted' : '', rec.locked ? 'Locked' : ''].filter(Boolean);
  return '<p style="margin:0">' + esc(bits.join(' \u00b7 ')) + '</p>' + seatsHtml(rec) + (rec.notes ? '<p class="muted" style="margin:0"><small>Notes: ' + esc(rec.notes) + '</small></p>' : '');
}

/* ---------- history ---------- */
async function openHistory(id) {
  OW.id = id; OW.list = null; OW.err = '';
  H.go('history');
  try { OW.list = (await D.loadHistory(id)).sort((a, b) => (b.savedAt ? b.savedAt.toMillis() : 0) - (a.savedAt ? a.savedAt.toMillis() : 0)); }
  catch (e) { OW.err = e.code || e.message; }
  if (S.view === 'history') H.rerenderKeep();
}
export function viewHistory() {
  const g = S.games.find(x => x.gameId === OW.id);
  let h = '<header class="top"><button class="link back" data-act="recent">\u2039 Recent games</button><h3>History</h3><span style="width:60px"></span></header>';
  if (!isOwner()) return h + '<p class="muted">Only the app\u2019s owner can see a game\u2019s history.</p>';
  if (!g || !g.raw) return h + '<p class="muted">Loading the game\u2026</p>';
  h += '<h2 style="margin-top:0">Now' + (g.locked ? ' <span class="pill">Locked</span>' : '') + '</h2><div class="panel">' + versionHtml(g.raw) +
    '<p class="muted" style="margin:6px 0 0"><small>Logged by ' + esc(who(g.createdBy)) + (g.updatedBy && g.updatedBy !== g.createdBy ? ', last edited by ' + esc(who(g.updatedBy)) : '') + '</small></p></div>';
  h += '<button class="btn" data-act="ownlock">' + (g.locked ? 'Unlock this game' : 'Lock this game') + '</button>' +
    '<p class="muted" style="margin-top:4px"><small>' + (g.locked ? 'Locked: only you can change it.' : 'Locking stops everyone else from editing, deleting or leaving it.') + '</small></p>';
  h += '<h2>Earlier versions</h2>';
  if (OW.err) return h + '<p class="muted">Couldn\u2019t load the history (' + esc(OW.err) + ').</p>';
  if (!OW.list) return h + '<p class="muted">Loading\u2026</p>';
  if (!OW.list.length) return h + '<p class="muted">No changes yet. Each edit, delete or restore keeps the version before it here.</p>';
  OW.list.forEach((v, i) => {
    h += '<div class="panel"><p class="muted" style="margin:0 0 6px"><small><b>' + esc(WHY[v.why] || 'Changed') + '</b> by ' + esc(who(v.savedBy)) + (when(v.savedAt) ? ', ' + esc(when(v.savedAt)) : '') +
      '. Before that, it was:</small></p>' + versionHtml(v.data || {}) +
      '<button class="btn sm" style="margin-top:10px" data-act="ownrestore" data-i="' + i + '">Restore this version</button></div>';
  });
  return h;
}

/* ---------- deleted games ---------- */
const deletedGames = () => S.games.filter(g => g.deleted);
export function settingsOwnerHtml() {
  if (!isOwner()) return '';
  const n = deletedGames().length;
  return '<div class="panel"><p style="margin:0"><b>Owner controls</b></p><p style="margin:4px 0 0">Deleted games can be brought back. For a game\u2019s history or to lock it, press and hold it in Recent games.</p>' +
    '<button class="btn" style="margin-top:10px" data-act="owndeleted">Deleted games' + (n ? ' (' + n + ')' : '') + '</button></div>';
}
export function viewDeleted() {
  let h = '<header class="top"><button class="link back" data-act="navback">\u2039 Data</button><h3>Deleted games</h3><span style="width:60px"></span></header>';
  if (!isOwner()) return h;
  const list = deletedGames();
  if (!list.length) return h + '<p class="muted">No deleted games.</p>';
  h += '<p class="muted" style="margin-top:0"><small>Deleting only hides a game. Restoring brings it back for everyone who played.</small></p>';
  list.forEach(g => {
    h += '<div class="panel"><p style="margin:0"><b>' + esc(niceDate(g.date)) + '</b> ' + esc(g.deckName || g.format) + (g.myPlace ? ', ' + esc(ordinal(+g.myPlace)) : '') + '</p>' +
      (g.raw ? seatsHtml(g.raw) : '') + '<div class="row" style="margin-top:8px"><button class="btn sm" data-act="ownundelete" data-id="' + esc(g.gameId) + '">Restore</button>' +
      '<button class="btn sm" data-act="ownhist" data-id="' + esc(g.gameId) + '">History</button></div></div>';
  });
  return h;
}

/* ---------- taps ---------- */
const ACTS = { menuhistory: 1, menulock: 1, ownlock: 1, ownrestore: 1, owndeleted: 1, ownundelete: 1, ownhist: 1 };
export function onOwnerAct(act, el) {
  if (!ACTS[act]) return false;
  if (!isOwner()) return true;
  doAct(act, el);
  return true;
}
async function doAct(act, el) {
  const me = uid();
  switch (act) {
    case 'menuhistory': { const id = S.gameMenu; S.gameMenu = null; openHistory(id); return; }
    case 'ownhist': openHistory(el.dataset.id); return;
    case 'owndeleted': H.go('deleted'); return;
    case 'menulock': case 'ownlock': {
      const id = act === 'menulock' ? S.gameMenu : OW.id, g = S.games.find(x => x.gameId === id);
      S.gameMenu = null;
      if (!g || !g.raw || !online()) return H.rerenderKeep();
      try { await D.setLocked(me, id, g.doc || g.raw, !g.locked); toast(g.locked ? 'Unlocked.' : 'Locked. Only you can change it now.'); }
      catch (e) { toast('Couldn\u2019t do that: ' + (e.code || e.message), true); }
      H.rerenderKeep(); return;
    }
    case 'ownrestore': {
      const v = OW.list && OW.list[+el.dataset.i], g = S.games.find(x => x.gameId === OW.id);
      if (!v || !g || !g.raw || !online()) return;
      if (!confirm('Put this game back the way it was in this version? The current version is kept in the history too.')) return;
      try { await D.restoreVersion(me, g.gameId, g.doc || g.raw, v.data || {}); toast('Restored.'); openHistory(g.gameId); }
      catch (e) { toast('Couldn\u2019t restore it: ' + (e.code || e.message), true); }
      return;
    }
    case 'ownundelete': {
      const g = S.games.find(x => x.gameId === el.dataset.id);
      if (!g || !g.raw || !online()) return;
      try { await D.undeleteGame(me, g.gameId, g.doc || g.raw); toast('Restored. It\u2019s back in Recent games.'); }
      catch (e) { toast('Couldn\u2019t restore it: ' + (e.code || e.message), true); }
      H.rerenderKeep(); return;
    }
  }
}
