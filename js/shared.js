// Shared games (Phase 5b): games your playgroup-mates logged with you in them.
// - They wait in your inbox until you accept (they count in your stats) or decline (they don't; you can change your mind).
// - When you accept a Commander game you can tag the deck you played, from your own decks.
// - You can link a typed-in name in your games (say "Marcus") to a playgroup-mate, which sends those games to them.
// - After accepting, you can take yourself out of a game ("That wasn't me"); your seat goes back to a typed-in name.
import { S, uid, H } from './state.js';
import { esc, toast } from './util.js';
import * as D from './data.js';
import { GROUPS } from './groups.js';
import { niceDate, ordinal, shortCmd, DRAW_RESULT, deckById } from './game.js';

const SH = { busy: '', linkTo: null, linkName: null, open: {} };
const online = () => { if (navigator.onLine) return true; toast('You\u2019re offline. Try again when you\u2019re back online.', true); return false; };
const rr = () => H.rerenderKeep();
const nameOf = u => (u === uid() ? 'You' : (GROUPS.people[u] && GROUPS.people[u].name) || 'Someone');

/* ---------- playgroup-mates ---------- */
/** Everyone you share a playgroup with: [{ uid, name, via (a playgroup you share), group }]. */
export function mates() {
  const out = {}, me = uid();
  GROUPS.groups.forEach(g => (g.members || []).forEach(m => {
    if (m === me || out[m]) return;
    const p = GROUPS.people[m];
    out[m] = { uid: m, name: p ? p.name : '', code: p ? p.code : '', via: g.id, group: g.name };
  }));
  return Object.keys(out).map(k => out[k]).filter(x => x.name).sort((a, b) => a.name.localeCompare(b.name));
}
/** A playgroup you and this person are both in (the rules check it when you add them to a game). */
export function viaFor(u) {
  const me = uid(), g = GROUPS.groups.find(x => (x.members || []).indexOf(me) !== -1 && (x.members || []).indexOf(u) !== -1);
  return g ? g.id : '';
}
/** After saving: playgroup-mates in the game who aren't on it yet. */
export function linksFor(rec, prev) {
  const have = (prev && prev.raw && prev.raw.players) || [uid()];
  const out = [];
  (rec.seats || []).forEach(s => { if (s.uid && s.uid !== uid() && have.indexOf(s.uid) === -1 && !out.some(x => x.uid === s.uid)) { const v = viaFor(s.uid); if (v) out.push({ uid: s.uid, via: v }); } });
  return out;
}

