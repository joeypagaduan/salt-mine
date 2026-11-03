// Game logic, ported from classic 1.13: formats, the game being set up (the "draft"), turn order,
// share text, rematch, and converting between a draft and the saved game record in Firestore.
import { S, uid } from './state.js';
import { cmdColors } from './commanders.js';

export const WINCONS = ['Combat damage', 'Commander damage', 'Combo', 'Infect / poison', 'Life drain', 'Alternate win card', 'Mill', 'Concession', 'Other'];
export const FORMAT_DEFAULTS = [
  { name: 'Standard', life: 20 }, { name: 'Pioneer', life: 20 }, { name: 'Modern', life: 20 }, { name: 'Pauper', life: 20 },
  { name: 'Casual', life: 20 }, { name: 'Prerelease', life: 20, set: true, event: true }, { name: 'Draft', life: 20, set: true },
  { name: 'Sealed', life: 20, set: true }, { name: 'Two-Headed Giant', life: 30, team: 2 }, { name: 'Three-Headed Giant', life: 50, team: 3 }
].map(f => Object.assign({ set: false, event: false, team: 0, show: true }, f));
export const LIFE_CHOICES = [20, 25, 30, 40, 60];
export const MANA_BTN = [['W', '#E9DDA2', '#3a3420'], ['U', '#2E7BC4', '#fff'], ['B', '#4B4049', '#fff'], ['R', '#D6452F', '#fff'], ['G', '#2F8F55', '#fff']];
export const DRAW_RESULT = 'Draw / shared win';

/* ---------- small helpers ---------- */
export function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
export function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
export function niceDate(ymd) {
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return ymd;
  const d = new Date(+m[1], +m[2] - 1, +m[3]), opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}
export const range = n => Array.from({ length: n }, (_, i) => i + 1);
export const myName = () => String((S.profile && S.profile.name) || '').trim();
export const deckById = id => S.decks.find(d => d.id === String(id));
export const oppName = (o, i) => (o && String(o.player || '').trim()) || 'Opponent ' + (i + 1);
export const shortCmd = n => String(n || '').split(',')[0].split(' // ')[0];
export function toggleColor(cur, c) { cur = String(cur || ''); const s = cur.indexOf(c) !== -1 ? cur.replace(c, '') : cur + c; return 'WUBRG'.split('').filter(x => s.indexOf(x) !== -1).join(''); }

/* ---------- the game in progress ---------- */
export function blankOpp() { return { player: '', c1: '', c2: '', seat: null, place: null, showC2: false, deck: '', colors: '', team: '' }; }
export function newDraft() {
  return { id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), stage: 'setup', gameId: null,
    createdAt: Date.now(), updatedAt: Date.now(), date: today(), deckId: '', deckName: '',
    podSize: 4, mySeat: null, opponents: [blankOpp(), blankOpp(), blankOpp()], turns: 1, notes: '', myPlace: null,
    winCondition: '', winOther: '', elimBy: '', elimHow: '', draw: false,
    format: '', set: '', startLife: '', bo3: false, myColors: '', event: null, matchW: null, matchL: null };
}
export function resizePod(n, d) {
  d = d || S.draft; d.podSize = n;
  while (d.opponents.length < n - 1) d.opponents.push(blankOpp());
  d.opponents.length = Math.max(0, n - 1);
  if (d.mySeat > n) d.mySeat = null;
  if (d.myPlace > n) d.myPlace = null;
  d.opponents.forEach(o => { if (o.seat > n) o.seat = null; if (o.place > n) o.place = null; });
}

