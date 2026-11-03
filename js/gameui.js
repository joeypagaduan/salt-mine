// Game screens, ported from classic 1.13: home banners, new game setup, the round counter, results,
// Recent games (with the press-and-hold menu and multi-select delete), rematch and share.
// The life counter itself is in lifecounter.js.
import { S, uid, H } from './state.js';
import { esc, store, toast, seg, manaGradient } from './util.js';
import * as D from './data.js';
import { CMD, searchCmds, partnerPredicate, secondLabel, cmdEntry, ensureCommanders } from './commanders.js';
import {
  WINCONS, LIFE_CHOICES, MANA_BTN, FORMAT_DEFAULTS, DRAW_RESULT, ordinal, niceDate, range, myName, deckById, oppName, shortCmd, toggleColor,
  newDraft, resizePod, formatList, isCmd, fmtOf, teamSize, sides, teammates, otherTeam, deckLabel, activeEvent, eventLabel, recordText,
  applyFormat, matchToPlaces, plural, lcKeys, lcInfo, assignTurnOrder, ensureFirstPlayer, shareText, rematchFrom, gameToDraft,
  toRecord, fromRecord, knownPlayers, otherDecks, deckPlays
} from './game.js';

import { lcHtml, lcAfterRender, lcResetUi, lcClick, lcEmblemSearch, LC_LAYOUTS, lcLayout, layoutPreview, ELIM_CATS, elimLines } from './lifecounter.js';
export { H, lcResetUi, lcClick };
const app = document.getElementById('app');
const EDITING = ['setup', 'playing', 'ending'];
export const isEditingView = v => EDITING.indexOf(v) !== -1;

/* ---------- the game in progress: saved on this device right away, and to your account a moment later ---------- */
const draftKey = () => 'smb_draft_' + uid();
let pushTimer = null;
export function loadLocalDraft() { S.draft = store(draftKey()) || null; }
export function touch() {
  if (!S.draft) return;
  S.draft.updatedAt = Date.now();
  store(draftKey(), S.draft);
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { if (S.draft) D.pushDraft(uid(), S.draft); }, 2000);
}
H.touch = () => touch();
H.dropDraft = () => dropDraft();
export function dropDraft() {
  const id = S.draft && S.draft.id;
  S.draft = null; store(draftKey(), null); clearTimeout(pushTimer);
  D.clearDraft(uid(), id);
}
/** Another device changed the game in progress. */
export function onRemoteDraft(r) {
  if (r.pending) return;
  const local = S.draft;
  if (r.data) {
    if (local && local.id === r.data.id && (local.updatedAt || 0) >= (r.data.updatedAt || 0)) return;
    if (local && local.id !== r.data.id && (local.updatedAt || 0) > (r.data.updatedAt || 0)) { D.pushDraft(uid(), local); return; }
    if (isEditingView(S.view) && local) return; // you're working on it here; this device's copy wins when it next saves
    S.draft = r.data; store(draftKey(), S.draft);
    if (S.view === 'home') H.rerenderKeep();
    return;
  }
  if (!local) return;
  if (r.clearedId && r.clearedId === local.id) {
    // saved or discarded on another device
    S.draft = null; store(draftKey(), null); clearTimeout(pushTimer);
    if (isEditingView(S.view)) { toast('That game was saved or discarded on another device.'); H.go('home'); }
    else if (S.view === 'home') H.rerenderKeep();
  } else if ((local.updatedAt || 0) > (r.at || 0)) D.pushDraft(uid(), local); // started offline: send it up now
}

/* ---------- small pieces ---------- */
function manaPicker(who, cur) {
  cur = String(cur || '');
  return '<div class="mana" role="group" aria-label="Colors">' + MANA_BTN.map(m => '<button type="button" data-act="mana" data-who="' + who + '" data-c="' + m[0] + '" class="' + (cur.indexOf(m[0]) !== -1 ? 'on' : '') + '" style="--mc:' + m[1] + ';--mi:' + m[2] + '" aria-pressed="' + (cur.indexOf(m[0]) !== -1) + '">' + m[0] + '</button>').join('') + '</div>';
}
function deckCardG(deck, act) {
  return '<button class="deck" data-act="' + act + '" data-deck="' + esc(deck.id) + '">' +
    '<span class="stripe" style="background:' + manaGradient(deck.colors) + '"></span>' +
    '<span class="txt"><span class="name">' + esc(deck.name) + '</span><span class="cmd">' + esc([deck.c1, deck.c2].filter(Boolean).join(' + ') || deck.type || '') + '</span></span>' +
    (deck.bracket !== '' && deck.bracket != null ? '<span class="badge">B' + esc(deck.bracket) + '</span>' : '') + '</button>';
}
const lockedFor = g => g && g.locked && !D.isOwner(uid());