/* ---------- the inbox ---------- */
export const waiting = () => S.games.filter(g => !g.deleted && !g.accepted && !g.declined);
const declinedGames = () => S.games.filter(g => !g.deleted && !g.accepted && g.declined);
export function homeInboxHtml() {
  const n = waiting().length;
  if (!n) return '';
  return '<section class="resume inboxbar"><strong>' + (n === 1 ? '1 game to accept' : n + ' games to accept') + '</strong>' +
    '<p class="muted">Your playgroup logged ' + (n === 1 ? 'a game' : 'games') + ' with you in ' + (n === 1 ? 'it' : 'them') + '. Accepted games count in your stats.</p>' +
    '<button class="btn primary" style="margin-top:10px" data-act="inbox">See ' + (n === 1 ? 'it' : 'them') + '</button></section>';
}
function gameLine(g) {
  const other = g.format && g.format !== 'Commander';
  const place = g.resultType === DRAW_RESULT ? 'a draw' : g.myPlace ? ordinal(+g.myPlace) : '';
  const opps = g.opponents.filter(o => o.team !== 'A').map(o => (o.player || '') + (o.c1 ? ' (' + shortCmd(o.c1) + ')' : o.deck ? ' (' + o.deck + ')' : '')).filter(Boolean).join(', ');
  return '<b>' + esc(niceDate(g.date)) + '</b>, ' + esc(other ? g.format : (g.podSize ? g.podSize + ' players' : 'Commander')) + (place ? ', you finished <b>' + esc(place) + '</b>' : ', your finish wasn\u2019t logged') +
    (g.c1 ? '<br><small class="muted">Your commander as logged: ' + esc(g.c1 + (g.c2 ? ' + ' + g.c2 : '')) + '</small>' : '') +
    (opps ? '<br><small class="muted">With ' + esc(opps) + '</small>' : '');
}
function deckSelect(g) {
  if (g.format && g.format !== 'Commander') return '';
  const decks = H.pickerDecks();
  if (!decks.length) return '';
  const cur = SH.open['deck-' + g.gameId] || '';
  return '<label class="field" style="margin:10px 0 0"><span class="label">Your deck (optional)</span><select data-tagdeck="' + esc(g.gameId) + '">' +
    '<option value="">Leave as logged</option>' + decks.slice().sort((a, b) => a.name.localeCompare(b.name)).map(d => '<option value="' + esc(d.id) + '"' + (cur === d.id ? ' selected' : '') + '>' + esc(d.name) + '</option>').join('') + '</select></label>';
}
export function viewInbox() {
  let h = '<header class="top"><button class="link back" data-act="home">\u2039 Home</button><h3>Games to accept</h3><span style="width:60px"></span></header>';
  if (SH.busy) return h + '<p class="status">' + esc(SH.busy) + '</p>';
  const list = waiting(), no = declinedGames();
  if (!list.length) h += '<p class="muted">Nothing waiting. Games your playgroup logs with you in them show up here.</p>';
  else {
    h += '<p class="muted" style="margin-top:0"><small>Accepted games count in your stats and Recent games. Declined ones don\u2019t, and you can change your mind below.</small></p>';
    if (list.length > 1) h += '<button class="btn primary" data-act="acceptall">Accept all ' + list.length + '</button>';
  }
  list.forEach(g => {
    h += '<div class="panel inboxgame"><p class="muted" style="margin:0 0 4px"><small>' + esc(nameOf(g.createdBy)) + ' logged</small></p><p style="margin:0">' + gameLine(g) + '</p>' + deckSelect(g) +
      '<div class="row" style="margin-top:10px"><button class="btn sm primary" data-act="acceptone" data-id="' + esc(g.gameId) + '">Accept</button>' +
      '<button class="btn sm" data-act="declineone" data-id="' + esc(g.gameId) + '">Decline</button></div></div>';
  });
  if (no.length) {
    h += '<details class="collapse" id="declinedgames"' + (S.open.declinedgames ? ' open' : '') + '><summary><h2 style="display:inline">Declined <small class="muted">' + no.length + '</small></h2></summary>';
    no.forEach(g => {
      h += '<div class="panel inboxgame"><p class="muted" style="margin:0 0 4px"><small>' + esc(nameOf(g.createdBy)) + ' logged</small></p><p style="margin:0">' + gameLine(g) + '</p>' +
        '<button class="btn sm" style="margin-top:10px" data-act="acceptone" data-id="' + esc(g.gameId) + '">Accept after all</button></div>';
    });
    h += '</details>';
  }
  return h;
}
/** Your seat with the deck you chose, for accepting a game. */
function seatsWithDeck(g, deckId) {
  const d = deckById(deckId);
  if (!d) return null;
  const me = uid(), myName = (S.profile && S.profile.name) || '';
  return (g.raw.seats || []).map(s => s.uid !== me ? s : Object.assign({}, s, {
    name: myName || s.name, deckId: d.id, deckName: d.name, c1: d.c1 || '', c2: d.c2 || '', colors: d.colors || 'C',
    bracket: d.bracket === '' || d.bracket == null ? null : d.bracket
  }));
}