/* ---------- formats ---------- */
export function formatList() { const f = S.settings.formats; return Array.isArray(f) && f.length ? f.map(x => Object.assign({}, x)) : FORMAT_DEFAULTS.map(x => Object.assign({}, x)); }
export function isCmd(d) { d = d || S.draft; return !d || !d.format || d.format === 'Commander'; }
export function fmtOf(d) {
  d = d || S.draft;
  if (isCmd(d)) return null;
  return formatList().find(f => f.name === d.format) || FORMAT_DEFAULTS.find(f => f.name === d.format) || { name: d.format, life: 20, set: !!d.set, event: !!d.event, team: +d.team || 0 };
}
export function teamSize(d) { d = d || S.draft; const f = fmtOf(d); return f && f.team ? +f.team : 0; }
/** Players or teams facing each other: 2 means best of 3 is possible. */
export function sides(d) { d = d || S.draft; return teamSize(d) ? 2 : d.podSize; }
export function startLife(d) { d = d || S.draft; return isCmd(d) ? 40 : (parseInt(d.startLife, 10) > 0 ? parseInt(d.startLife, 10) : 20); }
export function teammates(d) { d = d || S.draft; const t = teamSize(d); return t ? d.opponents.slice(0, t - 1) : []; }
export function otherTeam(d) { d = d || S.draft; const t = teamSize(d); return t ? d.opponents.slice(t - 1) : []; }
/** Name shown for your deck in non-Commander games: the typed name, or the set plus format for Limited. */
export function deckLabel(d) {
  d = d || S.draft;
  if (isCmd(d)) return d.deckName;
  const set = d.event ? d.event.set : d.set;
  return String(d.deckName || '').trim() || (set ? set + ' ' + d.format : d.format);
}
export function activeEvent(format) { return S.events.find(e => e.status === 'Active' && (!format || e.format === format)); }
export function eventLabel(e) { return (e.set ? e.set + ' ' : '') + e.format + (e.store ? ' at ' + e.store : ''); }
export function recordText(e) { return e.wins + '-' + e.losses + (e.draws ? '-' + e.draws : ''); }
/** Switches the game being set up to a format (or back to Commander). */
export function applyFormat(name) {
  const d = S.draft;
  d.format = name === 'Commander' ? '' : name;
  d.event = null; d.set = d.set || '';
  if (isCmd(d)) { d.startLife = ''; d.bo3 = false; resizePod(d.podSize < 3 ? 4 : d.podSize); d.opponents.forEach(o => { o.team = ''; }); return; }
  const f = fmtOf(d);
  d.deckId = ''; d.startLife = f.life || 20;
  if (f.team) {
    resizePod(f.team * 2);
    d.opponents.forEach((o, i) => { o.team = i < f.team - 1 ? 'A' : 'B'; });
  } else {
    if (d.podSize > 2 && !d.opponents.slice(1).some(o => String(o.player || '').trim())) resizePod(2);
    d.opponents.forEach(o => { o.team = ''; });
  }
  d.bo3 = !!f.event && sides(d) === 2;
  if (f.event) {
    const a = activeEvent(f.name);
    d.event = a ? { id: a.id, set: a.set, store: a.store, date: a.date, existing: true } : { id: 'E' + Date.now().toString(36), set: '', store: '', date: d.date };
    if (a && a.colors && !d.myColors) d.myColors = a.colors;
  }
}
export function matchToPlaces(d) {
  if (d.matchW == null || d.matchL == null) return;
  d.draw = +d.matchW === +d.matchL;
  d.myPlace = +d.matchW >= +d.matchL ? 1 : 2;
  const theirs = d.draw ? 1 : (d.myPlace === 1 ? 2 : 1);
  if (teamSize(d)) { teammates(d).forEach(o => { o.place = d.myPlace; }); otherTeam(d).forEach(o => { o.place = theirs; }); }
  else d.opponents.forEach(o => { o.place = theirs; });
}

/* ---------- players and turn order ---------- */
export function isYou(k) { return k === 'me' && !myName(); }
export function plural(k) { return isYou(k) || (!!S.draft && teamSize() > 0); } // "Joey & Megan go first"
export function lcKeys() { return teamSize() ? ['me', 'g1'] : ['me'].concat(S.draft.opponents.map((o, i) => 'o' + i)); }
export function lcInfo(k) {
  const d = S.draft;
  if (teamSize()) {
    const names = k === 'me' ? [myName() || 'You'].concat(teammates().map(o => String(o.player || '').trim()).filter(Boolean))
      : otherTeam().map(o => String(o.player || '').trim()).filter(Boolean);
    return { name: names.join(' & ') || (k === 'me' ? 'Your team' : 'Other team'), c1: '', c2: '', colors: k === 'me' ? (d.myColors || 'C') : 'C' };
  }
  if (!isCmd(d)) {
    if (k === 'me') return { name: myName() || 'You', c1: '', c2: '', colors: d.myColors || 'C' };
    const i = +k.slice(1), o = d.opponents[i] || {};
    return { name: oppName(o, i), c1: '', c2: '', colors: o.colors || 'C' };
  }
  if (k === 'me') {
    const deck = deckById(d.deckId);
    return { name: myName() || 'You', c1: deck ? deck.c1 : '', c2: deck ? deck.c2 : '', colors: deck ? deck.colors : 'C' };
  }
  const i = +k.slice(1), o = d.opponents[i] || {};
  return { name: oppName(o, i), c1: o.c1 || '', c2: o.c2 || '', colors: cmdColors(o.c1, o.c2) || 'C' };
}
/** You are entered first and opponents clockwise, so seats follow entry order.
 *  Turn order (the "seat" saved with the game) counts from the first player. */
