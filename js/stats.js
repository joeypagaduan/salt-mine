// Stats, ported from classic 1.13: the in-app Stats screen (Commander and other formats), the home screen card,
// and the two stats engines, copied from classic Stats.gs (computeStats and computeOtherStats) with one change:
// an opponent's commander colors come from the colors saved with the game.
// The classic Sheet Dashboard has no equivalent here: this screen replaces it.
import { S, H } from './state.js';
import { esc, seg, manaGradient } from './util.js';
import { CMD, cmdEntry } from './commanders.js';
import { ordinal, niceDate, eventLabel, recordText } from './game.js';

/* ---------- small helpers (as in classic) ---------- */
const pct = x => Math.round((x || 0) * 100) + '%';
const one = x => (x === null || x === undefined) ? 'n/a' : (+x).toFixed(1);
const mmss = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const gamesWord = n => n + (n === 1 ? ' game' : ' games');
const TYPE_LABEL = { Scratch: 'From scratch', 'Pre-Con': 'Pre-con' };
const typeLabel = t => TYPE_LABEL[t] || t;
const RANGES = [{ val: 'all', label: 'All time' }, { val: 'year', label: 'This year' }, { val: '90', label: '90 days' }, { val: '30', label: '30 days' }];

/* ---------- the numbers behind the stats ---------- */
// Your games in the shape classic's stats engines expect (classic getStatsData_), worked out once per change
// to your games, decks, events or folders. Deleted games never count, nor do shared games you haven't accepted.
// A deck's type follows the folder it's in now, including for past games.
const dayT = ymd => { const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : 0; };
let memo = null;
export function statsData() {
  const key = [S.games, S.decks, S.eventsRaw, (S.settings || {}).archidekt, CMD.at];
  if (memo && memo.key.every((k, i) => k === key[i])) return memo.val;
  const decks = {};
  (S.decks || []).forEach(d => {
    decks[String(d.id)] = { name: String(d.name || ''), colors: String(d.colors || 'C'), type: String((H.deckType && H.deckType(d)) || 'Unknown'), c1: d.c1 || '', c2: d.c2 || '' };
  });
  const cmdColors = {};
  const list = S.games.filter(g => !g.deleted && g.accepted !== false)
    .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.created || 0) - (b.created || 0));
  const all = list.map(g => {
    const opps = (g.opponents || []).map(o => {
      [o.c1, o.c2].forEach(c => { const k = String(c || '').trim().toLowerCase(); if (k && !(k in cmdColors)) { const e = cmdEntry(k); cmdColors[k] = e ? (e.ci || 'C') : ''; } });
      return { p: String(o.player || '').trim(), c1: String(o.c1 || '').trim(), c2: String(o.c2 || '').trim(), seat: o.seat || '', place: o.place || '',
        deck: String(o.deck || '').trim(), colors: String(o.colors || ''), team: String(o.team || ''), time: +o.turnTime || 0, turns: +o.turnsTaken || 0 };
    });
    return {
      id: g.gameId, d: g.date, t: dayT(g.date),
      // a game without a linked deck groups under its deck name
      deck: g.deckId ? String(g.deckId) : '?' + String(g.deckName || '').toLowerCase(), deckName: g.deckName || '',
      bracket: g.bracket == null ? '' : g.bracket, pod: g.podSize || '', seat: g.mySeat || '', place: g.myPlace || '', turns: g.turns || '',
      win: g.winCondition || '', winOther: g.winOther || '', elimBy: g.elimBy || '', elimHow: g.elimHow || '', result: g.resultType || '', opps: opps,
      format: g.format && g.format !== 'Commander' ? g.format : '', set: g.set || '', match: g.matchScore || '', eventId: g.eventId || '',
      colors: g.myColors || '', playDraw: g.playDraw || '', myTime: +g.myTurnTime || 0, myTurns: +g.myTurnsTaken || 0
    };
  });
  const isCmd = g => !g.format || g.format === 'Commander';
  const events = (S.eventsRaw || []).map(e => ({ id: e.id, date: e.date || '', t: dayT(e.date), format: e.format || '', set: e.set || '', store: e.store || '', colors: e.colors || '', status: e.status || '' }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const val = { games: all.filter(isCmd), decks: decks, cmdColors: cmdColors, other: all.filter(g => !isCmd(g)), events: events };
  memo = { key: key, val: val };
  return val;
}
/** True once every game is here (the quick copy on the device only holds the newest 400). */
function ready() { return S.gamesLoaded || (S.cachedCount != null && S.games.length >= S.cachedCount); }

/* ---------- the stats engines (classic Stats.gs) ---------- */
/**
 * Self-contained on purpose (no outside helpers), because the app runs a copy of it.
 * filter: { range: 'all' | 'year' | '90' | '30', types: [deck types] }
 */
export function computeStats(data, filter) {
  filter = filter || {};
  var DAY = 864e5, now = Date.now(), since = 0;
  if (filter.range === '30') since = now - 30 * DAY;
  else if (filter.range === '90') since = now - 90 * DAY;
  else if (filter.range === 'year') since = new Date(new Date().getFullYear(), 0, 1).getTime();
  var types = filter.types && filter.types.length ? filter.types : null;
  var brackets = filter.brackets && filter.brackets.length ? filter.brackets.map(String) : null;
  var opponents = filter.opponents && filter.opponents.length ? filter.opponents.map(function (x) { return String(x).toLowerCase(); }) : null;
  var from = filter.range === 'custom' ? (filter.from || '') : '', to = filter.range === 'custom' ? (filter.to || '') : '';

  function deckInfo(g) {
    return data.decks[g.deck] || { name: g.deckName || 'Unknown deck', colors: 'C', type: 'Not linked' };
  }
  function isWin(g) { return +g.place === 1 && g.result !== 'Draw / shared win'; }
  function base() { return { games: 0, wins: 0, placeSum: 0, placeN: 0, turnSum: 0, turnN: 0 }; }
  function add(b, g) {
    b.games++;
    if (isWin(g)) b.wins++;
    if (+g.place) { b.placeSum += +g.place; b.placeN++; }
    if (+g.turns) { b.turnSum += +g.turns; b.turnN++; }
  }
  function fin(b) {
    b.winRate = b.games ? b.wins / b.games : 0;
    b.avgPlace = b.placeN ? b.placeSum / b.placeN : null;
    b.avgTurns = b.turnN ? b.turnSum / b.turnN : null;
    return b;
  }
  function get(map, key, make) { if (!map[key]) map[key] = make(); return map[key]; }
  function list(map, sortFn) { return Object.keys(map).map(function (k) { return fin(map[k]); }).sort(sortFn); }
  function counts(map) {
    return Object.keys(map).map(function (k) { return { label: k, count: map[k] }; })
      .sort(function (a, b) { return b.count - a.count; });
  }
  function cmdColor(o) {
    if (o.colors) return o.colors; // Beta: the colors saved with the game
    var cc = data.cmdColors || {};
    var s = (cc[String(o.c1).toLowerCase()] || '') + (o.c2 ? (cc[String(o.c2).toLowerCase()] || '') : '');
    var out = '';
    'WUBRG'.split('').forEach(function (c) { if (s.indexOf(c) !== -1) out += c; });
    return out || 'C';
  }

  var typesAvailable = {}, bracketsAvailable = {}, playersAvailable = {};
  data.games.forEach(function (g) {
    typesAvailable[deckInfo(g).type || 'Unknown'] = true;
    if (g.bracket !== '' && g.bracket !== null && g.bracket !== undefined) bracketsAvailable[String(g.bracket)] = true;
    (g.opps || []).forEach(function (o) {
      if (!o.p) return;
      var k = o.p.toLowerCase();
      if (!playersAvailable[k]) playersAvailable[k] = { name: o.p, games: 0 };
      playersAvailable[k].games++;
    });
  });

  var games = data.games.filter(function (g) {
    if (g.t < since) return false;
    if (from && String(g.d) < from) return false;
    if (to && String(g.d) > to) return false;
    if (types && types.indexOf(deckInfo(g).type) === -1) return false;
    if (brackets && brackets.indexOf(String(g.bracket)) === -1) return false;
    if (opponents && !(g.opps || []).some(function (o) { return opponents.indexOf(String(o.p).toLowerCase()) !== -1; })) return false;
    return true;
  }).sort(function (a, b) { return a.t - b.t; });

  var all = base(), decks = {}, seats = {}, brackets = {}, typeMap = {}, pods = {}, months = {};
  var players = {}, cmdrs = {}, wincons = {}, elimHow = {}, elimBy = {};
  var streak = 0, best = 0, draws = 0, placeCounts = {};

  games.forEach(function (g) {
    var di = deckInfo(g);
    add(all, g);
    if (g.result === 'Draw / shared win') draws++;
    if (+g.place) placeCounts[+g.place] = (placeCounts[+g.place] || 0) + 1;

    var db = get(decks, g.deck, function () {
      var b = base(); b.id = g.deck; b.name = di.name; b.colors = di.colors; b.type = di.type; b.last = 0; return b;
    });
    add(db, g);
    db.last = Math.max(db.last, g.t);

    if (+g.seat) add(get(seats, +g.seat, base), g);
    if (g.bracket !== '' && g.bracket !== null && g.bracket !== undefined) add(get(brackets, String(g.bracket), base), g);
    add(get(typeMap, di.type || 'Unknown', base), g);
    if (+g.pod) add(get(pods, +g.pod, base), g);
    add(get(months, String(g.d).slice(0, 7), base), g);

    if (isWin(g)) { streak++; best = Math.max(best, streak); } else streak = 0;
    if (isWin(g) && g.win) {
      var w = (g.win === 'Other' && g.winOther) ? g.winOther : g.win;
      wincons[w] = (wincons[w] || 0) + 1;
    }
    if (+g.place > 1) {
      if (g.elimHow) elimHow[g.elimHow] = (elimHow[g.elimHow] || 0) + 1;
      if (g.elimBy) elimBy[g.elimBy] = (elimBy[g.elimBy] || 0) + 1;
    }

    (g.opps || []).forEach(function (o) {
      var theyWon = +o.place === 1;
      if (o.p) {
        var pb = get(players, o.p.toLowerCase(), function () { return { name: o.p, games: 0, myWins: 0, theirWins: 0 }; });
        pb.games++; if (isWin(g)) pb.myWins++; if (theyWon) pb.theirWins++;
      }
      if (o.c1) {
        var label = o.c1 + (o.c2 ? ' + ' + o.c2 : '');
        var cb = get(cmdrs, label.toLowerCase(), function () { return { name: label, colors: cmdColor(o), games: 0, myWins: 0, theirWins: 0 }; });
        cb.games++; if (isWin(g)) cb.myWins++; if (theyWon) cb.theirWins++;
      }
    });
  });

  function byGames(a, b) { return b.games - a.games || b.winRate - a.winRate; }
  function vs(m) {
    return Object.keys(m).map(function (k) { var x = m[k]; x.winRate = x.games ? x.myWins / x.games : 0; return x; })
      .sort(function (a, b) { return b.games - a.games || b.theirWins - a.theirWins; });
  }


  // Average turn length per player, from games that recorded turn times
  function turnLengths(list) {
    var t = {};
    list.forEach(function (g) {
      if (g.myTurns) { var me = t['\u0000you'] || (t['\u0000you'] = { name: 'You', time: 0, turns: 0, games: 0 }); me.time += g.myTime; me.turns += g.myTurns; me.games++; }
      (g.opps || []).forEach(function (o) {
        if (!o.turns || !o.p || o.team === 'A') return;
        var k = o.p.toLowerCase(), x = t[k] || (t[k] = { name: o.p, time: 0, turns: 0, games: 0 });
        x.time += o.time; x.turns += o.turns; x.games++;
      });
    });
    return Object.keys(t).map(function (k) { var x = t[k]; x.avg = x.turns ? x.time / x.turns : 0; return x; })
      .filter(function (x) { return x.turns; }).sort(function (a, b) { return b.avg - a.avg; });
  }
  return {
    turnLengths: turnLengths(games),
    filtered: games.length,
    overview: Object.assign(fin(all), {
      draws: draws, currentStreak: streak, bestStreak: best, placeCounts: placeCounts,
      form: games.slice(-10).map(function (g) { return g.result === 'Draw / shared win' ? 'D' : (isWin(g) ? 'W' : 'L'); }),
      first: games.length ? games[0].d : '', last: games.length ? games[games.length - 1].d : ''
    }),
    byDeck: list(decks, byGames),
    byBracket: Object.keys(brackets).sort().map(function (k) { var b = fin(brackets[k]); b.key = k; return b; }),
    byType: Object.keys(typeMap).map(function (k) { var b = fin(typeMap[k]); b.key = k; return b; }).sort(byGames),
    byPod: Object.keys(pods).map(Number).sort(function (a, b) { return a - b; }).map(function (k) { var b = fin(pods[k]); b.key = k; return b; }),
    bySeatKeyed: Object.keys(seats).map(Number).sort(function (a, b) { return a - b; }).map(function (k) { var b = fin(seats[k]); b.key = k; return b; }),
    monthly: Object.keys(months).sort().map(function (k) { var b = fin(months[k]); b.key = k; return b; }),
    players: vs(players),
    commanders: vs(cmdrs),
    winCons: counts(wincons),
    elimHow: counts(elimHow),
    elimBy: counts(elimBy),
    typesAvailable: Object.keys(typesAvailable).sort(),
    bracketsAvailable: Object.keys(bracketsAvailable).sort(),
    playersAvailable: Object.keys(playersAvailable).map(function (k) { return playersAvailable[k]; })
      .sort(function (a, b) { return b.games - a.games; })
  };
}

/**
 * Stats for every format except Commander. Also self-contained, and sent to the app.
 * filter: { range, from, to, formats: [format names] }
 */
export function computeOtherStats(data, filter) {
  filter = filter || {};
  var DAY = 864e5, now = Date.now(), since = 0;
  if (filter.range === '30') since = now - 30 * DAY;
  else if (filter.range === '90') since = now - 90 * DAY;
  else if (filter.range === 'year') since = new Date(new Date().getFullYear(), 0, 1).getTime();
  var from = filter.range === 'custom' ? (filter.from || '') : '', to = filter.range === 'custom' ? (filter.to || '') : '';
  var fmts = filter.formats && filter.formats.length ? filter.formats : null;
  var src = data.other || [], fmtAvail = {};
  src.forEach(function (g) { fmtAvail[g.format] = (fmtAvail[g.format] || 0) + 1; });

  var games = src.filter(function (g) {
    if (g.t < since) return false;
    if (from && String(g.d) < from) return false;
    if (to && String(g.d) > to) return false;
    if (fmts && fmts.indexOf(g.format) === -1) return false;
    return true;
  }).sort(function (a, b) { return a.t - b.t; });

  function isWin(g) { return +g.place === 1 && g.result !== 'Draw / shared win'; }
  function isDraw(g) { return g.result === 'Draw / shared win'; }
  function base() { return { games: 0, wins: 0, losses: 0, draws: 0 }; }
  function add(b, g) { b.games++; if (isDraw(g)) b.draws++; else if (isWin(g)) b.wins++; else b.losses++; }
  function fin(b) { b.winRate = b.games ? b.wins / b.games : 0; return b; }
  function get(map, key, make) { if (!map[key]) map[key] = make(); return map[key]; }
  function list(map) { return Object.keys(map).map(function (k) { return fin(map[k]); }).sort(function (a, b) { return b.games - a.games || b.winRate - a.winRate; }); }
  function deckLabel(g) { return g.set ? g.set + ' ' + g.format : (g.deckName || g.format); }

  var all = base(), formats = {}, decks = {}, sets = {}, pd = {}, players = {}, oppDecks = {};
  var streak = 0, best = 0, gw = 0, gl = 0, matches = 0;
  games.forEach(function (g) {
    add(all, g);
    var m = String(g.match || '').match(/^(\d+)-(\d+)$/);
    if (m) { gw += +m[1]; gl += +m[2]; matches++; }
    add(get(formats, g.format, function () { var b = base(); b.key = g.format; return b; }), g);
    var dk = (g.format + '|' + deckLabel(g) + '|' + (g.colors || '')).toLowerCase();
    add(get(decks, dk, function () { var b = base(); b.name = deckLabel(g); b.format = g.format; b.colors = g.colors || 'C'; return b; }), g);
    if (g.set) add(get(sets, g.set.toLowerCase(), function () { var b = base(); b.key = g.set; return b; }), g);
    if (g.playDraw) add(get(pd, g.playDraw, function () { var b = base(); b.key = g.playDraw; return b; }), g);
    if (isWin(g)) { streak++; best = Math.max(best, streak); } else if (!isDraw(g)) streak = 0;
    var mine = g.opps.filter(function (o) { return o.team && o.team === 'A'; }).length ? 'A' : '';
    (g.opps || []).forEach(function (o) {
      if (mine && o.team === mine) return; // teammates aren't opponents
      if (o.p) {
        var pb = get(players, o.p.toLowerCase(), function () { var b = base(); b.name = o.p; return b; });
        add(pb, g);
      }
      if (o.deck) {
        var ob = get(oppDecks, o.deck.toLowerCase(), function () { var b = base(); b.name = o.deck; b.colors = o.colors || 'C'; return b; });
        add(ob, g);
      }
    });
  });

  var rec = {};
  games.forEach(function (g) { if (g.eventId) add(get(rec, g.eventId, base), g); });
  var events = (data.events || []).filter(function (e) {
    if (fmts && fmts.indexOf(e.format) === -1) return false;
    return e.t >= since && (!from || String(e.date) >= from) && (!to || String(e.date) <= to);
  }).map(function (e) {
    var r = rec[e.id] || base();
    return { id: e.id, date: e.date, format: e.format, set: e.set, store: e.store, colors: e.colors, status: e.status, wins: r.wins, losses: r.losses, draws: r.draws };
  });


  // Average turn length per player, from games that recorded turn times
  function turnLengths(list) {
    var t = {};
    list.forEach(function (g) {
      if (g.myTurns) { var me = t['\u0000you'] || (t['\u0000you'] = { name: 'You', time: 0, turns: 0, games: 0 }); me.time += g.myTime; me.turns += g.myTurns; me.games++; }
      (g.opps || []).forEach(function (o) {
        if (!o.turns || !o.p || o.team === 'A') return;
        var k = o.p.toLowerCase(), x = t[k] || (t[k] = { name: o.p, time: 0, turns: 0, games: 0 });
        x.time += o.time; x.turns += o.turns; x.games++;
      });
    });
    return Object.keys(t).map(function (k) { var x = t[k]; x.avg = x.turns ? x.time / x.turns : 0; return x; })
      .filter(function (x) { return x.turns; }).sort(function (a, b) { return b.avg - a.avg; });
  }
  return {
    turnLengths: turnLengths(games),
    filtered: games.length,
    overview: Object.assign(fin(all), {
      currentStreak: streak, bestStreak: best, matches: matches, gameWins: gw, gameLosses: gl,
      form: games.slice(-10).map(function (g) { return isDraw(g) ? 'D' : (isWin(g) ? 'W' : 'L'); })
    }),
    byFormat: list(formats), byDeck: list(decks), bySet: list(sets),
    playDraw: ['Play', 'Draw'].filter(function (k) { return pd[k]; }).map(function (k) { return fin(pd[k]); }),
    players: list(players), oppDecks: list(oppDecks), events: events,
    formatsAvailable: Object.keys(fmtAvail).sort()
  };
}

/* ---------- drawing (classic 1.13) ---------- */
function barRow(label, right, rate, colors, sub) {
  return '<div class="srow"><div class="sline"><span class="sname">' + esc(label) + '</span><span class="snum">' + esc(right) + '</span></div>' +
    '<div class="track"><div class="fill" style="width:' + Math.max(2, Math.round(rate * 100)) + '%;' + (colors ? 'background:' + manaGradient(colors, '90deg') : '') + '"></div></div>' +
    (sub ? '<small class="muted">' + esc(sub) + '</small>' : '') + '</div>';
}
function colChart(items, labelFn) {
  // a long run of months scrolls sideways instead of squeezing every column
  return '<div class="colwrap"><div class="cols' + (items.length > 8 ? ' many' : '') + '">' + items.map((x, i) => '<div class="col"><div class="bar" style="height:' + Math.max(2, Math.round(x.winRate * 100)) + '%"><span>' + pct(x.winRate) + '</span></div>' +
    '<small>' + esc(labelFn(x, i)) + '<br>' + x.games + ' g</small></div>').join('') + '</div></div>';
}
function monthLabel(x, i, list) {
  const p = x.key.split('-'), d = new Date(+p[0], +p[1] - 1, 1), m = d.toLocaleDateString(undefined, { month: 'short' });
  // the year shows on the first column and on each January, so months from different years can't be mixed up
  const multi = list[0].key.slice(0, 4) !== list[list.length - 1].key.slice(0, 4);
  return multi && (i === 0 || p[1] === '01') ? m + ' \u2019' + p[0].slice(2) : m;
}
function turnLengthHtml(list) {
  if (!list || list.length < 2) return '';
  const max = list[0].avg || 1;
  return '<h2>Turn length</h2><p class="muted" style="margin:-6px 0 8px"><small>Average time per turn, longest first. Only games played with the life counter count.</small></p><div class="panel">' +
    list.map((x, i) => barRow(x.name + (i === 0 ? ' (longest)' : i === list.length - 1 ? ' (shortest)' : ''), mmss(x.avg * 1000), x.avg / max, null,
      x.turns + (x.turns === 1 ? ' turn' : ' turns') + ' over ' + gamesWord(x.games))).join('') + '</div>';
}
function rangeHtml(f) {
  let h = seg('srange', RANGES.concat([{ val: 'custom', label: 'Pick dates' }]), f.range, { cls: 'srange' });
  if (f.range === 'custom') {
    h += '<div class="row" style="margin-top:10px"><div><span class="label">From</span><input type="date" data-sf="from" value="' + esc(f.from) + '"></div>' +
      '<div><span class="label">To</span><input type="date" data-sf="to" value="' + esc(f.to) + '"></div></div>';
  }
  return h;
}

/* ---------- the Stats screen ---------- */
export function viewStats() {
  let h = '<header class="top"><button class="link back" data-act="home">\u2039 Home</button><h3>Stats</h3><span style="width:60px"></span></header>';
  if (!ready()) return h + '<p class="muted loading">Crunching the numbers\u2026</p>';
  const data = statsData(), f = S.statsFilter;
  if (!data.games.length && !data.other.length) return h + '<p class="muted" style="margin-top:24px">Log your first game and your win rate, decks, opponents and more show up here.</p>';
  if (!S.statsMode) S.statsMode = data.games.length || !data.other.length ? 'cmd' : 'other';
  if (data.other.length) h += '<div style="margin-bottom:10px">' + seg('smode', [{ val: 'cmd', label: 'Commander' }, { val: 'other', label: 'Other formats' }], S.statsMode === 'other' ? 'other' : 'cmd') + '</div>';
  if (S.statsMode === 'other' && data.other.length) return viewOtherStats(h, data);
  const st = computeStats(data, f);
  h += rangeHtml(f);
  const chipRow = (name, items, chosen) => '<div class="chips">' + items.map(it =>
    '<button data-seg="' + name + '" data-val="' + esc(it.val) + '" class="' + (chosen.indexOf(it.val) !== -1 ? 'on' : '') + '">' + esc(it.label) + '</button>').join('') + '</div>';
  const active = f.types.length + f.brackets.length + f.opponents.length;
  h += '<details style="margin-top:8px"' + (S.open.morefilters ? ' open' : '') + ' id="morefilters"><summary>More filters' + (active ? ' (' + active + ' on)' : '') + '</summary>';
  h += '<span class="label" style="margin-top:6px">Deck type</span>' + chipRow('stype', st.typesAvailable.map(t => ({ val: t, label: typeLabel(t) })), f.types);
  if (st.bracketsAvailable.length) h += '<span class="label" style="margin-top:12px">Bracket</span>' + chipRow('sbr', st.bracketsAvailable.map(b => ({ val: b, label: 'Bracket ' + b })), f.brackets);
  if (st.playersAvailable.length) h += '<span class="label" style="margin-top:12px">Games against</span>' + chipRow('sopp', st.playersAvailable.map(p => ({ val: p.name.toLowerCase(), label: p.name })), f.opponents);
  if (active) h += '<button class="link" data-act="sclear">Clear these filters</button>';
  h += '</details>';
  if (!st.filtered) return h + '<p class="muted" style="margin-top:24px">No games match these filters yet.</p>';
  const o = st.overview;
  h += '<section class="hero" style="margin-top:18px"><div class="num">' + pct(o.winRate) + '</div><p>win rate across ' + gamesWord(o.games) + (o.draws ? ', plus ' + o.draws + (o.draws === 1 ? ' draw' : ' draws') : '') + '</p></section>';
  h += '<div class="stats4"><div><b>' + one(o.avgPlace) + '</b><small>Avg finish</small></div><div><b>' + one(o.avgTurns) + '</b><small>Avg turns</small></div>' +
    '<div><b>' + o.bestStreak + '</b><small>Best streak</small></div><div><b>' + o.currentStreak + '</b><small>Current streak</small></div></div>';

  // Decks
  const decks = st.byDeck.slice();
  if (S.statsSort === 'rate') decks.sort((a, b) => b.winRate - a.winRate || b.games - a.games);
  h += '<h2>Decks</h2><div class="seg" style="margin-bottom:6px"><button data-act="ssort" data-val="games" class="' + (S.statsSort !== 'rate' ? 'on' : '') + '">Most played</button><button data-act="ssort" data-val="rate" class="' + (S.statsSort === 'rate' ? 'on' : '') + '">Best win rate</button></div>';
  h += '<div class="panel">' + decks.map(d => barRow(d.name, pct(d.winRate), d.winRate, d.colors,
    d.wins + ' of ' + gamesWord(d.games) + ', avg finish ' + one(d.avgPlace) + (d.avgTurns ? ', ' + one(d.avgTurns) + ' turns' : '') + ', ' + typeLabel(d.type))).join('') + '</div>';

  if (st.bySeatKeyed.length) h += '<h2>Win rate by seat</h2><p class="muted" style="margin:-6px 0 8px"><small>Seat 1 goes first.</small></p><div class="panel">' + colChart(st.bySeatKeyed, x => 'Seat ' + x.key) + '</div>';
  if (st.monthly.length) h += '<h2>Month by month</h2><div class="panel">' + colChart(st.monthly, (x, i) => monthLabel(x, i, st.monthly)) + '</div>';
  if (st.byBracket.length) h += '<h2>By bracket</h2><div class="panel">' + st.byBracket.map(b => barRow('Bracket ' + b.key, pct(b.winRate), b.winRate, null, b.wins + ' of ' + gamesWord(b.games))).join('') + '</div>';
  if (st.byType.length) h += '<h2>By deck type</h2><div class="panel">' + st.byType.map(b => barRow(typeLabel(b.key), pct(b.winRate), b.winRate, null, b.wins + ' of ' + gamesWord(b.games))).join('') + '</div>';
  if (st.byPod.length) h += '<h2>By pod size</h2><div class="panel">' + st.byPod.map(b => barRow(b.key + ' players', pct(b.winRate), b.winRate, null, b.wins + ' of ' + gamesWord(b.games))).join('') + '</div>';

  h += turnLengthHtml(st.turnLengths);
  if (st.players.length) {
    const max = Math.max.apply(null, st.players.map(p => p.games));
    h += '<h2>Opponents</h2><div class="panel">' + st.players.map(p => barRow(p.name, gamesWord(p.games), p.games / max, null,
      'You won ' + p.myWins + ', they won ' + p.theirWins + ' (your win rate ' + pct(p.winRate) + ')')).join('') + '</div>';
  }
  if (st.commanders.length) {
    const max = Math.max.apply(null, st.commanders.map(c => c.games));
    h += '<h2>Opponent commanders</h2><div class="panel">' + st.commanders.slice(0, 25).map(c => barRow(c.name, 'faced ' + c.games + '\u00D7', c.games / max, c.colors,
      'They won ' + c.theirWins + ', you won ' + c.myWins)).join('') + '</div>';
  }
  const countBlock = (title, items) => {
    if (!items.length) return '';
    const max = items[0].count;
    return '<h2>' + title + '</h2><div class="panel">' + items.map(x => barRow(x.label, String(x.count), x.count / max)).join('') + '</div>';
  };
  h += countBlock('How you win', st.winCons) + countBlock('How you get knocked out', st.elimHow) + countBlock('Who knocks you out', st.elimBy);
  return h;
}

function viewOtherStats(h, data) {
  const f = S.statsFilter;
  f.formats = f.formats || [];
  const st = computeOtherStats(data, f);
  h += rangeHtml(f);
  if (st.formatsAvailable.length > 1) {
    h += '<span class="label" style="margin-top:12px">Formats</span><div class="chips">' + st.formatsAvailable.map(x =>
      '<button data-seg="sfmt" data-val="' + esc(x) + '" class="' + (f.formats.indexOf(x) !== -1 ? 'on' : '') + '">' + esc(x) + '</button>').join('') + '</div>';
  }
  if (!st.filtered) return h + '<p class="muted" style="margin-top:24px">No games match these filters yet.</p>';
  const o = st.overview, rec = x => x.wins + '-' + x.losses + (x.draws ? '-' + x.draws : '');
  h += '<section class="hero" style="margin-top:18px"><div class="num">' + pct(o.winRate) + '</div><p>win rate across ' + o.games + (o.games === 1 ? ' game or match' : ' games and matches') + '</p></section>';
  h += '<div class="stats4"><div><b>' + rec(o) + '</b><small>Record</small></div><div><b>' + (o.matches ? o.gameWins + '-' + o.gameLosses : 'none') + '</b><small>Games in matches</small></div>' +
    '<div><b>' + o.bestStreak + '</b><small>Best streak</small></div><div><b>' + o.currentStreak + '</b><small>Current streak</small></div></div>';
  const rows = (items, label, colors, sub) => '<div class="panel">' + items.map(x => barRow(label(x), pct(x.winRate), x.winRate, colors ? colors(x) : null, sub ? sub(x) : rec(x) + ' in ' + gamesWord(x.games))).join('') + '</div>';
  if (st.byFormat.length > 1) h += '<h2>By format</h2>' + rows(st.byFormat, x => x.key);
  h += '<h2>Decks</h2>' + rows(st.byDeck, x => x.name + (x.name.indexOf(x.format) === -1 ? ' (' + x.format + ')' : ''), x => x.colors);
  if (st.bySet.length) h += '<h2>By set</h2>' + rows(st.bySet, x => x.key);
  if (st.playDraw.length) h += '<h2>On the play or the draw</h2>' + rows(st.playDraw, x => 'On the ' + x.key.toLowerCase());
  if (st.events.length) {
    h += '<h2>Events</h2><div class="panel">' + st.events.map(e => barRow(eventLabel(e), recordText(e), (e.wins + e.losses + e.draws) ? e.wins / (e.wins + e.losses + e.draws) : 0, e.colors || 'C',
      niceDate(e.date) + (e.status === 'Active' ? ', in progress' : ''))).join('') + '</div>';
  }
  h += turnLengthHtml(st.turnLengths);
  if (st.players.length) h += '<h2>Opponents</h2>' + rows(st.players, x => x.name, null, x => 'You went ' + rec(x) + ' against them');
  if (st.oppDecks.length) h += '<h2>Opponent decks</h2>' + rows(st.oppDecks, x => x.name, x => x.colors, x => 'You went ' + rec(x) + ' against it');
  return h;
}

/* ---------- the home screen card (classic 1.13) ---------- */
function donut(rate) {
  const r = 46, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, rate || 0));
  return '<svg viewBox="0 0 120 120" width="120" height="120" style="flex:none" role="img" aria-label="Win rate ' + pct(f) + '">' +
    '<defs><linearGradient id="donutg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent2, var(--accent))"/></linearGradient></defs>' +
    '<circle cx="60" cy="60" r="' + r + '" fill="none" stroke="var(--surface2)" stroke-width="16"/>' +
    '<circle cx="60" cy="60" r="' + r + '" fill="none" stroke="url(#donutg)" stroke-width="16" stroke-linecap="round" stroke-dasharray="' + (c * f).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 60 60)"/>' +
    '<text x="60" y="70" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-weight="700" font-size="32" fill="var(--ink)">' + pct(f) + '</text></svg>';
}
function placeBar(counts) {
  const keys = Object.keys(counts || {}).map(Number).sort((a, b) => a - b);
  const total = keys.reduce((t, k) => t + counts[k], 0);
  if (!total) return '';
  return '<div class="pbar">' + keys.map((k, i) => '<span style="flex:' + counts[k] + ';opacity:' + Math.max(.25, 1 - i * .25) + '" title="' + ordinal(k) + ': ' + counts[k] + '"></span>').join('') + '</div>' +
    '<small class="muted">' + keys.map(k => ordinal(k) + ' ' + counts[k]).join(', ') + '</small>';
}
function turnSpark(monthly) {
  const m = monthly.filter(x => x.avgTurns);
  if (m.length < 2) return '<small class="muted">rounds per game</small>';
  const max = Math.max(...m.map(x => x.avgTurns));
  return '<div class="spark" title="Average rounds by month">' + m.slice(-8).map(x => '<span style="height:' + Math.round(x.avgTurns / max * 100) + '%"></span>').join('') + '</div>';
}
/** Commander stats on home, for the span picked in Settings (classic's "Home screen stats show"). */
export function homeStatsHtml() {
  // with more than 400 games, the quick copy on the device isn't all of them, so this waits a moment for the rest
  if (!ready()) return '';
  const data = statsData(), hr = S.settings.homeRange || 'all';
  const st = computeStats(data, { range: hr });
  const span = { all: '', year: ' this year', '90': ' in the last 90 days', '30': ' in the last 30 days' }[hr] || '';
  if (st.filtered) {
    const o = st.overview;
    return '<section class="homecard"><div class="donutrow">' + donut(o.winRate) + '<p><b class="cond" style="font-size:24px">' + pct(o.winRate) + ' win rate</b><br>across ' + gamesWord(o.games) + span + '</p></div>' +
      '<div class="tiles">' +
      '<div class="tile"><small>Avg finish</small><b>' + one(o.avgPlace) + '</b>' + placeBar(o.placeCounts) + '</div>' +
      '<div class="tile"><small>Avg turns</small><b>' + one(o.avgTurns) + '</b>' + turnSpark(st.monthly) + '</div>' +
      '<div class="tile"><small>Best streak</small><b>' + o.bestStreak + '</b><small class="muted">wins in a row</small></div>' +
      '<div class="tile"><small>Current streak</small><b>' + o.currentStreak + '</b><div class="dots" title="Last 10 games, newest last">' + o.form.map(x => '<i class="' + x + '"></i>').join('') + '</div></div>' +
      '</div></section>';
  }
  if (data.games.length) return '<section class="homecard"><p>No Commander games' + span + ' yet. Your home stats are set to show' + (span || ' all time') + ' (change it in Settings).</p></section>';
  if (data.other.length) return '';
  return '<section class="homecard"><p>Log your first game and your win rate, finishes and streaks will show up here.</p></section>';
}
/** The little line under the Stats button on home. */
export function statsBlurb() {
  if (!ready()) return 'Loading\u2026';
  const data = statsData();
  if (!data.games.length && !data.other.length) return 'After your first game';
  return 'Decks, opponents and more';
}