/* ---------- home ---------- */
export function homeGameHtml() {
  const d = S.draft;
  let h = '';
  if (d) {
    const when = new Date(d.createdAt || d.updatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    h += '<section class="resume"><strong>' + (d.gameId ? 'You were editing a saved game' : d.quick ? 'You were logging a game' : 'Game in progress') + '</strong>' +
      '<p class="muted">' + esc((isCmd(d) ? d.deckName : deckLabel(d)) || 'No deck chosen yet') + (d.gameId ? '' : ', started ' + esc(when)) + '</p>' +
      '<div class="row" style="margin-top:12px"><button class="btn primary" data-act="resume">Resume</button><button class="btn" data-act="discard">Discard</button></div></section>';
  }
  const waiting = S.games.filter(g => g.pending).length;
  if (waiting && !navigator.onLine) {
    h += '<section class="resume"><strong>' + (waiting === 1 ? '1 game is' : waiting + ' games are') + ' waiting to sync</strong>' +
      '<p class="muted">Saved on this device. ' + (waiting === 1 ? 'It syncs' : 'They sync') + ' on ' + (waiting === 1 ? 'its' : 'their') + ' own once you\u2019re back online.</p></section>';
  }
  if (S.lastGame && !d) {
    h += '<section class="resume rematch"><strong>Play again?</strong><p class="muted">Same pod and seats. You can change commanders before starting.</p>' +
      '<div class="row" style="margin-top:12px"><button class="btn primary" data-act="rematch">Rematch</button><button class="btn" data-act="sharelast">Share result</button>' +
      '<button class="btn" data-act="nolast" aria-label="Dismiss">\u2715</button></div></section>';
  }
  S.events.filter(e => e.status === 'Active').forEach(e => {
    h += '<section class="resume event"><strong>' + esc(eventLabel(e)) + '</strong>' +
      '<p class="muted">Event in progress, ' + esc(recordText(e)) + ' so far</p>' +
      '<div class="row" style="margin-top:12px"><button class="btn primary" data-act="evnext" data-id="' + esc(e.id) + '">Next match</button><button class="btn" data-act="evend" data-id="' + esc(e.id) + '">End event</button></div></section>';
  });
  h += '<button class="btn primary big" data-act="new">Start a game</button>';
  h += '<button class="btn" style="margin-top:10px" data-act="quick">Log a game without the life counter</button>';
  return h;
}

/* ---------- new game ---------- */
function formatBlock(d) {
  const shown = formatList().filter(f => f.show !== false);
  const cur = isCmd(d) ? 'Commander' : d.format;
  let h = '<details class="fmtbox" id="fmtpick"' + (S.fmtOpen ? ' open' : '') + '><summary><span>Format</span><b>' + esc(cur) + '</b></summary>' +
    '<div class="chips fmtchips">' + ['Commander'].concat(shown.map(f => f.name)).map(n => '<button type="button" data-act="setfmt" data-val="' + esc(n) + '" class="' + (n === cur ? 'on' : '') + '">' + esc(n) + '</button>').join('') + '</div>' +
    '<p class="muted"><small>Change or add formats in Settings, under Formats.</small></p></details>';
  if (isCmd(d)) return h;
  const f = fmtOf(d);
  if (f.event && d.event) {
    const e = d.event;
    if (e.existing) {
      const live = S.events.find(x => x.id === e.id);
      h += '<div class="panel evbox"><span class="label">Event in progress</span><b>' + esc(eventLabel({ set: e.set, format: d.format, store: e.store })) + '</b>' +
        (live ? '<p class="muted">Record so far: ' + esc(recordText(live)) + '</p>' : '') +
        '<button class="link" data-act="newevent">Start a new event instead</button></div>';
    } else {
      h += '<div class="panel evbox"><span class="label">New event</span>' +
        '<div class="field"><label for="evset">Set</label><input type="text" id="evset" data-ev="set" value="' + esc(e.set) + '" placeholder="e.g. Bloomburrow" autocomplete="off"></div>' +
        '<div class="field"><label for="evstore">Store (optional)</label><input type="text" id="evstore" data-ev="store" value="' + esc(e.store) + '" autocomplete="off"></div>' +
        '<p class="muted"><small>Every match you log goes into this event until you end it from the home screen.</small></p></div>';
    }
  } else if (f.set) {
    h += '<div class="field"><label for="fset">Set</label><input type="text" id="fset" data-field="set" value="' + esc(d.set) + '" placeholder="e.g. Bloomburrow" autocomplete="off"></div>';
  }
  const custom = LIFE_CHOICES.indexOf(+d.startLife) === -1;
  h += '<div class="field"><span class="label">Starting life for everyone</span>' + seg('slife', LIFE_CHOICES.concat([{ val: 'custom', label: 'Custom' }]), custom || S.lifeCustom ? 'custom' : d.startLife, { cls: 'lifeseg' }) +
    (custom || S.lifeCustom ? '<input type="number" inputmode="numeric" min="1" data-field="startLife" value="' + esc(d.startLife) + '" style="margin-top:8px" aria-label="Custom starting life">' : '') + '</div>';
  if (sides(d) === 2) h += '<div class="field"><span class="label">Games</span>' + seg('bo3', [{ val: '1', label: 'Single game' }, { val: '3', label: 'Best of 3' }], d.bo3 ? '3' : '1') + '</div>';
  return h;
}
function myDeckBlock(d) {
  const f = fmtOf(d);
  let h = '<div class="field"><span class="label">Your deck' + (f.set || f.event ? ' colors' : '') + '</span>';
  if (!f.set && !f.event) h += '<div class="ta"><input type="text" id="mydeck" data-ta="mydeck" data-i="0" value="' + esc(d.deckName) + '" placeholder="Deck name, e.g. Izzet Prowess" autocomplete="off"><ul class="ta-list" hidden></ul></div>';
  return h + manaPicker('my', d.myColors) + '</div>';
}
function oppFieldsHtml(o, i) {
  return '<div class="field ta"><label for="od' + i + '">Deck or archetype (optional)</label><input type="text" id="od' + i + '" data-ta="odeck" data-i="' + i + '" value="' + esc(o.deck) + '" autocomplete="off" placeholder="e.g. Mono-Red Aggro"><ul class="ta-list" hidden></ul></div>' +
    manaPicker(String(i), o.colors);
}
function quickPlayers(i) {
  const d = S.draft;
  if (String(d.opponents[i].player || '').trim()) return '';
  const used = d.opponents.map(o => String(o.player || '').toLowerCase());
  const list = knownPlayers().filter(p => used.indexOf(p.name.toLowerCase()) === -1).slice(0, 8);
  if (!list.length) return '';
  return '<div class="chips">' + list.map(p => '<button type="button" data-act="pickplayer" data-i="' + i + '" data-name="' + esc(p.name) + '">' + esc(p.name) + '</button>').join('') + '</div>';
}
function c2SlotHtml(o, i) {
  if (o.c2 || o.showC2) {
    return '<div class="field ta"><label for="d' + i + '">Second commander</label><input type="text" id="d' + i + '" data-ta="c2" data-i="' + i + '" value="' + esc(o.c2) + '" autocomplete="off"><ul class="ta-list" hidden></ul></div>' +
      '<button class="link danger" data-act="rmc2" data-i="' + i + '">Remove second commander</button>';
  }
  const e = cmdEntry(o.c1);
  if (e && e.p) return '<button class="link" data-act="addc2" data-i="' + i + '">+ ' + esc(secondLabel(e)) + '</button>';
  // the commander list hasn't loaded (or doesn't know this card): still allow a second one
  return o.c1 && !e ? '<button class="link" data-act="addc2" data-i="' + i + '">+ Add a partner or background</button>' : '';
}
export function viewSetup() {
  const d = S.draft, deck = deckById(d.deckId);
  let h = '<header class="top"><button class="link back" data-act="home">\u2039 Home</button><h3>' + (d.gameId ? 'Edit pod' : d.quick ? 'Log a game' : 'New game') + '</h3><span style="width:60px"></span></header>';
  h += formatBlock(d);
  h += '<div class="field"><label for="date">Date</label><input type="date" id="date" data-field="date" value="' + esc(d.date) + '"></div>';
  const cmd = isCmd(d), team = teamSize(d);
  if (cmd) {
    h += '<div class="field"><span class="label">Your deck</span>' + (deck ? deckCardG(deck, 'pick') : d.deckId && d.deckName
      ? '<button class="deck" data-act="pick"><span class="stripe" style="background:' + manaGradient('C') + '"></span><span class="txt"><span class="name">' + esc(d.deckName) + '</span><span class="cmd">Not in your picker anymore. Tap to change.</span></span></button>'
      : '<button class="btn" data-act="pick">Choose your deck</button>') + '</div>';
  } else h += myDeckBlock(d);
  if (!team) h += '<div class="field"><span class="label">Players in the pod</span>' + seg('pod', [2, 3, 4, 5, 6], d.podSize) + '</div>';
  const oppSection = (o, i) => {
    let s = '<section class="panel opp"><h3>' + esc(oppName(o, i)) + '</h3>' +
      '<div class="field ta"><label for="p' + i + '">Player</label><input type="text" id="p' + i + '" data-ta="player" data-i="' + i + '" value="' + esc(o.player) + '" autocomplete="off" placeholder="Type a name"><ul class="ta-list" hidden></ul>' + quickPlayers(i) + '</div>';
    if (cmd) s += '<div class="field ta"><label for="c' + i + '">Commander</label><input type="text" id="c' + i + '" data-ta="c1" data-i="' + i + '" value="' + esc(o.c1) + '" autocomplete="off" placeholder="Type a commander"><ul class="ta-list" hidden></ul></div>' +
      '<div id="c2slot-' + i + '">' + c2SlotHtml(o, i) + '</div>';
    else s += oppFieldsHtml(o, i);
    return s + '</section>';
  };
  if (team) {
    h += '<h2>' + (team === 2 ? 'Your teammate' : 'Your teammates') + '</h2>';
    d.opponents.forEach((o, i) => { if (i < team - 1) h += oppSection(o, i); });
    h += '<h2>The other team</h2>';
    d.opponents.forEach((o, i) => { if (i >= team - 1) h += oppSection(o, i); });
    h += '<p class="muted" style="margin-bottom:6px">' + (d.quick || d.gameId ? '' : 'Which team goes first is picked at random when the game starts.') + '</p>';
  } else {
    h += '<h2>' + (d.podSize === 2 ? 'Opponent' : 'Opponents') + '</h2><p class="muted" style="margin-bottom:6px">' + (d.podSize === 2 ? '' : 'Add them clockwise, starting with the player on your left.') +
      (d.quick || d.gameId ? '' : ' Who goes first is picked at random when the game starts.') + '</p>';
    d.opponents.forEach((o, i) => { h += oppSection(o, i); });
  }
  if (d.quick && !d.gameId) {
    h += '<div class="field" style="margin-top:18px"><span class="label">Who went first? (optional)</span>' +
      seg('first', lcKeys().map(k => ({ val: k, label: lcInfo(k).name })), d.firstKey || '') +
      '<p class="muted" style="margin-top:6px"><small>Sets everyone\u2019s turn order, counting clockwise from that player.</small></p></div>';
  }
  h += '<div class="bar"><div class="inner"><button class="btn primary" data-act="start">' + (d.quick && d.stage === 'setup' ? 'Next: results' : d.gameId || d.stage === 'ending' ? 'Back to results' : (d.stage === 'setup' ? 'Start game' : 'Back to game')) + '</button></div></div>';
  return h;
}

/* ---------- during the game (a round counter until the life counter arrives in Phase 2b) ---------- */
function seatList() {
  const d = S.draft, keys = lcKeys();
  const rows = keys.map(k => {
    const info = lcInfo(k), seat = k === 'me' ? d.mySeat : k === 'g1' ? (otherTeam()[0] || {}).seat : d.opponents[+k.slice(1)].seat;
    return { seat: seat, me: k === 'me', who: info.name, cmd: isCmd(d) ? [info.c1, info.c2].filter(Boolean).join(' + ') : '' };
  });
  rows.sort((a, b) => (a.seat || 99) - (b.seat || 99));
  return '<ul class="plain table-order">' + rows.map(r => '<li><span class="seatno">' + (r.seat || '\u00B7') + '</span><span><span class="' + (r.me ? 'me' : '') + '">' + esc(r.who) + '</span>' +
    (isCmd(d) ? '<br><small class="muted">' + esc(r.cmd || 'Commander not entered') + '</small>' : '') + '</span></li>').join('') + '</ul>';
}
export function viewPlaying() {
  if (S.settings.gameMode !== 'simple') return lcHtml();
  const d = S.draft, deck = deckById(d.deckId);
  let h = '<header class="top"><button class="link back" data-act="home">\u2039 Home</button><button class="link" data-act="editsetup">Edit pod</button></header>';
  h += '<div style="display:flex;gap:12px;align-items:center"><span class="stripe" style="height:44px;background:' + manaGradient(isCmd(d) ? (deck ? deck.colors : 'C') : d.myColors || 'C') + '"></span><div><h1 style="font-size:30px">' + esc((isCmd(d) ? d.deckName : deckLabel(d)) || 'No deck') + '</h1>' +
    '<p class="muted">' + esc(isCmd(d) ? d.podSize + ' players' : d.format + (teamSize(d) ? '' : ', ' + d.podSize + ' players')) + '</p></div></div>';
  h += '<div class="counter"><button data-act="turn-" aria-label="Previous round">\u2212</button><output id="turnout"><b>' + esc(d.turns || 1) + '</b><span>Round</span></output><button class="plus" data-act="turn+" aria-label="Next round">+</button></div>';
  h += '<h2>Turn order</h2><div class="panel">' + seatList() + '</div>';
  h += '<div class="field"><label for="notes">Notes</label><textarea id="notes" data-field="notes" placeholder="Big plays, misplays, salt">' + esc(d.notes) + '</textarea></div>';
  h += '<div class="bar"><div class="inner"><button class="btn primary" data-act="end">End game</button></div></div>';
  return h;
}

/* ---------- results ---------- */
export function viewEnd() {
  const d = S.draft;
  const opts = (list, cur) => '<option value="">Choose\u2026</option>' + list.map(v => '<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
  const winnerIdx = d.opponents.findIndex(o => +o.place === 1);
  const back = d.gameId ? ['home', 'Home'] : d.quick ? ['editsetup', 'Players'] : ['backtogame', 'Back to game'];
  let h = '<header class="top"><button class="link back" data-act="' + back[0] + '">\u2039 ' + back[1] + '</button><button class="link" data-act="editsetup">Edit pod</button></header>';
  h += '<h1>' + (d.gameId ? 'Edit game' : d.quick ? 'Log a game' : 'How did it go?') + '</h1>';
  const cmd = isCmd(d), two = sides(d) === 2, team = teamSize(d);
  h += '<p class="muted" style="margin-top:4px">' + esc(cmd ? (d.deckName || 'No deck chosen') : deckLabel(d) + (deckLabel(d).indexOf(d.format) === -1 ? ', ' + d.format : '')) + ', ' + esc(niceDate(d.date)) + '</p>';
  if (!cmd && d.event) h += '<p class="muted">Part of ' + esc(eventLabel({ set: d.event.set, format: d.format, store: d.event.store })) + '</p>';
  if (!cmd && d.bo3 && two) {
    h += '<div class="field"><span class="label">Games ' + (team ? 'your team' : 'you') + ' won</span>' + seg('mw', [0, 1, 2], d.matchW) + '</div>';
    h += '<div class="field"><span class="label">Games ' + (team ? 'the other team' : 'they') + ' won</span>' + seg('tw', [0, 1, 2], d.matchL) + '</div>';
    if (d.matchW != null && d.matchL != null) h += '<p class="status">' + (+d.matchW === +d.matchL ? 'Match drawn ' : +d.matchW > +d.matchL ? 'Match won ' : 'Match lost ') + d.matchW + '-' + d.matchL + '</p>';
  } else if (!cmd && two) {
    h += '<div class="field"><span class="label">' + (team ? 'How did your team do?' : 'How did it go?') + '</span>' + seg('place', [{ val: 1, label: team ? 'Our team won' : 'I won' }, { val: 2, label: team ? 'We lost' : 'I lost' }], d.myPlace, { cls: 'places' }) + '</div>';
    h += '<label style="display:flex;gap:10px;align-items:center;margin:6px 0 2px"><input type="checkbox" data-field="draw"' + (d.draw ? ' checked' : '') + ' style="width:22px;height:22px"> Draw</label>';
  } else {
    h += '<div class="field"><span class="label">Where did you finish?</span>' + seg('place', range(d.podSize).map(n => ({ val: n, label: ordinal(n) })), d.myPlace, { cls: 'places' }) + '</div>';
    h += '<label style="display:flex;gap:10px;align-items:center;margin:6px 0 2px"><input type="checkbox" data-field="draw"' + (d.draw ? ' checked' : '') + ' style="width:22px;height:22px"> Draw or shared win</label>';
  }
  if (!two && d.myPlace && +d.myPlace > 1 && !d.draw) {
    h += '<div class="field"><span class="label">Who won?</span>' + seg('winner', d.opponents.map((o, i) => ({ val: i, label: oppName(o, i) })), winnerIdx) + '</div>';
  }
  const youWon = +d.myPlace === 1;
  h += '<div class="field"><label for="wc">' + (youWon ? 'How did you win?' : 'How did the winner win?') + '</label><select id="wc" data-field="winCondition">' + opts(WINCONS, d.winCondition) + '</select></div>';
  if (d.winCondition === 'Other') h += '<div class="field"><label for="wo">Describe it</label><input type="text" id="wo" data-field="winOther" value="' + esc(d.winOther) + '"></div>';
  if (d.myPlace && +d.myPlace > 1) {
    const names = d.opponents.map((o, i) => oppName(o, i)).concat(['Myself']);
    h += '<div class="row"><div class="field"><label for="eb">Who knocked you out?</label><select id="eb" data-field="elimBy">' + opts(names, d.elimBy) + '</select></div>' +
      '<div class="field"><label for="eh">How?</label><select id="eh" data-field="elimHow">' + opts(WINCONS, d.elimHow) + '</select></div></div>';
  }
  h += '<div class="field"><label for="turns">Rounds</label><input type="number" inputmode="numeric" min="1" id="turns" data-field="turns" value="' + esc(d.turns) + '"></div>';
  if (!two) {
    h += '<details id="placesbox"' + (S.open.placesbox || d.opponents.some(o => o.place && +o.place !== 1) ? ' open' : '') + '><summary>Everyone\u2019s placements (optional)</summary>';
    d.opponents.forEach((o, i) => {
      h += '<div class="field"><span class="label">' + esc(oppName(o, i)) + '</span>' + seg('oplace-' + i, range(d.podSize).map(n => ({ val: n, label: ordinal(n) })), o.place) + '</div>';
    });
    h += '</details>';
  }
  h += '<div class="field"><label for="notes">Notes</label><textarea id="notes" data-field="notes">' + esc(d.notes) + '</textarea></div>';
  if (d.gameId) h += '<button class="link danger" data-act="delete">Delete this game</button>';
  if (d.myPlace) h += '<button class="btn" style="margin-top:14px" data-act="shareend">Share result</button>';
  h += '<div class="bar"><div class="inner"><button class="btn primary" id="savebtn" data-act="save">' + (d.gameId ? 'Save changes' : 'Save game') + '</button></div></div>';
  return h;
}

/* ---------- Recent games ---------- */
const TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>';
const liveGames = () => S.games.filter(g => !g.deleted);
const gameById = id => S.games.find(g => g.gameId === id);
export function viewRecent() {
  const sel = S.sel, list = liveGames(), shown = list.slice(0, S.recentShown);
  let h = '<header class="top"><button class="link back" data-act="home">\u2039 Home</button><h3>Recent games</h3><span style="width:60px"></span></header>';
  if (sel) {
    const n = Object.keys(sel).length;
    h += '<div class="selbar"><b>' + (n ? n + ' selected' : 'Tap games to select') + '</b>' +
      (n ? '<button class="btn" data-act="selnone">Unselect</button><button class="btn danger" data-act="seldel">Delete</button>' : '') +
      '<button class="btn" data-act="seldone">Done</button></div>';
  } else if (list.length) h += '<p class="muted" style="margin:-4px 0 10px"><small>Tap a game to edit it. Press and hold for more options.</small></p>';
  if (!list.length) h += '<p class="muted">' + (S.gamesLoaded ? 'No games logged yet. Your first one will show up here.' : 'Loading your games\u2026') + '</p>';
  shown.forEach(g => {
    const other = g.format && g.format !== 'Commander';
    const deck = other ? null : deckById(g.deckId);
    const colors = other ? g.myColors || 'C' : (deck ? deck.colors : g.colors || 'C');
    const opps = g.opponents.filter(o => o.team !== 'A').map(o => (other ? o.player || o.deck : o.c1 ? shortCmd(o.c1) : o.player)).filter(Boolean).join(', ');
    const place = g.resultType === DRAW_RESULT ? '=' : (g.myPlace ? ordinal(+g.myPlace) : '?');
    const on = !!(sel && sel[g.gameId]);
    h += '<button class="game' + (on ? ' sel' : '') + '" data-act="edit" data-id="' + esc(g.gameId) + '" data-press="game">' +
      (sel ? '<span class="tick" aria-hidden="true">' + (on ? TICK : '') + '</span>' : '') +
      '<span class="stripe" style="background:' + manaGradient(colors) + '"></span>' +
      '<span class="place' + (+g.myPlace === 1 && !g.draw ? ' first' : '') + '">' + esc(place) + '</span>' +
      '<span class="txt"><span class="name">' + esc(g.deckName || (other ? g.format : 'Unknown deck')) + '</span><span class="sub">' + esc(niceDate(g.date)) +
      (other ? ', ' + esc(g.format) + (g.matchScore ? ' ' + esc(g.matchScore) : '') : (g.podSize ? ', ' + esc(g.podSize) + ' players' : '')) + (opps ? ', vs ' + esc(opps) : '') +
      (g.pending ? ' <span class="pill sync">Not synced yet</span>' : '') + (g.locked ? ' <span class="pill">Locked</span>' : '') + '</span></span></button>';
  });
  if (list.length > shown.length) h += '<button class="btn" style="margin-top:10px" data-act="recentmore">Show more <small class="muted">(' + shown.length + ' of ' + list.length + ')</small></button>';
  const g = S.gameMenu && gameById(S.gameMenu);
  if (g) {
    h += '<div class="actscrim" data-act="menuclose"></div><div class="actsheet" role="dialog" aria-label="Game options"><div class="inner">' +
      '<p><b style="color:var(--ink)">' + esc(g.deckName || g.format) + '</b>, ' + esc(niceDate(g.date)) + '</p>' +
      (lockedFor(g) ? '' : '<button class="btn" data-act="menuedit">Edit game</button>') +
      '<button class="btn" data-act="menurematch">Rematch</button>' +
      '<button class="btn" data-act="menushare">Share result</button>' +
      (lockedFor(g) ? '' : '<button class="btn danger" data-act="menudel">Delete game</button>') +
      '<button class="btn" data-act="menusel">Select more games</button>' +
      '<button class="btn" data-act="menuclose">Cancel</button></div></div>';
  }
  return h;
}

/* ---------- deck picker ---------- */
function pickerListHtml(q) {
  q = String(q || '').toLowerCase().trim();
  const plays = deckPlays();
  const decks = H.pickerDecks().filter(d => !q || (d.name + ' ' + (d.c1 || '') + ' ' + (d.c2 || '')).toLowerCase().indexOf(q) !== -1)
    .map(d => Object.assign({}, d, plays[d.id] || { plays: 0, last: 0 }, { type: H.deckType(d) }));
  if (!decks.length) return '<p class="muted">' + (q ? 'No decks match \u201C' + esc(q) + '\u201D. ' : 'No decks yet. ') + 'Tap \u201CAdd a deck\u201D above to type one in.</p>';
  let h = '';
  if (!q) {
    const recent = decks.filter(d => d.plays > 0).sort((a, b) => b.last - a.last).slice(0, 5);
    if (recent.length) h += '<h2>Played recently</h2>' + recent.map(d => deckCardG(d, 'choosedeck')).join('');
  }
  const groups = {};
  decks.forEach(d => { (groups[d.type] = groups[d.type] || []).push(d); });
  const order = ['Scratch', 'Upgraded', 'Pre-Con'], names = { Scratch: 'From scratch', Upgraded: 'Upgraded', 'Pre-Con': 'Pre-cons' };
  Object.keys(groups).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b)).forEach(t => {
    h += '<h2>' + esc(names[t] || t) + '</h2>' + groups[t].sort((a, b) => a.name.localeCompare(b.name)).map(d => deckCardG(d, 'choosedeck')).join('');
  });
  return h;
}
export function viewPicker() {
  return '<div class="overlay" role="dialog" aria-label="Choose your deck"><div class="inner"><div class="sticky"><div class="top"><h3>Choose your deck</h3><button class="link" data-act="closepicker">Cancel</button></div>' +
    '<input type="search" id="pickq" placeholder="Search by deck or commander" autocomplete="off">' +
    '<button class="btn" style="margin-top:8px" data-act="pickernew">+ Add a deck that isn\u2019t listed</button>' +
    '</div><div id="picklist">' + pickerListHtml('') + '</div></div></div>';
}