export function setSeatFor(k, seat) {
  const d = S.draft;
  if (teamSize()) { (k === 'me' ? teammates() : otherTeam()).forEach(o => { o.seat = seat; }); if (k === 'me') d.mySeat = seat; return; }
  if (k === 'me') d.mySeat = seat; else d.opponents[+k.slice(1)].seat = seat;
}
export function assignTurnOrder(firstKey) {
  const d = S.draft, keys = lcKeys(), n = keys.length, f = keys.indexOf(firstKey);
  keys.forEach((k, i) => setSeatFor(k, ((i - f + n) % n) + 1));
  d.firstKey = firstKey;
}
export function ensureFirstPlayer() {
  const d = S.draft, keys = lcKeys();
  if (!d.firstKey || keys.indexOf(d.firstKey) === -1) {
    assignTurnOrder(keys[Math.floor(Math.random() * keys.length)]);
    d.announceFirst = true;
  } else assignTurnOrder(d.firstKey); // pod may have changed
}

/* ---------- share a result ---------- */
/** One or two sentences about a game, for a group chat. Works from a draft being saved or a game in Recent games. */
export function shareText(g) {
  const other = g.format && g.format !== 'Commander', me = myName() || 'I';
  const opps = (g.opponents || []).filter(o => o.team !== 'A');
  const mates = (g.opponents || []).filter(o => o.team === 'A').map(o => o.player).filter(Boolean);
  const who = mates.length ? me + ' & ' + mates.join(' & ') : me;
  const place = +g.myPlace, won = place === 1 && !g.draw;
  const deck = g.deckName || (other ? g.format : 'my deck');
  let t = 'The Salt Mine, ' + niceDate(g.date) + ': ';
  if (g.draw) t += who + ' shared the win with ' + deck;
  else if (other && opps.length <= (mates.length ? mates.length + 1 : 1)) t += who + (won ? ' beat ' : ' lost to ') + (opps.map(o => o.player + (o.deck ? ' (' + o.deck + ')' : '')).join(' & ') || 'an opponent') + (g.matchScore ? ' ' + g.matchScore : '') + ' with ' + deck;
  else t += who + (won ? ' won' : ' finished ' + ordinal(place)) + ' with ' + deck;
  const bits = [];
  if (other) bits.push(g.format + (g.set ? ', ' + g.set : ''));
  else if (g.podSize) bits.push(g.podSize + ' players');
  if (g.turns) bits.push(g.turns + (+g.turns === 1 ? ' round' : ' rounds'));
  if (g.winCondition && won) bits.push(g.winCondition === 'Other' && g.winOther ? g.winOther : g.winCondition);
  if (bits.length) t += ' (' + bits.join(', ') + ')';
  t += '.';
  if (!other) {
    const rest = opps.filter(o => o.player).sort((a, b) => (+a.place || 9) - (+b.place || 9)).map(o => o.player + (o.c1 ? ' (' + shortCmd(o.c1) + ')' : '') + (o.place ? ' ' + ordinal(+o.place) : ''));
    if (rest.length) t += ' ' + rest.join(', ') + '.';
  }
  return t;
}

/* ---------- rematch ---------- */
/** A fresh game with the same format, deck, seats, players and commanders. Commanders can be changed before starting. */
export function rematchFrom(g) {
  const d = newDraft();
  ['format', 'set', 'startLife', 'bo3', 'myColors', 'deckId', 'deckName', 'podSize'].forEach(f => { if (g[f] != null && g[f] !== '') d[f] = g[f]; });
  if (d.format === 'Commander') d.format = '';
  d.podSize = +g.podSize || d.podSize;
  d.opponents = (g.opponents || []).map(o => Object.assign(blankOpp(), { player: o.player || '', c1: o.c1 || '', c2: o.c2 || '', showC2: !!o.c2, deck: o.deck || '', colors: o.colors || '', team: o.team || '' }));
  while (d.opponents.length < d.podSize - 1) d.opponents.push(blankOpp());
  if (g.eventId || (g.event && g.event.id)) {
    const id = g.eventId || g.event.id, e = S.events.find(x => x.id === id && x.status === 'Active');
    if (e) d.event = { id: e.id, set: e.set, store: e.store, date: e.date, existing: true };
  }
  if (!isCmd(d)) d.deckName = g.set || (g.event && g.event.set) ? '' : (g.deckName || '');
  if (isCmd(d) && d.deckId && !deckById(d.deckId)) { d.deckId = ''; d.deckName = ''; } // that deck has left your picker
  return d;
}