/* ---------- Settings: what the home card shows ---------- */
export function settingsStatsHtml() {
  return '<div class="field" style="margin-top:14px"><span class="label">Home screen stats show</span>' + seg('homerange', RANGES, S.settings.homeRange || 'all') +
    '<p class="muted" style="margin-top:6px"><small>For your Commander games. The Stats screen has every format and more filters.</small></p></div>';
}

/** The month chart opens on the newest months. */
export function afterStats() { document.querySelectorAll('.colwrap').forEach(w => { w.scrollLeft = w.scrollWidth; }); }

/* ---------- taps ---------- */
export function onStatsAct(act, el) {
  if (act === 'stats') { H.go('stats'); return true; }
  if (act === 'sclear') { Object.assign(S.statsFilter, { types: [], brackets: [], opponents: [] }); H.rerenderKeep(); return true; }
  if (act === 'ssort') { S.statsSort = el.dataset.val; H.rerenderKeep(); return true; }
  return false;
}
export function onStatsSeg(name, val) {
  if (name === 'homerange') { H.setSettings({ homeRange: val }); H.rerenderKeep(); return true; }
  if (S.view !== 'stats') return false;
  const f = S.statsFilter;
  if (name === 'smode') { S.statsMode = val; H.rerenderKeep(); return true; }
  if (name === 'srange') { f.range = val; H.rerenderKeep(); return true; }
  if (name === 'sfmt') { const t = f.formats || (f.formats = []), i = t.indexOf(val); if (i === -1) t.push(val); else t.splice(i, 1); H.rerenderKeep(); return true; }
  if (name === 'stype' || name === 'sbr' || name === 'sopp') {
    const t = f[{ stype: 'types', sbr: 'brackets', sopp: 'opponents' }[name]], i = t.indexOf(val);
    if (i === -1) t.push(val); else t.splice(i, 1);
    S.open.morefilters = true; H.rerenderKeep(); return true;
  }
  return false;
}
export function onStatsChange(t) {
  if (!t.dataset || !t.dataset.sf) return false;
  S.statsFilter[t.dataset.sf] = t.value; H.rerenderKeep(); return true;
}