/* ---------- linking a typed-in name to a playgroup-mate ---------- */
/** Typed-in names in your games, with how many games each would link. */
function guestNames(to) {
  const names = {};
  S.games.forEach(g => {
    if (g.deleted || !g.accepted || (g.locked && !D.isOwner(uid())) || !g.raw) return;
    if ((g.raw.players || []).indexOf(to) !== -1) return;
    const seen = {};
    (g.raw.seats || []).forEach(s => {
      const n = String(s.name || '').trim(), k = n.toLowerCase();
      if (!n || s.uid || seen[k]) return;
      seen[k] = true;
      (names[k] = names[k] || { name: n, n: 0 }).n++;
    });
  });
  return Object.keys(names).map(k => names[k]);
}
function linkItems(to, guest) {
  const k = guest.toLowerCase(), p = GROUPS.people[to] || {}, out = [];
  S.games.forEach(g => {
    if (g.deleted || !g.accepted || (g.locked && !D.isOwner(uid())) || !g.raw) return;
    if ((g.raw.players || []).indexOf(to) !== -1) return;
    const seats = (g.raw.seats || []).map(s => Object.assign({}, s));
    const i = seats.findIndex(s => !s.uid && String(s.name || '').trim().toLowerCase() === k);
    if (i < 0) return;
    seats[i] = Object.assign(seats[i], { uid: to, guestName: seats[i].name, name: p.name || seats[i].name });
    out.push({ id: g.gameId, prev: g.doc || g.raw, seats: seats, g: g });
  });
  return out;
}
export function viewLinkGuest() {
  const to = SH.linkTo, p = GROUPS.people[to] || {};
  let h = '<header class="top"><button class="link back" data-act="linkback">\u2039 Back</button><h3>Link games</h3><span style="width:60px"></span></header>';
  if (SH.busy) return h + '<p class="status linkstatus">' + esc(SH.busy) + '</p>';
  if (!to || !viaFor(to)) return h + '<p class="muted">You\u2019re not in a playgroup with this person anymore.</p>';
  if (!SH.linkName) {
    const first = String(p.name || '').split(' ')[0].toLowerCase();
    const list = guestNames(to).sort((a, b) => ((b.name.toLowerCase().split(' ')[0] === first) - (a.name.toLowerCase().split(' ')[0] === first)) || b.n - a.n || a.name.localeCompare(b.name));
    h += '<p style="margin-top:0">Which name did you type for <b>' + esc(p.name || 'them') + '</b> in your games? Those games go to them to accept, and the seat shows their name from then on.</p>';
    if (!list.length) return h + '<p class="muted">No typed-in names in your games yet.</p>';
    return h + list.slice(0, 40).map(x => '<button class="gcard" data-act="linkpick" data-name="' + esc(x.name) + '"><span class="txt"><span class="name">' + esc(x.name) + '</span><span class="muted">' + x.n + (x.n === 1 ? ' game' : ' games') + '</span></span></button>').join('');
  }
  const items = linkItems(to, SH.linkName);
  h += '<p style="margin-top:0"><b>' + items.length + (items.length === 1 ? ' game' : ' games') + '</b> with \u201C' + esc(SH.linkName) + '\u201D will go to <b>' + esc(p.name || 'them') + '</b> to accept. Until they do, nothing changes for them.</p>';
  h += '<details class="collapse implist" id="linklist"' + (S.open.linklist ? ' open' : '') + '><summary>See the games</summary><ul>' +
    items.slice(0, 200).map(it => '<li><b>' + esc(niceDate(it.g.date)) + '</b> ' + esc(it.g.deckName || it.g.format) + ', ' + esc(it.g.myPlace ? ordinal(+it.g.myPlace) : '?') + '</li>').join('') + '</ul></details>';
  h += '<button class="btn primary" style="margin-top:12px" data-act="linkgo"' + (items.length ? '' : ' disabled') + '>Send ' + items.length + (items.length === 1 ? ' game' : ' games') + ' to ' + esc(p.name || 'them') + '</button>' +
    '<button class="btn" style="margin-top:8px" data-act="linkpickagain">Pick a different name</button>' +
    '<p class="muted" style="margin-top:10px"><small>Games you imported from classic stay linked if you import again, and won\u2019t be updated from classic after this.</small></p>';
  return h;
}