/** A saved game back into the editor. */
export function gameToDraft(g) {
  // games imported from classic's old spreadsheet may not say how many played: guess enough seats for your finish,
  // and save it as still unknown unless you change it
  const cmdGame = !g.format || g.format === 'Commander';
  const pod = +g.podSize || Math.max(cmdGame ? 4 : 2, g.opponents.length + 1, +g.myPlace || 0, +g.mySeat || 0);
  const d = Object.assign(newDraft(), {
    stage: 'ending', gameId: g.gameId, date: g.date, deckId: g.deckId, deckName: g.deckName, podGuess: +g.podSize ? null : pod,
    podSize: pod, mySeat: g.mySeat || null, myPlace: g.myPlace || null,
    turns: g.turns || '', notes: g.notes || '', winCondition: g.winCondition || '', winOther: g.winOther || '',
    elimBy: g.elimBy || '', elimHow: g.elimHow || '', draw: g.resultType === DRAW_RESULT,
    // turn times from the life counter are kept when a game is edited
    myTurnTime: g.myTurnTime || null, myTurnsTaken: g.myTurnsTaken || null,
    opponents: g.opponents.map(o => ({ player: o.player, c1: o.c1, c2: o.c2, seat: o.seat || null, place: o.place || null, showC2: !!o.c2, deck: o.deck || '', colors: o.colors || '', team: o.team || '',
      turnTime: o.turnTime || null, turnsTaken: o.turnsTaken || null }))
  });
  if (g.format && g.format !== 'Commander') {
    const m = String(g.matchScore || '').match(/^(\d+)-(\d+)$/), ev = S.events.find(x => x.id === g.eventId);
    Object.assign(d, { format: g.format, set: g.set, startLife: g.startLife || 20, myColors: g.myColors, bo3: !!m,
      matchW: m ? +m[1] : null, matchL: m ? +m[2] : null,
      event: g.eventId ? { id: g.eventId, set: ev ? ev.set : g.set, store: ev ? ev.store : '', date: ev ? ev.date : g.date, existing: true } : null });
    const ts = teamSize(d);
    d.firstKey = g.playDraw === 'Play' ? 'me' : g.playDraw === 'Draw' ? (ts ? 'g1' : 'o0') : null;
    if (ts) { d.podSize = ts * 2; d.opponents.forEach((o, i) => { if (!o.team) o.team = i < ts - 1 ? 'A' : 'B'; }); }
  }
  resizePod(d.podSize, d);
  return d;
}

/* ---------- saved games ---------- */
const nul = v => (v === undefined || v === '' ? null : v);
const num = v => (v === '' || v == null || isNaN(+v) ? null : +v);
const str = v => (v == null ? '' : String(v).trim());

/**
 * The fields of a saved game, from a draft. Seat 0 is you; the rest are in table order, clockwise from you.
 * Each seat can later be linked to a player's account (Phase 5); for now everyone else is a typed-in name.
 */
