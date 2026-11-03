// Import from classic: reads a downloaded .xlsx of a classic Salt Mine Sheet, shows what would change, then saves it.
// - Each classic game is keyed by its classic Game ID, so importing the same file again adds nothing twice.
// - A game fixed in classic since the last import is updated here, unless it was edited or deleted here since.
// - Nothing is ever deleted: games missing from the file stay as they are.
// - Classic games that look like ones already logged here (same day, deck and finish) are flagged and skipped
//   unless you tick them.
import { S, uid, H } from './state.js';
import { esc, toast } from './util.js';
import * as D from './data.js';
import { readXlsx, serialToParts } from './xlsx.js';
import { cmdColors } from './commanders.js';
import { DRAW_RESULT, deckById, myName, niceDate, ordinal, shortCmd } from './game.js';

export const IMP = { busy: '', error: '', plan: null, done: null, file: '', include: {}, folders: true };

/* ---------- reading the Sheet ---------- */
const str = v => (v == null ? '' : String(v).trim());
const num = v => (v == null || v === '' || isNaN(+v) ? null : +v);
const idStr = v => (typeof v === 'number' ? String(Math.round(v) === v ? v : v) : str(v));
const pad = n => String(n).padStart(2, '0');
/** A Sheet date as YYYY-MM-DD, or '' when it isn't one. */
function ymd(v) {
  if (typeof v === 'number' && v > 0) { const p = serialToParts(v); return p.y + '-' + pad(p.m) + '-' + pad(p.d); }
  const s = str(v); let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + pad(m[1]) + '-' + pad(m[2]);
  const t = Date.parse(s); if (!s || isNaN(t)) return '';
  const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
/** A Sheet date and time as milliseconds on this device's clock, or 0. */
function when(v) {
  if (typeof v === 'number' && v > 0) { const p = serialToParts(v); return new Date(p.y, p.m - 1, p.d, p.h, p.mi, p.s, p.ms).getTime(); }
  const t = Date.parse(str(v)); return isNaN(t) ? 0 : t;
}
/** A tab as a list of { header: value } rows (rowNum is the Sheet's row number). */
function table(book, name) {
  const key = Object.keys(book).find(k => k.trim().toLowerCase() === name.toLowerCase());
  const rows = key ? book[key] : null;
  if (!rows || !rows.length) return null;
  const hdr = (rows[0] || []).map(str);
  return rows.slice(1).map((r, i) => {
    const o = { rowNum: i + 2 };
    hdr.forEach((h, j) => { if (h) o[h] = r[j] == null ? null : r[j]; });
    return o;
  }).filter(o => Object.keys(o).some(k => k !== 'rowNum' && o[k] !== null && o[k] !== ''));
}
/** A short fingerprint of some text (cyrb53). */
function hash(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const GAME_FIELDS = ['date', 'format', 'set', 'startLife', 'bo3', 'matchScore', 'playDraw', 'eventId', 'podSize', 'turns', 'winCondition', 'winOther', 'draw', 'notes'];
const SEAT_FIELDS = ['name', 'deckId', 'deckName', 'c1', 'c2', 'colors', 'bracket', 'deck', 'seat', 'place', 'team', 'elimBy', 'elimHow', 'turnTime', 'turnsTaken'];
const norm = v => (v == null ? '' : String(v));
/** What a saved game says (not who saved it or when), so an edit made here can be told apart from the imported copy. */
export function fingerprint(rec) {
  if (!rec) return '';
  return hash(GAME_FIELDS.map(f => norm(rec[f])).join('\u0001') + '\u0002' +
    (rec.seats || []).map(s => SEAT_FIELDS.map(f => norm(s[f])).join('\u0001')).join('\u0002'));
}
const GAME_SKIP = { Status: 1, Created: 1, Updated: 1 };
const rowText = r => Object.keys(r).filter(k => k !== 'rowNum' && !GAME_SKIP[k]).sort().map(k => k + '=' + norm(r[k])).join('\u0001');

/** Turns a downloaded classic Sheet into games, events and typed-in decks in Salt Mine Beta's shape. */
export function parseClassic(book) {
  const gkey = Object.keys(book).find(k => k.trim().toLowerCase() === 'games');
  if (!gkey || !(book[gkey][0] || []).map(str).includes('Game ID')) throw new Error('not-salt-mine');
  const games = table(book, 'Games') || [];
  const opps = table(book, 'Opponents') || [], deckRows = table(book, 'Decks') || [], evRows = table(book, 'Events') || [], cmdRows = table(book, 'Commanders') || [];
  const oppsBy = {};
  opps.forEach(o => { const id = str(o['Game ID']); if (id) (oppsBy[id] = oppsBy[id] || []).push(o); });
  const decks = {};
  deckRows.forEach(d => { const id = idStr(d['Deck ID']); if (id) decks[id] = d; });
  const sheetCmd = {};
  cmdRows.forEach(c => { const n = str(c['Name']).toLowerCase(); if (n) sheetCmd[n] = str(c['Color Identity']); });
  const colorsOf = (c1, c2) => {
    const known = cmdColors(c1, c2); if (known) return known;
    const set = [c1, c2].map(c => sheetCmd[str(c).toLowerCase()] || sheetCmd[str(c).toLowerCase().split(' // ')[0]] || '').join('');
    return ['W', 'U', 'B', 'R', 'G'].filter(l => set.indexOf(l) !== -1).join('') || (set ? 'C' : '');
  };

  const me = myName() || 'You', out = [], skipped = [], seen = {};
  games.forEach((g, i) => {
    const id = str(g['Game ID']);
    if (!id) return skipped.push({ row: g.rowNum, why: 'no Game ID' });
    if (seen[id]) return skipped.push({ row: g.rowNum, why: 'Game ID ' + id + ' appears twice' });
    seen[id] = true;
    const date = ymd(g['Date']);
    if (!date) return skipped.push({ row: g.rowNum, why: 'no date' });
    const fmt = str(g['Format']), cmd = !fmt || fmt === 'Commander';
    const deckId = cmd ? idStr(g['Deck ID']) : '';
    const here = deckId ? deckById(deckId) : null, there = deckId ? decks[deckId] : null;
    const place = num(g['My Place']);
    const draw = str(g['Result Type']) === DRAW_RESULT;
    const theirs = (oppsBy[id] || []).map(o => {
      const c1 = cmd ? str(o['Commander 1']) : '', c2 = cmd ? str(o['Commander 2']) : '';
      return { uid: null, name: str(o['Player']), deckId: '', deckName: '', c1: c1, c2: c2,
        colors: cmd ? colorsOf(c1, c2) : str(o['Colors']), bracket: null, deck: cmd ? '' : str(o['Deck']),
        seat: num(o['Seat']), place: num(o['Place']), team: str(o['Team']), elimBy: '', elimHow: '',
        turnTime: num(o['Turn Time (sec)']), turnsTaken: num(o['Turns Taken']) };
    });
    const teams = theirs.some(o => o.team);
    const mine = {
      uid: uid(), name: me, deckId: deckId, deckName: str(g['Deck Name']) || (here ? here.name : ''),
      c1: cmd ? str(here ? here.c1 : there ? there['Commander 1'] : '') : '',
      c2: cmd ? str(here ? here.c2 : there ? there['Commander 2'] : '') : '',
      colors: cmd ? (here ? here.colors || 'C' : there ? str(there['Color Identity']) || 'C' : '') : str(g['My Colors']),
      bracket: cmd ? num(g['Bracket']) : null, deck: '', seat: num(g['My Seat']), place: place, team: teams ? 'A' : '',
      elimBy: place > 1 ? str(g['Eliminated By']) : '', elimHow: place > 1 ? str(g['Eliminated How']) : '',
      turnTime: num(g['My Turn Time (sec)']), turnsTaken: num(g['My Turns Taken'])
    };
    const seats = [mine].concat(theirs).slice(0, 8);
    const win = str(g['Win Condition']);
    const rec = {
      schema: 1, date: date, format: cmd ? 'Commander' : fmt, set: cmd ? '' : str(g['Set']),
      startLife: num(g['Starting Life']) || (cmd ? 40 : 20), bo3: !cmd && !!str(g['Match Score']),
      matchScore: cmd ? '' : str(g['Match Score']), playDraw: cmd ? '' : str(g['Play or Draw']), eventId: cmd ? '' : str(g['Event ID']),
      podSize: num(g['Pod Size']), turns: num(g['Turns']), winCondition: win, winOther: win === 'Other' ? str(g['Win Condition (Other)']) : '',
      draw: draw, notes: str(g['Notes']), seats: seats
    };
    const rowHash = hash(rowText(g) + '\u0003' + (oppsBy[id] || []).map(rowText).join('\u0002'));
    out.push({ id: id, rec: rec, hash: rowHash, created: (when(g['Created']) || new Date(date + 'T12:00:00').getTime()) + i, linked: !cmd || !deckId || !!here, cut: theirs.length > 7 });
  });

  const events = evRows.map(e => ({ id: str(e['Event ID']), date: ymd(e['Date']), format: str(e['Format']), set: str(e['Set']), store: str(e['Store']),
    colors: str(e['My Colors']), status: str(e['Status']) === 'Active' ? 'Active' : 'Complete', created: when(e['Created']) })).filter(e => e.id && e.date);

  const TYPES = { Scratch: 'Scratch', Upgraded: 'Upgraded', 'Pre-Con': 'Pre-Con' };
  const typed = Object.keys(decks).filter(id => /^m-/.test(id)).map(id => {
    const d = decks[id], b = num(d['Bracket']);
    return { id: id, source: 'typed', name: str(d['Deck Name']) || str(d['Commander 1']) || 'Deck', c1: str(d['Commander 1']), c2: str(d['Commander 2']),
      colors: str(d['Color Identity']) || 'C', type: TYPES[str(d['Deck Type'])] || 'Scratch', bracket: b == null ? '' : b,
      bracketSource: b == null ? '' : 'Set by you', retired: !(d['In Picker'] === true && str(d['Status']) === 'OK'), status: 'ok' };
  });
  // classic's Archidekt settings: username, home folder, and what each folder counts as
  const setKey = Object.keys(book).find(k => k.trim().toLowerCase() === 'settings');
  const setRows = setKey ? book[setKey] : [], arch = { username: '', rootId: '', folders: [] };
  let inFolders = false;
  setRows.forEach(r => {
    const a = str(r && r[0]), b = r && r[1];
    if (a === 'Folder Name') { inFolders = true; return; }
    if (inFolders) {
      const id = idStr(b);
      if (a && id) arch.folders.push({ id: id, name: a, type: str(r[2]) || 'Unsorted', show: r[3] === true || str(r[3]).toUpperCase() === 'TRUE' });
      else if (!a) inFolders = false;
      return;
    }
    if (a === 'Archidekt Username') arch.username = str(b);
    if (a === 'Archidekt Root Folder ID') arch.rootId = idStr(b);
  });
  return { arch: arch, games: out, events: events, typed: typed, skipped: skipped, deckNames: Object.keys(decks).reduce((m, id) => { m[id] = str(decks[id]['Deck Name']); return m; }, {}) };
}

/* ---------- what importing would do ---------- */
const deckKey = g => (g.format && g.format !== 'Commander' ? 'f:' + g.format.toLowerCase() + '|' + String(g.deckName || '').toLowerCase() : 'd:' + String(g.deckId || ''));
const oppNames = seats => seats.map(s => String(s.name || s.player || '').trim().toLowerCase()).filter(Boolean);
/** Compares the file with the games already here. */
export function makePlan(parsed) {
  const byClassic = {}, native = [];
  S.games.forEach(g => {
    const src = g.doc && g.doc.source;
    if (src && src.app === 'classic' && src.id) byClassic[src.id] = g;
    else if (!g.deleted) native.push(g);
  });
  const used = {}, plan = { add: [], update: [], same: [], keptEdited: [], keptDeleted: [], keptLocked: [], dupes: [], missing: 0, unlinked: {}, cut: 0 };
  parsed.games.forEach(c => {
    const have = byClassic[c.id];
    if (have) {
      delete byClassic[c.id];
      const src = have.doc.source;
      if (src.hash === c.hash) return plan.same.push(c);
      if (have.deleted) return plan.keptDeleted.push(Object.assign({ have: have }, c));
      if (have.locked && !D.isOwner(uid())) return plan.keptLocked.push(Object.assign({ have: have }, c));
      if (fingerprint(have.doc) !== src.fp) return plan.keptEdited.push(Object.assign({ have: have }, c));
      return plan.update.push(Object.assign({ have: have }, c));
    }
    // a game you also logged here? same day, format, deck and finish, and (when both list them) a player in common
    const myPlace = c.rec.seats[0].place, cOpps = oppNames(c.rec.seats.slice(1));
    const match = native.find(g => !used[g.gameId] && g.date === c.rec.date && (g.format || 'Commander') === c.rec.format &&
      deckKey(g) === deckKey({ format: c.rec.format, deckId: c.rec.seats[0].deckId, deckName: c.rec.seats[0].deckName }) &&
      (+g.myPlace || null) === (myPlace || null) &&
      (!cOpps.length || !g.opponents.length || oppNames(g.opponents.map(o => ({ name: o.player }))).some(n => cOpps.indexOf(n) !== -1)));
    if (match) { used[match.gameId] = true; plan.dupes.push(Object.assign({ match: match }, c)); }
    else plan.add.push(c);
    if (!c.linked) { const k = c.rec.seats[0].deckId; plan.unlinked[k] = plan.unlinked[k] || { name: c.rec.seats[0].deckName || parsed.deckNames[k] || 'Deck ' + k, n: 0 }; plan.unlinked[k].n++; }
    if (c.cut) plan.cut++;
  });
  plan.missing = Object.keys(byClassic).filter(k => !byClassic[k].deleted).length; // imported before, no longer in the file: left alone
  const haveEvents = {}; (S.eventsRaw || []).forEach(e => { haveEvents[e.id] = true; });
  plan.events = parsed.events.filter(e => !haveEvents[e.id]);
  plan.decks = parsed.typed.filter(d => !S.decks.some(x => x.id === d.id));
  // typed-in decks from classic come over too, so their games aren't left unlinked
  plan.decks.forEach(d => { delete plan.unlinked[d.id]; });
  // folder settings from classic that differ from the ones here
  const here = (S.settings.archidekt || {}).folders || {};
  plan.folders = (parsed.arch ? parsed.arch.folders : []).filter(f => { const h = here[f.id]; return !h || h.type !== f.type || !!h.show !== f.show; })
    .map(f => Object.assign({ was: here[f.id] || null }, f));
  plan.total = parsed.games.length; plan.skipped = parsed.skipped;
  const dates = parsed.games.map(g => g.rec.date).sort();
  plan.first = dates[0] || ''; plan.last = dates[dates.length - 1] || '';
  return plan;
}

/* ---------- choosing the file ---------- */
const allLoaded = () => S.gamesLoaded && !S.games.some(g => g.cached);
export async function onFile(file) {
  if (!file) return;
  IMP.error = ''; IMP.plan = null; IMP.done = null; IMP.include = {}; IMP.folders = true; IMP.file = file.name || 'your file';
  IMP.busy = 'Reading ' + IMP.file + '\u2026'; H.go('import');
  try {
    if (!/\.xlsx$/i.test(IMP.file)) throw new Error('not-xlsx');
    const book = await readXlsx(file);
    IMP.parsed = parseClassic(book);
    await waitForGames();
    IMP.plan = makePlan(IMP.parsed);
  } catch (err) {
    const m = String(err && err.message || err);
    IMP.error = m === 'not-xlsx' ? 'That isn\u2019t an .xlsx file. Download your classic Sheet as Microsoft Excel (.xlsx) and choose that file.'
      : m === 'old-browser' ? 'This browser is too old to open .xlsx files. Update it, or try on another device.'
      : m === 'not-salt-mine' ? 'That file doesn\u2019t look like a Salt Mine Sheet (it has no Games tab with a Game ID column). Download the Sheet the classic Salt Mine made for you.'
      : 'Couldn\u2019t read that file (' + m + '). Make sure it\u2019s the .xlsx download of your classic Sheet.';
  }
  IMP.busy = '';
  if (S.view === 'import') H.rerenderKeep();
}
/** The plan needs every game here (the device's quick copy isn't enough to spot what's already imported). */
function waitForGames() {
  if (allLoaded()) return Promise.resolve();
  IMP.busy = 'Loading your games\u2026'; if (S.view === 'import') H.rerenderKeep();
  return new Promise((res, rej) => {
    const start = Date.now(), t = setInterval(() => {
      if (allLoaded()) { clearInterval(t); res(); }
      else if (Date.now() - start > 30000) { clearInterval(t); rej(new Error('your games are still loading; check your connection')); }
    }, 200);
  });
}

/* ---------- saving ---------- */
async function runImport() {
  const p = IMP.plan;
  if (!p) return;
  if (!navigator.onLine) return toast('You\u2019re offline. Import once you\u2019re back online.', true);
  if (!allLoaded()) return toast('Still loading your games. Try again in a second.', true);
  // check again against the games as they are now, in case another device changed something
  const fresh = makePlan(IMP.parsed);
  const adds = fresh.add.concat(fresh.dupes.filter(c => IMP.include[c.id]));
  const ups = fresh.update;
  const useFolders = IMP.folders && fresh.folders.length;
  if (!adds.length && !ups.length && !fresh.events.length && !fresh.decks.length && !useFolders) { IMP.plan = fresh; H.rerenderKeep(); return toast('Nothing new to import.'); }
  const me = uid(), total = adds.length + ups.length;
  let done = 0;
  const say = () => { IMP.busy = 'Saving ' + done + ' of ' + total + (total === 1 ? ' game' : ' games') + '\u2026'; const el = document.querySelector('.impstatus'); if (el) el.textContent = IMP.busy; };
  say(); H.rerenderKeep();
  try {
    if (useFolders) applyClassicFolders(IMP.parsed.arch, fresh.folders);
    if (fresh.decks.length) await D.saveDecks(me, fresh.decks);
    if (fresh.events.length) await D.importEvents(me, fresh.events);
    const meta = c => ({ app: 'classic', id: c.id, hash: c.hash, fp: fingerprint(c.rec) });
    const items = adds.map(c => ({ id: classicDocId(me, c.id), rec: c.rec, source: meta(c), created: c.created }))
      .concat(ups.map(c => ({ id: c.have.gameId, rec: c.rec, source: meta(c), prev: c.have.doc })));
    await D.importGames(me, items, n => { done = n; say(); });
    IMP.done = { added: adds.length, updated: ups.length, events: fresh.events.length, decks: fresh.decks.length, folders: useFolders ? fresh.folders.length : 0 };
    H.setSettings({ lastImport: { at: Date.now(), file: IMP.file, added: adds.length, updated: ups.length } });
    IMP.plan = null; IMP.busy = '';
  } catch (err) {
    IMP.busy = '';
    IMP.error = 'Stopped after ' + done + ' of ' + total + ' games: ' + ((err && (err.message || err.code)) || err) + '. Nothing was lost. Choose the file again to pick up where it stopped.';
    IMP.plan = null;
  }
  if (S.view === 'import') H.rerenderKeep();
}
/** Copies classic's folder kinds (and its Archidekt username and home folder, if none is set here) into Settings > Archidekt. */
function applyClassicFolders(arch, changed) {
  const a = Object.assign({}, S.settings.archidekt || {}), fl = Object.assign({}, a.folders || {});
  changed.forEach(f => { fl[f.id] = Object.assign({}, fl[f.id] || {}, { name: (fl[f.id] && fl[f.id].name) || f.name, type: f.type, show: f.show }); });
  a.folders = fl;
  if (!a.username && arch.username) a.username = arch.username;
  if (!a.rootId && arch.rootId) a.rootId = arch.rootId;
  H.setSettings({ archidekt: a });
}
/** The database ID for a classic game: tied to you, so two people's classic IDs never collide. */
export const classicDocId = (u, id) => 'classic-' + u + '-' + String(id).replace(/[^A-Za-z0-9_-]/g, '_');

/* ---------- the screen ---------- */
const gamesWord = n => n + (n === 1 ? ' game' : ' games');
function line(c) {
  const r = c.rec, me = r.seats[0], other = r.format !== 'Commander';
  const place = r.draw ? 'Draw' : me.place ? ordinal(me.place) : '?';
  const opps = r.seats.slice(1).filter(s => s.team !== 'A').map(s => (other ? s.name || s.deck : s.c1 ? shortCmd(s.c1) : s.name)).filter(Boolean).join(', ');
  return '<li><b>' + esc(niceDate(r.date)) + '</b> ' + esc(me.deckName || r.format) + ', ' + esc(place) +
    (other ? ' <span class="muted">(' + esc(r.format) + (r.matchScore ? ' ' + esc(r.matchScore) : '') + ')</span>' : '') +
    (opps ? '<br><small class="muted">vs ' + esc(opps) + '</small>' : '') + '</li>';
}
/** "Marcus (Mikaeus), Vic (Ashling)": players first, so the file and a game here can be compared. */
const people = list => list.filter(o => o.team !== 'A').map(o => (o.name || '') + (o.c1 ? (o.name ? ' (' + shortCmd(o.c1) + ')' : shortCmd(o.c1)) : o.deck ? (o.name ? ' (' + o.deck + ')' : o.deck) : '')).filter(Boolean).join(', ');
function compareLine(date, deckName, place, draw, opps) {
  return esc(niceDate(date)) + ', ' + esc(deckName) + ', ' + esc(draw ? 'draw' : place ? ordinal(+place) : '?') + (opps ? ' vs ' + esc(opps) : '');
}
function listBlock(id, title, items, render) {
  if (!items.length) return '';
  return '<details class="collapse implist" id="' + id + '"' + (S.open[id] ? ' open' : '') + '><summary>' + title + '</summary><ul>' + items.map(render).join('') + '</ul></details>';
}
export function viewImport() {
  let h = '<header class="top"><button class="link back" data-act="impback">\u2039 Data</button><h3>Import from classic</h3><span style="width:60px"></span></header>';
  if (IMP.busy) return h + '<div class="panel"><p class="status impstatus" style="margin:0">' + esc(IMP.busy) + '</p><p class="muted" style="margin:8px 0 0"><small>Keep the app open until this finishes.</small></p></div>';
  if (IMP.error) return h + '<div class="panel"><p style="margin:0">' + esc(IMP.error) + '</p></div>' + fileButton('Choose a file');
  if (IMP.done) {
    const d = IMP.done, added = [], bits = [];
    if (d.added) added.push(gamesWord(d.added));
    if (d.events) added.push(d.events + (d.events === 1 ? ' event' : ' events'));
    if (d.decks) added.push(d.decks + (d.decks === 1 ? ' typed-in deck' : ' typed-in decks'));
    if (added.length) bits.push('added ' + (added.length > 1 ? added.slice(0, -1).join(', ') + ' and ' + added[added.length - 1] : added[0]));
    if (d.updated) bits.push('updated ' + gamesWord(d.updated));
    if (d.folders) bits.push('copied ' + d.folders + (d.folders === 1 ? ' folder setting' : ' folder settings') + ' from classic');
    return h + '<div class="panel"><p style="margin:0"><b>Done.</b> ' + esc(cap(bits.join(', and ') || 'nothing changed')) + '.</p>' +
      '<p class="muted" style="margin:8px 0 0"><small>They\u2019re in Recent games and Stats now. Import again any time: only new games and fixes from classic come over.</small></p></div>' +
      '<button class="btn primary" data-act="recent">See Recent games</button><button class="btn" style="margin-top:8px" data-act="home">Done</button>';
  }
  const p = IMP.plan;
  if (!p) return h + introHtml() + fileButton('Choose the .xlsx file');
  const picked = p.dupes.filter(c => IMP.include[c.id]).length, adding = p.add.length + picked;
  const other = p.add.filter(c => c.rec.format !== 'Commander').length;
  h += '<div class="panel"><p style="margin:0"><b>' + esc(IMP.file) + '</b></p><p class="muted" style="margin:4px 0 0">' + gamesWord(p.total) +
    (p.first ? ', ' + esc(niceDate(p.first)) + (p.last !== p.first ? ' to ' + esc(niceDate(p.last)) : '') : '') + '.</p></div>';
  h += '<div class="impsum">' +
    tile(adding, 'new ' + (adding === 1 ? 'game' : 'games') + ' to add', other ? (p.add.length - other) + ' Commander, ' + other + ' other ' + (other === 1 ? 'format' : 'formats') : '') +
    tile(p.update.length, 'fixed in classic, will update', '') +
    tile(p.same.length, 'already here', '') + '</div>';
  h += listBlock('impadd', 'See the new games', p.add, line);
  h += listBlock('impupd', 'See the games that will update', p.update, line);
  if (p.dupes.length) {
    h += '<h2>Maybe already here</h2><p class="muted" style="margin-top:0"><small>These look like games you also logged in Salt Mine Beta: same day, deck and finish. They\u2019re skipped unless you tick them.</small></p>';
    p.dupes.forEach(c => {
      const r = c.rec, me = r.seats[0], g = c.match;
      h += '<label class="panel dupe"><input type="checkbox" data-impdup="' + esc(c.id) + '"' + (IMP.include[c.id] ? ' checked' : '') + '>' +
        '<span><b>Import this one too</b><br><small>From classic: ' + compareLine(r.date, me.deckName || r.format, me.place, r.draw, people(r.seats.slice(1))) + '</small><br>' +
        '<small class="muted">Here: ' + compareLine(g.date, g.deckName || g.format, g.myPlace, g.draw, people(g.opponents.map(o => ({ name: o.player, c1: o.c1, deck: o.deck, team: o.team })))) + '</small></span></label>';
    });
  }
  const kept = p.keptEdited.concat(p.keptDeleted, p.keptLocked);
  if (kept.length) h += listBlock('impkept', gamesWord(kept.length) + ' changed in classic, left alone (edited or deleted here)', kept,
    c => line(c).replace('</li>', '<br><small class="muted">' + (c.have.deleted ? 'Deleted here' : c.have.locked ? 'Locked here' : 'Edited here') + '</small></li>'));
  if (p.folders.length) {
    const kind = f => (f.type === 'Scratch' ? 'From scratch' : f.type === 'Pre-Con' ? 'Pre-cons' : f.type) + (f.show ? ', in the picker' : ', not in the picker');
    h += '<h2>Folder settings</h2><label class="panel dupe"><input type="checkbox" data-impfolders="1"' + (IMP.folders ? ' checked' : '') + '>' +
      '<span><b>Use classic\u2019s folder settings</b><br><small class="muted">What each Archidekt folder counts as, and whether it\u2019s in the deck picker. Refresh your decks afterward.</small>' +
      '<ul class="bare">' + p.folders.map(f => '<li><small><b>' + esc(f.name) + ':</b> ' + esc(kind(f)) + (f.was ? ' <span class="muted">(here: ' + esc(kind(f.was)) + ')</span>' : ' <span class="muted">(new here)</span>') + '</small></li>').join('') + '</ul></span></label>';
  }
  const notes = [];
  if (p.events.length) notes.push('Adds ' + p.events.length + (p.events.length === 1 ? ' event' : ' events') + ' (prereleases and the like).');
  if (p.decks.length) notes.push('Adds ' + p.decks.length + ' typed-in ' + (p.decks.length === 1 ? 'deck' : 'decks') + ' from classic: ' + p.decks.map(d => d.name).join(', ') + '.');
  const ul = Object.keys(p.unlinked).map(k => p.unlinked[k]);
  if (ul.length) notes.push(gamesWord(ul.reduce((a, b) => a + b.n, 0)) + ' use ' + (ul.length === 1 ? 'a deck that isn\u2019t' : ul.length + ' decks that aren\u2019t') + ' in your decks here yet (' +
    ul.map(x => x.name).join(', ') + '). They link up on their own once those decks are here: check Settings > Archidekt and refresh.');
  if (p.missing) notes.push(gamesWord(p.missing) + ' imported before ' + (p.missing === 1 ? 'isn\u2019t' : 'aren\u2019t') + ' in this file. ' + (p.missing === 1 ? 'It stays' : 'They stay') + ' here.');
  if (p.cut) notes.push(gamesWord(p.cut) + ' had more than 8 players; only the first 8 come over.');
  if (p.skipped.length) notes.push(p.skipped.length + (p.skipped.length === 1 ? ' row was' : ' rows were') + ' skipped: ' + p.skipped.slice(0, 5).map(s => 'row ' + s.row + ' (' + s.why + ')').join(', ') + (p.skipped.length > 5 ? ', and more' : '') + '.');
  if (notes.length) h += '<div class="panel impnotes">' + notes.map(n => '<p>' + esc(n) + '</p>').join('') + '</div>';
  const extras = p.events.length + p.decks.length + (IMP.folders ? p.folders.length : 0);
  const label = adding && p.update.length ? 'Import ' + gamesWord(adding) + ' and update ' + p.update.length
    : adding ? 'Import ' + gamesWord(adding) : p.update.length ? 'Update ' + gamesWord(p.update.length) : extras ? 'Import' : 'Nothing new to import';
  h += '<button class="btn primary" data-act="impgo"' + (adding || p.update.length || extras ? '' : ' disabled') + '>' + esc(label) + '</button>' +
    '<button class="btn" style="margin-top:8px" data-act="impback">Cancel</button>' +
    '<p class="muted" style="margin-top:10px"><small>Nothing is deleted, and your classic Salt Mine isn\u2019t changed.</small></p>';
  return h;
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
function tile(n, label, sub) { return '<div class="tile"><b>' + n + '</b><span>' + esc(label) + '</span>' + (sub ? '<small class="muted">' + esc(sub) + '</small>' : '') + '</div>'; }
function introHtml() {
  return '<div class="panel"><p style="margin:0">Bring your games over from the classic Salt Mine.</p><ol class="steps">' +
    '<li>In classic, open Settings > Data > <b>Open my Sheet</b>.</li>' +
    '<li>In the Sheet, choose <b>File > Download > Microsoft Excel (.xlsx)</b>. (In the Google Sheets app, it\u2019s under the menu\u2019s Share & export.)</li>' +
    '<li>Choose that file here. You\u2019ll see what changes before anything is saved.</li></ol>' +
    '<p class="muted" style="margin:0"><small>Do this again whenever you like: games already here aren\u2019t added twice, and games fixed in classic are updated unless you changed them here.</small></p></div>';
}
function fileButton(label) {
  return '<label class="btn primary filebtn">' + esc(label) + '<input type="file" id="impfile" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>';
}

/** The import panel in Settings > Data. */
export function settingsImportHtml() {
  const n = S.games.filter(g => g.doc && g.doc.source && g.doc.source.app === 'classic' && !g.deleted).length, last = S.settings.lastImport;
  return '<div class="panel"><p style="margin:0"><b>Import from classic</b></p><p style="margin:4px 0 0">Bring your games over from the classic Salt Mine with a download of its Sheet. You\u2019ll see a preview first, and importing again only adds what\u2019s new.</p>' +
    (n || last ? '<p class="muted" style="margin:6px 0 0"><small>' + (n ? gamesWord(n) + ' here came from classic.' : '') + (last && last.at ? ' Last import ' + esc(new Date(last.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) + '.' : '') + '</small></p>' : '') +
    '<button class="btn" style="margin-top:10px" data-act="impopen">Import from classic</button></div>';
}

/* ---------- taps ---------- */
export function onImportAct(act) {
  switch (act) {
    case 'impopen': if (!IMP.busy) { IMP.plan = null; IMP.done = null; IMP.error = ''; } H.go('import'); return true;
    case 'impback': if (IMP.busy) return true; IMP.plan = null; IMP.done = null; IMP.error = ''; S.setSec = 'data'; H.back(); return true;
    case 'impgo': runImport(); return true;
  }
  return false;
}
export function onImportChange(t) {
  if (t.id === 'impfile') { const f = t.files && t.files[0]; t.value = ''; onFile(f); return true; }
  if (t.dataset && t.dataset.impfolders) { IMP.folders = t.checked; H.rerenderKeep(); return true; }
  if (t.dataset && t.dataset.impdup) { if (t.checked) IMP.include[t.dataset.impdup] = true; else delete IMP.include[t.dataset.impdup]; H.rerenderKeep(); return true; }
  return false;
}