/* ---------- share ---------- */
function openShare(text) {
  if (navigator.share) { navigator.share({ text: text }).catch(err => { if (!err || err.name !== 'AbortError') shareSheet(text); }); return; }
  shareSheet(text);
}
function shareSheet(text) {
  let el = document.getElementById('sharesheet');
  if (el) el.remove();
  el = document.createElement('div'); el.id = 'sharesheet';
  el.innerHTML = '<div class="actscrim" data-sh="close"></div><div class="actsheet" role="dialog" aria-label="Share"><div class="inner">' +
    '<p style="color:var(--ink);white-space:pre-wrap">' + esc(text) + '</p>' +
    '<button class="btn primary" data-sh="copy">Copy</button>' +
    '<a class="btn" style="display:block" href="sms:?&body=' + encodeURIComponent(text) + '">Text message</a>' +
    '<button class="btn" data-sh="close">Close</button></div></div>';
  document.body.appendChild(el);
  el.addEventListener('click', async e => {
    const a = e.target.closest('[data-sh]'); if (!a) return;
    if (a.dataset.sh === 'close') return el.remove();
    try { await navigator.clipboard.writeText(text); }
    catch (err) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e2) {} ta.remove(); }
    toast('Copied'); el.remove();
  });
}

/* ---------- typeahead (players, commanders, decks) ---------- */
function rememberPlayers() {
  const list = (S.settings.players || []).slice();
  S.draft.opponents.forEach(o => {
    const n = String(o.player || '').trim();
    if (n && !list.some(x => x.toLowerCase() === n.toLowerCase())) list.push(n);
  });
  if (list.length !== (S.settings.players || []).length) H.setSettings({ players: list });
}
function suggest(kind, i, q) {
  const ql = String(q || '').toLowerCase().trim();
  const d = S.draft, o = d.opponents[i];
  if (kind === 'mydeck') {
    return otherDecks().filter(x => x.format === d.format && (!ql || x.name.toLowerCase().indexOf(ql) !== -1))
      .slice(0, 8).map(x => ({ label: x.name, value: x.name, colors: x.colors, sub: (x.colors || '') + (x.count ? ', ' + x.count + (x.count === 1 ? ' game' : ' games') : '') }));
  }
  if (kind === 'odeck') {
    const seen = {};
    S.games.forEach(g => {
      if (!g.format || g.format === 'Commander' || g.deleted) return;
      g.opponents.forEach(x => {
        if (!x.deck) return;
        const k = x.deck.toLowerCase();
        if (!seen[k]) seen[k] = { name: x.deck, colors: x.colors, count: 0, mine: false };
        seen[k].count++;
        if (o && x.player && String(o.player).toLowerCase().trim() === x.player.toLowerCase()) seen[k].mine = true;
      });
    });
    return Object.keys(seen).map(k => seen[k]).filter(x => !ql || x.name.toLowerCase().indexOf(ql) !== -1)
      .sort((a, b) => b.mine - a.mine || b.count - a.count).slice(0, 8)
      .map(x => ({ label: x.name, value: x.name, colors: x.colors, sub: (x.mine ? 'They played it' : 'Seen ' + x.count + '\u00D7') + (x.colors ? ', ' + x.colors : '') }));
  }
  if (kind === 'player') {
    const used = d.opponents.filter((x, k) => k !== i).map(x => String(x.player).toLowerCase());
    return knownPlayers().filter(p => used.indexOf(p.name.toLowerCase()) === -1 && (!ql || p.name.toLowerCase().indexOf(ql) !== -1))
      .sort((a, b) => (b.name.toLowerCase().startsWith(ql) - a.name.toLowerCase().startsWith(ql)) || b.count - a.count)
      .slice(0, 8).map(p => ({ label: p.name, value: p.name, sub: p.count ? p.count + (p.count === 1 ? ' game' : ' games') : '' }));
  }
  if (kind === 'c1') {
    const items = [];
    const p = knownPlayers().find(x => x.name.toLowerCase() === String(o.player).toLowerCase().trim());
    if (p) p.commanders.forEach(c => {
      const label = c.c1 + (c.c2 ? ' + ' + c.c2 : '');
      if (!ql || label.toLowerCase().indexOf(ql) !== -1) items.push({ label: label, value: c.c1, c2: c.c2, sub: 'Played ' + c.count + '\u00D7' });
    });
    if (ql) searchCmds(ql, null, 10).forEach(c => {
      if (!items.some(it => it.value.toLowerCase() === c.l)) items.push({ label: c.n, value: c.n, sub: c.ci });
    });
    return items.slice(0, 8);
  }
  if (kind === 'c2') {
    const pred = partnerPredicate(cmdEntry(o.c1));
    let res = searchCmds(ql, pred, 8);
    if (!res.length && ql) res = searchCmds(ql, null, 8);
    return res.map(c => ({ label: c.n, value: c.n, sub: c.ci }));
  }
  return [];
}
/** Without the commander list (first run, still downloading), Scryfall's autocomplete fills in. */
async function scryfallNames(q) {
  if (String(q).trim().length < 2) return [];
  try {
    const r = await fetch('https://api.scryfall.com/cards/autocomplete?q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' } });
    return ((await r.json()).data || []).slice(0, 8).map(n => ({ label: n, value: n, sub: '' }));
  } catch (e) { return []; }
}
function setField(kind, i, value, picked, item) {
  const o = S.draft.opponents[i];
  if (kind === 'mydeck') {
    S.draft.deckName = value;
    if (picked && item && item.colors) S.draft.myColors = item.colors;
    touch(); if (picked) H.rerenderKeep(); return;
  }
  if (kind === 'odeck') {
    o.deck = value;
    if (picked && item && item.colors && !o.colors) o.colors = item.colors;
    touch(); if (picked) H.rerenderKeep(); return;
  }
  if (kind === 'player') o.player = value;
  if (kind === 'c1') { o.c1 = value; if (picked && item && item.c2 !== undefined) { o.c2 = item.c2 || ''; o.showC2 = !!item.c2; } }
  if (kind === 'c2') o.c2 = value;
  touch();
  if (picked) {
    H.rerenderKeep();
    if (kind === 'player') { const nxt = document.getElementById(isCmd() ? 'c' + i : 'od' + i); if (nxt && !(isCmd() ? o.c1 : o.deck)) nxt.focus(); }
  } else if (kind === 'player') {
    const h = app.querySelectorAll('.opp h3')[i]; if (h) h.textContent = oppName(o, i);
    const fb = app.querySelector('[data-seg="first"][data-val="o' + i + '"]'); if (fb) fb.textContent = oppName(o, i);
    if (teamSize()) app.querySelectorAll('[data-seg="first"]').forEach(x => { x.textContent = lcInfo(x.dataset.val).name; });
  } else if (kind === 'c1' && !o.c2 && !o.showC2) {
    const slot = document.getElementById('c2slot-' + i); if (slot) slot.innerHTML = c2SlotHtml(o, i);
  }
}
function bindTypeahead(input) {
  const kind = input.dataset.ta, i = +input.dataset.i;
  const list = input.parentElement.querySelector('.ta-list');
  let items = [], hi = 0, seq = 0;
  const paint = () => {
    if (!items.length) { list.hidden = true; return; }
    list.innerHTML = items.map((it, k) => '<li data-k="' + k + '" class="' + (k === hi ? 'hi' : '') + '"><span>' + esc(it.label) + '</span>' + (it.sub ? '<small>' + esc(it.sub) + '</small>' : '') + '</li>').join('');
    list.hidden = false;
  };
  const show = () => {
    items = suggest(kind, i, input.value); hi = 0; paint();
    if ((kind === 'c1' || kind === 'c2') && !CMD.list.length && items.length < 8) {
      const mine = ++seq, q = input.value;
      clearTimeout(input._sf);
      input._sf = setTimeout(async () => {
        const extra = await scryfallNames(q);
        if (mine !== seq || document.activeElement !== input) return;
        extra.forEach(x => { if (!items.some(it => it.value.toLowerCase() === x.value.toLowerCase())) items.push(x); });
        items = items.slice(0, 8); paint();
      }, 200);
    }
  };
  const pick = it => { if (!it) return; input.value = it.value; list.hidden = true; setField(kind, i, it.value, true, it); };
  input.addEventListener('focus', show);
  input.addEventListener('input', () => { setField(kind, i, input.value, false); show(); });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 180));
  input.addEventListener('keydown', e => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { hi = Math.min(hi + 1, items.length - 1); paint(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { hi = Math.max(hi - 1, 0); paint(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(items[hi]); }
    else if (e.key === 'Escape') { list.hidden = true; }
  });
  list.addEventListener('mousedown', e => { const li = e.target.closest('li'); if (li) { e.preventDefault(); pick(items[+li.dataset.k]); } });
}
/** Called after every render. */
export function afterRender() {
  lcAfterRender();
  app.querySelectorAll('input[data-ta]').forEach(bindTypeahead);
  const q = document.getElementById('pickq');
  if (q) q.addEventListener('input', () => { document.getElementById('picklist').innerHTML = pickerListHtml(q.value); });
}

/* ---------- saving ---------- */
function saveGame(btn) {
  const d = S.draft;
  if (isCmd(d) && !d.deckId) return toast('Choose your deck first.', true);
  if (!isCmd(d) && d.bo3 && sides(d) === 2) {
    if (d.matchW == null || d.matchL == null) return toast('Choose how many games each side won.', true);
    matchToPlaces(d);
  }
  if (!d.myPlace) return toast(isCmd(d) ? 'Choose where you finished.' : 'Choose how it went.', true);
  const prev = d.gameId ? gameById(d.gameId) : null;
  if (d.gameId && !prev) return toast('That game isn\u2019t on this device yet. Try again in a moment.', true);
  if (lockedFor(prev)) return toast('This game is locked.', true);
  btn.disabled = true;
  const rec = toRecord(d, prev), me = uid(), edited = !!d.gameId, id = d.gameId || d.id;
  const failed = err => toast('Couldn\u2019t save that game: ' + ((err && (err.code || err.message)) || err), true);
  if (edited) D.updateGame(me, id, prev.doc || prev.raw, rec, failed);
  else D.createGame(me, id, rec, failed);
  if (!isCmd(d) && d.event && d.event.id && !d.event.existing) {
    D.saveEvent(me, d.event.id, { date: d.event.date || d.date, format: d.format, set: String(d.event.set || '').trim(), store: String(d.event.store || '').trim(),
      colors: d.myColors || '', status: 'Active', createdAt: D.serverTimestamp() });
  }
  rememberPlayers();
  S.lastGame = edited ? null : fromRecord(id, rec);
  dropDraft();
  toast(edited ? 'Changes saved' : (+rec.seats[0].place === 1 && !rec.draw ? 'Game saved. Nice win.' : 'Game saved') + (navigator.onLine ? '' : '. It syncs when you\u2019re back online.'));
  H.go('home');
}
function hide(ids) {
  const items = ids.map(gameById).filter(g => g && !lockedFor(g)).map(g => ({ id: g.gameId, prev: g.doc || g.raw }));
  if (!items.length) return 0;
  D.hideGames(uid(), items, err => toast('Couldn\u2019t delete: ' + ((err && (err.code || err.message)) || err), true));
  if (S.draft && S.draft.gameId && ids.indexOf(S.draft.gameId) !== -1) dropDraft(); // you were editing one of them
  return items.length;
}

/* ---------- taps ---------- */
/** Handles a tap on a game screen. Returns true when it was one of these. */
export function onAct(act, el) {
  const d = S.draft, K = H.rerenderKeep;
  switch (act) {
    case 'new':
      if (d && !confirm('Discard the game in progress and start a new one?')) return true;
      S.draft = newDraft(); touch(); H.go('setup'); return true;
    case 'quick':
      if (d && !confirm('Discard the game in progress and log a different one?')) return true;
      S.draft = Object.assign(newDraft(), { quick: true, turns: '' }); touch(); H.go('setup'); return true;
    case 'resume': H.go(d.stage === 'playing' ? 'playing' : d.stage === 'ending' ? 'ending' : 'setup'); return true;
    case 'discard': if (confirm('Discard this game? It hasn\u2019t been saved.')) { dropDraft(); K(); } return true;
    case 'recent': S.sel = null; S.gameMenu = null; S.recentShown = 25; H.go('recent'); return true;
    case 'recentmore': S.recentShown += 25; K(); return true;
    case 'pick': S.picker = true; K(); setTimeout(() => { const q = document.getElementById('pickq'); if (q && matchMedia('(pointer:fine)').matches) q.focus(); }, 0); return true;
    case 'closepicker': S.picker = false; K(); return true;
    case 'choosedeck': {
      const deck = deckById(el.dataset.deck);
      if (deck) { d.deckId = deck.id; d.deckName = deck.name; touch(); }
      S.picker = false; K(); return true;
    }
    case 'pickernew': S.picker = false; H.newDeck(true); return true;
    case 'pickplayer': {
      const i = +el.dataset.i; d.opponents[i].player = el.dataset.name; touch(); K();
      const c = document.getElementById(isCmd() ? 'c' + i : 'od' + i); if (c && !(isCmd() ? d.opponents[i].c1 : d.opponents[i].deck)) c.focus(); return true;
    }
    case 'addc2': d.opponents[+el.dataset.i].showC2 = true; K(); { const f = document.getElementById('d' + el.dataset.i); if (f) f.focus(); } return true;
    case 'rmc2': { const o = d.opponents[+el.dataset.i]; o.c2 = ''; o.showC2 = false; touch(); K(); return true; }
    case 'setfmt': applyFormat(el.dataset.val); S.fmtOpen = false; S.lifeCustom = false; touch(); K(); return true;
    case 'newevent': d.event = { id: 'E' + Date.now().toString(36), set: '', store: '', date: d.date }; d.myColors = ''; touch(); K(); return true;
    case 'mana': {
      const w = el.dataset.who;
      if (w === 'my') d.myColors = toggleColor(d.myColors, el.dataset.c);
      else { const o = d.opponents[+w]; o.colors = toggleColor(o.colors, el.dataset.c); }
      touch(); el.classList.toggle('on'); el.setAttribute('aria-pressed', el.classList.contains('on')); return true;
    }
    case 'evnext': {
      const e = S.events.find(x => x.id === el.dataset.id);
      if (!e) return true;
      if (d && !confirm('Discard the game in progress and start the next match?')) return true;
      S.draft = Object.assign(newDraft(), { format: e.format });
      const f = fmtOf(S.draft);
      Object.assign(S.draft, { startLife: f.life || 20, bo3: true, myColors: e.colors || '', event: { id: e.id, set: e.set, store: e.store, date: e.date, existing: true } });
      resizePod(f.team ? f.team * 2 : 2);
      if (f.team) S.draft.opponents.forEach((o, i) => { o.team = i < f.team - 1 ? 'A' : 'B'; });
      touch(); H.go('setup'); return true;
    }
    case 'evend': {
      const e = S.events.find(x => x.id === el.dataset.id);
      if (!e || !confirm('End ' + eventLabel(e) + ' with a ' + recordText(e) + ' record?')) return true;
      e.status = 'Complete'; D.saveEvent(uid(), e.id, { status: 'Complete' });
      toast('Event finished at ' + recordText(e)); K(); return true;
    }
    case 'start':
      if (isCmd(d) && !d.deckId) { toast('Choose your deck first.', true); return true; }
      if (!isCmd(d) && d.event && !d.event.existing && !String(d.event.set || '').trim()) { toast('Type the set for this event first.', true); return true; }
      if (!isCmd(d)) d.deckName = deckLabel(d);
      if (d.gameId || d.stage === 'ending' || d.quick) { rememberPlayers(); d.stage = 'ending'; touch(); H.go('ending'); return true; }
      ensureFirstPlayer(); rememberPlayers();
      d.stage = 'playing'; touch();
      if (S.settings.gameMode === 'simple' && d.announceFirst) { d.announceFirst = false; toast(lcInfo(d.firstKey).name + (plural(d.firstKey) ? ' go first' : ' goes first')); }
      H.go('playing'); return true;
    case 'editsetup': H.go('setup'); return true;
    case 'turn+': case 'turn-':
      d.turns = Math.max(1, (+d.turns || 1) + (act === 'turn+' ? 1 : -1)); touch();
      document.querySelector('#turnout b').textContent = d.turns; return true;
    case 'end': d.stage = 'ending'; touch(); H.go('ending'); return true;
    case 'backtogame': d.stage = 'playing'; touch(); H.go('playing'); return true;
    case 'save': saveGame(el); return true;
    case 'delete':
      if (!confirm('Delete this game?')) return true;
      hide([d.gameId]); dropDraft(); toast('Game deleted'); H.go('home'); return true;
    case 'shareend': openShare(shareText(Object.assign({}, d, { deckName: isCmd(d) ? d.deckName : deckLabel(d), format: isCmd(d) ? 'Commander' : d.format, set: d.event ? d.event.set : d.set,
      matchScore: d.bo3 && d.matchW != null && d.matchL != null ? d.matchW + '-' + d.matchL : '' }))); return true;
    case 'edit': {
      const id = el.dataset.id;
      if (S.sel) { if (S.sel[id]) delete S.sel[id]; else S.sel[id] = true; K(); return true; }
      const g = gameById(id); if (!g) return true;
      if (lockedFor(g)) { toast('This game is locked.', true); return true; }
      if (d && !(d.gameId === id) && !confirm('Discard the game in progress and edit this one instead?')) return true;
      if (!(d && d.gameId === id)) { S.draft = gameToDraft(g); touch(); }
      H.go('ending'); return true;
    }
    case 'menuclose': S.gameMenu = null; K(); return true;
    case 'rematch': case 'menurematch': {
      const g = act === 'rematch' ? S.lastGame : gameById(S.gameMenu);
      if (!g) return true;
      if (d && !confirm('Discard the game in progress and start a rematch?')) return true;
      S.gameMenu = null; S.lastGame = null;
      S.draft = rematchFrom(g); touch(); toast('Same pod loaded. Change anything you need, then start.'); H.go('setup'); return true;
    }
    case 'sharelast': if (S.lastGame) openShare(shareText(S.lastGame)); return true;
    case 'nolast': S.lastGame = null; K(); return true;
    case 'menushare': { const g = gameById(S.gameMenu); S.gameMenu = null; K(); if (g) openShare(shareText(g)); return true; }
    case 'menuedit': {
      const id = S.gameMenu; S.gameMenu = null;
      const row = app.querySelector('.game[data-id="' + CSS.escape(id) + '"]');
      if (row) row.click(); return true;
    }
    case 'menusel': { const id = S.gameMenu; S.gameMenu = null; S.sel = {}; if (id) S.sel[id] = true; K(); return true; }
    case 'selnone': S.sel = {}; K(); return true;
    case 'seldone': S.sel = null; K(); return true;
    case 'menudel': case 'seldel': {
      const ids = act === 'menudel' ? [S.gameMenu] : Object.keys(S.sel || {});
      if (!ids.length) return true;
      const g = act === 'menudel' ? gameById(S.gameMenu) : null;
      if (!confirm(g ? 'Delete ' + (g.deckName || g.format) + ' from ' + niceDate(g.date) + '?' : 'Delete ' + ids.length + (ids.length === 1 ? ' game' : ' games') + '?')) return true;
      const n = hide(ids);
      S.gameMenu = null; S.sel = null;
      toast(n === 1 ? 'Game deleted' : n + ' games deleted'); K(); return true;
    }
  }
  return false;
}
export function onSegG(name, val) {
  const d = S.draft, n = isNaN(+val) ? val : +val;
  if (!d) return false;
  if (name === 'slife') {
    if (val === 'custom') { S.lifeCustom = true; H.rerenderKeep(); return true; }
    S.lifeCustom = false; d.startLife = n; touch(); H.rerenderKeep(); return true;
  }
  if (name === 'bo3') { d.bo3 = val === '3'; touch(); H.rerenderKeep(); return true; }
  if (name === 'mw' || name === 'tw') { d[name === 'mw' ? 'matchW' : 'matchL'] = n; matchToPlaces(d); touch(); H.rerenderKeep(); return true; }
  if (name === 'pod') resizePod(n);
  else if (name === 'first') {
    if (d.firstKey === val) { d.firstKey = null; d.mySeat = null; d.opponents.forEach(o => { o.seat = null; }); }
    else assignTurnOrder(val);
  }
  else if (name === 'place') {
    d.myPlace = n;
    if (n === 1) d.opponents.forEach(o => { if (+o.place === 1) o.place = null; });
  }
  else if (name === 'winner') { d.opponents.forEach((o, i) => { if (i === n) o.place = 1; else if (+o.place === 1) o.place = null; }); }
  else if (name.indexOf('oplace-') === 0) {
    const i = +name.slice(7), o = d.opponents[i];
    o.place = o.place === n ? null : n;
    if (o.place === 1) { d.opponents.forEach((x, k) => { if (k !== i && +x.place === 1) x.place = null; }); if (+d.myPlace === 1 && !d.draw) d.myPlace = null; }
  }
  else return false;
  touch(); H.rerenderKeep(); return true;
}
/** Typing in a game screen's fields. */
export function onInputG(t) {
  if (lcEmblemSearch(t)) return true;
  const ds = t.dataset || {};
  if (ds.field && S.draft) { if (ds.field !== 'draw') { S.draft[ds.field] = t.value; touch(); } return true; }
  if (ds.ev && S.draft && S.draft.event) { S.draft.event[ds.ev] = t.value; touch(); return true; }
  return false;
}
export function onChangeG(t) {
  const f = t.dataset && t.dataset.field;
  if (!f || !S.draft) return false;
  if (f === 'draw') { S.draft.draw = t.checked; touch(); H.rerenderKeep(); return true; }
  S.draft[f] = t.value; touch();
  if (f === 'winCondition') H.rerenderKeep();
  return true;
}

/* ---------- press and hold a recent game for its menu ---------- */
let press = null;
app.addEventListener('pointerdown', e => {
  const el = e.target.closest && e.target.closest('[data-press="game"]');
  if (!el || S.sel) return;
  const p = press = { el: el, x: e.clientX, y: e.clientY };
  el.classList.add('pressing');
  p.t = setTimeout(() => {
    if (press !== p) return;
    el.classList.remove('pressing');
    S.pressFired = true; S.liftAt = 0; S.gameMenu = el.dataset.id; press = null;
    try { if (navigator.vibrate) navigator.vibrate(15); } catch (err) {}
    H.rerenderKeep();
  }, 500);
});
const endPress = () => { if (press) { clearTimeout(press.t); press.el.classList.remove('pressing'); press = null; } };
app.addEventListener('pointermove', e => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) endPress(); });
app.addEventListener('pointerup', () => { endPress(); if (S.pressFired && !S.liftAt) S.liftAt = Date.now(); });
app.addEventListener('pointercancel', endPress);
// the finger lifting after a long press shouldn't also tap whatever the menu put under it (some phones send that tap, some don't)
document.addEventListener('click', e => {
  if (!S.pressFired) return;
  const lift = !S.liftAt || Date.now() - S.liftAt < 350;
  S.pressFired = false; S.liftAt = 0;
  if (lift) { e.stopPropagation(); e.preventDefault(); }
}, true);
app.addEventListener('contextmenu', e => { if (e.target.closest && e.target.closest('[data-press="game"]')) e.preventDefault(); });