export function toRecord(d, prev) {
  const cmd = isCmd(d), two = sides(d) === 2, ts = teamSize(d), myPlace = +d.myPlace;
  const deck = cmd ? deckById(d.deckId) : null;
  const prevMe = prev && prev.raw && (prev.raw.seats || []).find(s => s.uid === uid());
  const podUnknown = !!d.podGuess && +d.podSize === +d.podGuess;
  // with the pod size still unknown, the empty seats added for editing aren't saved
  const keepMe = !!(prevMe && prev.deckId === d.deckId);
  const opps = d.opponents.filter(o => !podUnknown || String(o.player || '').trim() || String(o.c1 || '').trim() || String(o.deck || '').trim() || o.place)
    .map(o => Object.assign({}, o));
  let matchScore = '', playDraw = '';
  if (!cmd) {
    matchScore = d.bo3 && two && d.matchW != null && d.matchL != null ? d.matchW + '-' + d.matchL : '';
    playDraw = two && d.firstKey ? (d.firstKey === 'me' ? 'Play' : 'Draw') : '';
    if (two && !d.bo3) {
      const theirs = d.draw ? 1 : (myPlace === 1 ? 2 : 1);
      opps.forEach(o => { o.place = ts && o.team === 'A' ? myPlace : theirs; });
    }
  }
  const me = {
    uid: uid(), name: myName() || 'You',
    deckId: cmd ? str(d.deckId) : '', deckName: cmd ? str(deck ? deck.name : d.deckName) : str(deckLabel(d)),
    // a deck that isn't in your decks (yet) keeps the commanders and colors the game already had
    c1: cmd ? str(deck ? deck.c1 : keepMe ? prevMe.c1 : '') : '', c2: cmd ? str(deck ? deck.c2 : keepMe ? prevMe.c2 : '') : '',
    colors: cmd ? (deck ? deck.colors || 'C' : keepMe ? str(prevMe.colors) : '') : str(d.myColors),
    // the bracket the deck had when the game was played: kept as it was when you edit the game later
    bracket: prevMe && prev.deckId === d.deckId ? nul(prevMe.bracket) : (cmd && deck && deck.bracket !== '' && deck.bracket != null ? deck.bracket : null),
    deck: '', seat: num(d.mySeat), place: myPlace || null, team: ts ? 'A' : '',
    elimBy: myPlace > 1 ? str(d.elimBy) : '', elimHow: myPlace > 1 ? str(d.elimHow) : '',
    turnTime: num(d.myTurnTime), turnsTaken: num(d.myTurnsTaken)
  };
  const seats = [me].concat(opps.map(o => ({
    uid: null, name: str(o.player),
    deckId: '', deckName: '', c1: cmd ? str(o.c1) : '', c2: cmd ? str(o.c2) : '',
    colors: cmd ? cmdColors(o.c1, o.c2) : str(o.colors), bracket: null,
    deck: cmd ? '' : str(o.deck), seat: num(o.seat), place: num(o.place), team: str(o.team),
    elimBy: '', elimHow: '', turnTime: num(o.turnTime), turnsTaken: num(o.turnsTaken)
  })));
  return {
    schema: 1, date: d.date || today(), format: cmd ? 'Commander' : String(d.format),
    set: cmd ? '' : str(d.event ? d.event.set : d.set), startLife: startLife(d), bo3: !cmd && !!d.bo3 && two,
    matchScore: matchScore, playDraw: playDraw, eventId: !cmd && d.event && d.event.id ? String(d.event.id) : '',
    podSize: podUnknown ? null : (+d.podSize || seats.length), turns: num(d.turns), winCondition: str(d.winCondition),
    winOther: d.winCondition === 'Other' ? str(d.winOther) : '', draw: !!d.draw, notes: str(d.notes), seats: seats
  };
}

/** A saved game as the screens use it (the same shape classic 1.13's Recent games used), from your seat's point of view. */
export function fromRecord(id, rec, pending) {
  const seats = rec.seats || [];
  let mi = seats.findIndex(s => s.uid && s.uid === uid());
  if (mi < 0) mi = 0;
  const me = seats[mi] || {}, others = seats.slice(mi + 1).concat(seats.slice(0, mi));
  const rel = t => (!t ? '' : t === me.team ? 'A' : 'B');
  const ts = x => (x && typeof x.toMillis === 'function' ? x.toMillis() : 0);
  return {
    gameId: id, date: rec.date || '', deckId: me.deckId || '', deckName: me.deckName || '', bracket: me.bracket == null ? '' : me.bracket,
    c1: me.c1 || '', c2: me.c2 || '', colors: me.colors || '',
    // games imported from classic's old spreadsheet may not say how many played
    podSize: rec.podSize || (seats.length > 1 ? seats.length : ''), mySeat: me.seat || null, myPlace: me.place || null, turns: rec.turns || '',
    winCondition: rec.winCondition || '', winOther: rec.winOther || '', elimBy: me.elimBy || '', elimHow: me.elimHow || '',
    resultType: rec.draw ? DRAW_RESULT : (+me.place === 1 ? 'Win' : 'Loss'), draw: !!rec.draw, notes: rec.notes || '',
    opponents: others.map(s => ({ player: s.name || '', c1: s.c1 || '', c2: s.c2 || '', seat: s.seat || null, place: s.place || null,
      deck: s.deck || '', colors: s.colors || '', team: rel(s.team), uid: s.uid || null, turnTime: s.turnTime || null, turnsTaken: s.turnsTaken || null })),
    format: rec.format || 'Commander', set: rec.set || '', startLife: rec.startLife || '', matchScore: rec.matchScore || '',
    bo3: !!rec.bo3, eventId: rec.eventId || '', myColors: rec.format && rec.format !== 'Commander' ? me.colors || '' : '', playDraw: rec.playDraw || '',
    myTurnTime: me.turnTime || null, myTurnsTaken: me.turnsTaken || null,
    // a game someone else logged only counts for you once you accept it (Phase 5)
    accepted: !rec.createdBy || rec.createdBy === uid() || !!(rec.accepted && rec.accepted[uid()]),
    deleted: !!rec.deleted, locked: !!rec.locked, pending: !!pending,
    created: ts(rec.createdAt), updated: ts(rec.updatedAt), raw: rec
  };
}
export function sortGames(list) {
  return list.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.created - a.created);
}