/* ---------- taps ---------- */
const ACTS = { inbox: 1, acceptall: 1, acceptone: 1, declineone: 1, glink: 1, linkpick: 1, linkpickagain: 1, linkgo: 1, linkback: 1, menuleave: 1 };
export function onSharedAct(act, el) {
  if (!ACTS[act]) return false;
  doAct(act, el);
  return true;
}
export function onSharedChange(t) {
  if (t.dataset && t.dataset.tagdeck) { SH.open['deck-' + t.dataset.tagdeck] = t.value; return true; }
  return false;
}
async function doAct(act, el) {
  const me = uid(), id = el && el.dataset.id;
  switch (act) {
    case 'inbox': H.go('inbox'); return;
    case 'acceptone': {
      const g = S.games.find(x => x.gameId === id);
      if (!g || !online()) return;
      const deck = SH.open['deck-' + id], seats = deck ? seatsWithDeck(g, deck) : null;
      try { await D.acceptGames(me, [{ id: id, seats: seats }]); toast('Accepted. It counts in your stats now.'); }
      catch (e) { toast('Couldn\u2019t accept it: ' + (e.code || e.message), true); }
      return;
    }
    case 'acceptall': {
      const list = waiting();
      if (!list.length || !online() || !confirm('Accept all ' + list.length + ' games? They\u2019ll count in your stats.')) return;
      SH.busy = 'Accepting ' + list.length + ' games\u2026'; rr();
      try { await D.acceptGames(me, list.map(g => ({ id: g.gameId, seats: SH.open['deck-' + g.gameId] ? seatsWithDeck(g, SH.open['deck-' + g.gameId]) : null }))); toast('Accepted ' + list.length + ' games.'); }
      catch (e) { toast('Stopped partway: ' + (e.code || e.message) + '. Try again for the rest.', true); }
      SH.busy = ''; rr(); return;
    }
    case 'declineone': {
      if (!online()) return;
      try { await D.declineGames(me, [id]); toast('Declined. It\u2019s under Declined if you change your mind.'); }
      catch (e) { toast('Couldn\u2019t decline it: ' + (e.code || e.message), true); }
      return;
    }
    case 'glink': SH.linkTo = id; SH.linkName = null; SH.back = S.view; H.go('linkguest'); return;
    case 'linkpick': SH.linkName = el.dataset.name; rr(); return;
    case 'linkpickagain': SH.linkName = null; rr(); return;
    case 'linkback': if (SH.busy) return; if (SH.linkName) { SH.linkName = null; rr(); } else H.go(SH.back || 'group'); return;
    case 'linkgo': {
      const to = SH.linkTo, via = viaFor(to), items = linkItems(to, SH.linkName), p = GROUPS.people[to] || {};
      if (!items.length || !via || !online()) return;
      SH.busy = 'Sending 0 of ' + items.length + ' games\u2026'; rr();
      try {
        await D.linkGuestGames(me, to, via, items, n => { SH.busy = 'Sending ' + n + ' of ' + items.length + ' games\u2026'; const s = document.querySelector('.linkstatus'); if (s) s.textContent = SH.busy; });
        toast('Sent ' + items.length + (items.length === 1 ? ' game' : ' games') + ' to ' + (p.name || 'them') + '.');
        SH.busy = ''; SH.linkName = null; H.go(SH.back || 'group');
      } catch (e) { SH.busy = ''; toast('Stopped partway: ' + (e.code || e.message) + '. Try again to send the rest.', true); rr(); }
      return;
    }
    case 'menuleave': {
      const g = S.games.find(x => x.gameId === S.gameMenu);
      if (!g || !g.raw || !online()) return;
      if (!confirm('Take yourself out of this game? It leaves your games and stats, and your seat goes back to a typed-in name.')) return;
      const seats = (g.raw.seats || []).map(s => {
        if (s.uid !== me) return s;
        const c = Object.assign({}, s, { uid: null, name: s.guestName || s.name });
        delete c.guestName; return c;
      });
      S.gameMenu = null;
      try { await D.leaveGame(me, g.gameId, g.doc || g.raw, seats); toast('You\u2019re out of that game.'); }
      catch (e) { toast('Couldn\u2019t do that: ' + (e.code || e.message), true); }
      rr(); return;
    }
  }
}