/* ---------- Settings: formats and the commander list ---------- */
export function settingsGameHtml() {
  const st = S.settings;
  let h = '<details class="collapse" id="lcsec"' + (S.open.lcsec ? ' open' : '') + '><summary><h2 style="display:inline">During games</h2></summary>';
  h += '<div class="field"><span class="label">Start a game opens</span>' + seg('gamemode', [{ val: 'life', label: 'Life counter' }, { val: 'simple', label: 'Round counter only' }], st.gameMode || 'life') + '</div>';
  h += '<div class="field"><span class="label">Turn reminders</span>' + seg('reminders', [{ val: 'on', label: 'On' }, { val: 'off', label: 'Off' }], st.reminders === false ? 'off' : 'on') +
    '<p class="muted" style="margin-top:6px"><small>Shows \u201Cdraw a card\u201D when the monarch passes the turn, \u201Cventure into the Undercity\u201D for the player with the initiative, and a rad counter reminder two seconds into the turn of anyone with rads.</small></p></div>';
  h += '<div class="field"><span class="label">Full screen</span>' + seg('fullscreen', [{ val: 'on', label: 'On' }, { val: 'off', label: 'Off' }], st.fullscreen === false ? 'off' : 'on') +
    '<p class="muted" style="margin-top:6px"><small>Hides the browser bars when supported. Swipe from the edge or turn this off to get them back. (A home screen app is already full screen.)</small></p></div>';
  h += '<span class="label" style="margin-top:14px">Life counter layout</span><p class="muted" style="margin-top:0"><small>How players are arranged around the phone for each pod size. The highlighted spot is you.</small></p>';
  [2, 3, 4, 5, 6].forEach(n => {
    const cur = lcLayout(n).id;
    h += '<div class="field"><span class="label">' + n + ' players</span><div class="layoutrow">' +
      LC_LAYOUTS[n].map(lay => '<button class="layoutopt' + (lay.id === cur ? ' on' : '') + '" data-seg="layout-' + n + '" data-val="' + lay.id + '">' + layoutPreview(lay) + '<span>' + esc(lay.name) + '</span></button>').join('') + '</div></div>';
  });
  h += '<span class="label" style="margin-top:14px">Elimination messages</span><p class="muted" style="margin-top:0"><small>Shown over a player\u2019s panel when they\u2019re knocked out. One per line. Lines match how they died when possible, otherwise one from \u201CAny kind of death\u201D is used. Type {killer} to insert the name of whoever knocked them out.</small></p>';
  ELIM_CATS.forEach(c => {
    h += '<div class="field"><label for="el-' + c[0] + '">' + c[1] + '</label><textarea id="el-' + c[0] + '" data-elim="' + c[0] + '" rows="' + Math.max(3, elimLines(c[0]).length + 1) + '" autocomplete="off" spellcheck="false">' + esc(elimLines(c[0]).join('\n')) + '</textarea></div>';
  });
  h += '<button class="link" data-act="elimreset">Reset to the original lines</button></details>';
  h += '<details class="collapse" id="fmtsec"' + (S.open.fmtsec ? ' open' : '') + '><summary><h2 style="display:inline">Formats</h2></summary>' +
    '<p class="muted">The formats you can pick when starting a game, besides Commander. \u201CUses a set\u201D asks for the set (for Limited). \u201CEvent\u201D groups matches into an event, like a prerelease.</p>';
  formatList().forEach((f, i) => {
    h += '<div class="panel fmtrow"><div class="row" style="align-items:end"><div class="field" style="flex:2"><label for="fn' + i + '">Name</label><input type="text" id="fn' + i + '" data-fmt="' + i + '|name" value="' + esc(f.name) + '" autocomplete="off"></div>' +
      '<div class="field" style="flex:1"><label for="fl' + i + '">Starting life</label><input type="number" inputmode="numeric" min="1" id="fl' + i + '" data-fmt="' + i + '|life" value="' + esc(f.life) + '"></div></div>' +
      '<div class="fmtopts">' + (f.team ? '<span class="muted">Teams of ' + f.team + ', shared life</span>' : '') +
      '<label><input type="checkbox" data-fmtc="' + i + '|set"' + (f.set ? ' checked' : '') + '> Uses a set</label>' +
      '<label><input type="checkbox" data-fmtc="' + i + '|event"' + (f.event ? ' checked' : '') + '> Event</label>' +
      '<label><input type="checkbox" data-fmtc="' + i + '|show"' + (f.show !== false ? ' checked' : '') + '> Show in New game</label>' +
      '<button class="link danger" data-act="fmtdel" data-i="' + i + '">Remove</button></div></div>';
  });
  h += '<button class="btn" data-act="fmtadd">+ Add a format</button><button class="link" style="display:block;margin-top:10px" data-act="fmtreset">Reset to the original list</button></details>';
  const n = liveGames().length;
  h += '<details class="collapse" id="datasec"' + (S.open.datasec ? ' open' : '') + '><summary><h2 style="display:inline">Data</h2></summary>' +
    '<div class="panel"><p style="margin:0">Update the commander list after a new set comes out. It also updates on its own every two weeks.</p>' +
    '<button class="btn" style="margin-top:10px" data-act="refreshcmds"' + (CMD.loading ? ' disabled' : '') + '>' + (CMD.loading ? 'Downloading\u2026' : 'Refresh commander list') + '</button></div>' +
    '<p class="muted"><small>' + CMD.list.length + ' commanders on this device' + (CMD.at ? ' (updated ' + new Date(CMD.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ')' : '') +
    ', ' + n + (n === 1 ? ' game' : ' games') + ' logged.</small></p></details>';
  return h;
}
export function onSettingsAct(act, el) {
  const save = list => H.setSettings({ formats: list });
  switch (act) {
    case 'fmtadd': {
      const list = formatList(); list.push({ name: 'New format', life: 20, set: false, event: false, team: 0, show: true });
      save(list); H.rerenderKeep();
      const inp = document.getElementById('fn' + (list.length - 1)); if (inp) { inp.focus(); inp.select(); } return true;
    }
    case 'fmtdel': {
      const list = formatList(), f = list[+el.dataset.i];
      if (!f || !confirm('Remove ' + f.name + ' from your formats? Games you already logged keep it.')) return true;
      list.splice(+el.dataset.i, 1); save(list); H.rerenderKeep(); return true;
    }
    case 'fmtreset':
      if (!confirm('Put the format list back to the original one?')) return true;
      save(FORMAT_DEFAULTS.map(x => Object.assign({}, x))); H.rerenderKeep(); return true;
    case 'elimreset':
      if (!confirm('Replace your elimination messages with the original lines?')) return true;
      H.setSettings({ elimLines: null }); H.rerenderKeep(); return true;
    case 'refreshcmds':
      ensureCommanders(true).then(msg => { toast(msg || 'Up to date'); if (S.view === 'settings') H.rerenderKeep(); })
        .catch(err => { toast('Couldn\u2019t download the commander list: ' + (err.message || err), true); if (S.view === 'settings') H.rerenderKeep(); });
      H.rerenderKeep(); return true;
  }
  return false;
}
export function onSettingsInput(t) {
  const cat = t.dataset && t.dataset.elim;
  if (cat) {
    H.setSettings({ elimLines: Object.assign({}, S.settings.elimLines, { [cat]: t.value.split('\n').map(x => x.trim()).filter(Boolean) }) });
    return true;
  }
  const k = t.dataset && t.dataset.fmt;
  if (!k) return false;
  const p = k.split('|'), list = formatList(), f = list[+p[0]];
  if (!f) return true;
  f[p[1]] = p[1] === 'life' ? (parseInt(t.value, 10) || 20) : t.value;
  H.setSettings({ formats: list }); // sent a moment after the last keystroke
  return true;
}
export function onSettingsChange(t) {
  const k = t.dataset && t.dataset.fmtc;
  if (!k) return false;
  const p = k.split('|'), list = formatList(), f = list[+p[0]];
  if (!f) return true;
  f[p[1]] = t.checked; H.setSettings({ formats: list });
  return true;
}

export function onSettingsSeg(name, val) {
  if (name === 'gamemode') { H.setSettings({ gameMode: val }); H.rerenderKeep(); return true; }
  if (name === 'reminders') { H.setSettings({ reminders: val === 'on' }); H.rerenderKeep(); return true; }
  if (name === 'fullscreen') {
    H.setSettings({ fullscreen: val === 'on' });
    if (val === 'on') { S.fsBlocked = false; fsRequest(true); } else fsExit();
    H.rerenderKeep(); return true;
  }
  if (name.indexOf('layout-') === 0) { H.setSettings({ layouts: Object.assign({}, S.settings.layouts, { [name.slice(7)]: val }) }); H.rerenderKeep(); return true; }
  return false;
}

/* ---------- full screen (from classic 1.13) ---------- */
function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement; }
function fsRequest(explicit) {
  const el = document.documentElement, fn = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!fn || fsElement() || matchMedia('(display-mode: standalone)').matches) return;
  try {
    const r = fn.call(el, { navigationUI: 'hide' });
    if (r && r.catch) r.catch(() => { S.fsBlocked = true; if (explicit) toast('Your browser won\u2019t allow full screen here.', true); });
  } catch (e) { S.fsBlocked = true; if (explicit) toast('Your browser won\u2019t allow full screen here.', true); }
}
function fsExit() { const fn = document.exitFullscreen || document.webkitExitFullscreen; if (fn && fsElement()) try { fn.call(document); } catch (e) {} }
// Browsers only allow full screen right after a tap, so taps during a game re-check (until the browser says no).
document.addEventListener('click', () => { if (S.user && S.view === 'playing' && S.settings.fullscreen !== false && !S.fsBlocked) fsRequest(false); }, true);