/* ---------- what your past games remember ---------- */
// These look through every game, and the setup screen asks for them on each redraw, so each answer is kept
// until the games (or remembered names) change. Deleted games don't count.
const memo = {};
function remember(name, extra, fn) {
  const m = memo[name];
  if (m && m.games === S.games && m.extra === extra) return m.val;
  const val = fn();
  memo[name] = { games: S.games, extra: extra, val: val };
  return val;
}
const counted = () => S.games.filter(g => !g.deleted);
/** Players you've played with, most often first, with the commanders each has played. */
export function knownPlayers() { return remember('players', (S.settings.players || []).join('\n'), knownPlayersNow); }
function knownPlayersNow() {
  const players = {};
  counted().forEach(g => {
    const t = Date.parse(g.date) || 0;
    g.opponents.forEach(o => {
      const name = String(o.player || '').trim();
      if (!name) return;
      const p = players[name.toLowerCase()] || (players[name.toLowerCase()] = { name: name, count: 0, last: 0, cmdrs: {} });
      p.count++;
      if (t >= p.last) { p.last = t; p.name = name; }
      const c1 = String(o.c1 || '').trim(), c2 = String(o.c2 || '').trim();
      if (c1) {
        const k = (c1 + '|' + c2).toLowerCase(), c = p.cmdrs[k] || (p.cmdrs[k] = { c1: c1, c2: c2, count: 0, last: 0 });
        c.count++; c.last = Math.max(c.last, t);
      }
    });
  });
  const out = Object.keys(players).map(k => {
    const p = players[k];
    return { name: p.name, count: p.count, last: p.last, commanders: Object.keys(p.cmdrs).map(x => p.cmdrs[x]).sort((a, b) => b.count - a.count || b.last - a.last) };
  });
  (S.settings.players || []).forEach(n => { if (n && !out.some(p => p.name.toLowerCase() === String(n).toLowerCase())) out.push({ name: n, count: 0, last: 0, commanders: [] }); });
  return out.sort((a, b) => b.count - a.count || b.last - a.last);
}
/** Non-Commander decks you've typed before, for each format's deck box. */
export function otherDecks() { return remember('otherDecks', '', otherDecksNow); }
function otherDecksNow() {
  const out = {};
  counted().forEach(g => {
    if (!g.format || g.format === 'Commander' || g.set) return;
    const name = String(g.deckName || '').trim(); if (!name) return;
    const k = (g.format + '|' + name).toLowerCase(), t = Date.parse(g.date) || 0;
    if (!out[k] || t >= out[k].last) out[k] = { format: g.format, name: name, colors: g.myColors, last: t, count: (out[k] ? out[k].count : 0) + 1 };
    else out[k].count++;
  });
  return Object.keys(out).map(k => out[k]).sort((a, b) => b.last - a.last);
}
/** How often and how recently each deck was played (for "Played recently" in the deck picker). */
export function deckPlays() { return remember('deckPlays', '', deckPlaysNow); }
function deckPlaysNow() {
  const out = {};
  counted().forEach(g => {
    if (!g.deckId) return;
    const s = out[g.deckId] || (out[g.deckId] = { plays: 0, last: 0 });
    s.plays++; s.last = Math.max(s.last, (Date.parse(g.date) || 0) + g.created / 1e13);
  });
  return out;
}
/** Events (prereleases) with their records, newest first. */
export function withRecords(events) {
  const rec = {};
  S.games.forEach(g => {
    if (!g.eventId || g.deleted) return;
    const r = rec[g.eventId] || (rec[g.eventId] = { wins: 0, losses: 0, draws: 0 });
    if (g.resultType === 'Win') r.wins++; else if (g.resultType === 'Loss') r.losses++; else r.draws++;
  });
  return (events || []).map(e => Object.assign({}, e, rec[e.id] || { wins: 0, losses: 0, draws: 0 }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
