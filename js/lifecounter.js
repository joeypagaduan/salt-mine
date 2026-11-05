// The life counter, ported from classic 1.13 with as few changes as possible so it behaves the same:
// life, poison, commander damage (with the countdown), tax, energy, experience, rad counters, the Ring,
// the monarch and the initiative (with prompts), emblems, undo, history, coins, dice, random attack,
// turn times, reminder animations, best of 3, layouts, rotate and swap seats, and elimination messages.
import { S, H } from './state.js';
import { esc, store, toast, manaGradient } from './util.js';
import {
  isCmd, teamSize, sides, startLife, teammates, otherTeam, oppName, myName, isYou, plural, lcKeys, lcInfo,
  setSeatFor, assignTurnOrder, matchToPlaces, shortCmd
} from './game.js';

const app = document.getElementById('app');
const PANEL_COLORS = [['blue', '#2F6FD0'], ['green', '#2E9658'], ['red', '#CF4336'], ['purple', '#7C55C4'], ['orange', '#DF862B'], ['teal', '#1C9E9E']];
function artUrl(name) { return 'https://api.scryfall.com/cards/named?exact=' + encodeURIComponent(name) + '&format=image&version=art_crop'; }
function mmss(ms) { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function poisonMax(d) { const t = teamSize(d); return t === 2 ? 15 : t === 3 ? 20 : 10; }

/* ---------- life counter ---------- */
const LC_LAYOUTS = {
  2: [{ id: '2-face', name: 'Face to face', areas: "'T' 'B'", rows: '1fr 1fr', cols: '1fr', pos: ['B', 'T'] },
      { id: '2-side', name: 'Side by side', areas: "'L R'", rows: '1fr', cols: '1fr 1fr', pos: ['L', 'R'] }],
  3: [{ id: '3-sides', name: 'Two sides, you at the bottom', areas: "'L R' 'B B'", rows: '1.6fr 1fr', cols: '1fr 1fr', pos: ['B', 'L', 'R'] },
      { id: '3-across', name: 'Two across from you', areas: "'TL TR' 'B B'", rows: '1fr 1fr', cols: '1fr 1fr', pos: ['B', 'TL', 'TR'] }],
  4: [{ id: '4-square', name: 'One per side', areas: "'T T' 'L R' 'B B'", rows: '1fr 1.5fr 1fr', cols: '1fr 1fr', pos: ['B', 'L', 'T', 'R'] },
      { id: '4-sides', name: 'Two per side', areas: "'LT RT' 'LB RB'", rows: '1fr 1fr', cols: '1fr 1fr', pos: ['LB', 'LT', 'RT', 'RB'] }],
  5: [{ id: '5-sides', name: 'Two per side, you at the bottom', areas: "'LT RT' 'LB RB' 'B B'", rows: '1fr 1fr .85fr', cols: '1fr 1fr', pos: ['B', 'LB', 'LT', 'RT', 'RB'] },
      { id: '5-square', name: 'Around the square', areas: "'T T' 'L R' 'BL BR'", rows: '1fr 1.5fr 1fr', cols: '1fr 1fr', pos: ['BR', 'BL', 'L', 'T', 'R'] }],
  6: [{ id: '6-sides', name: 'Three per side', areas: "'LT RT' 'LM RM' 'LB RB'", rows: '1fr 1fr 1fr', cols: '1fr 1fr', pos: ['LB', 'LM', 'LT', 'RT', 'RM', 'RB'] },
      { id: '6-square', name: 'Around the square', areas: "'TL TR' 'L R' 'BL BR'", rows: '1fr 1.5fr 1fr', cols: '1fr 1fr', pos: ['BR', 'BL', 'L', 'TL', 'TR', 'R'] }]
};
const LC_ROT = { B: 0, BL: 0, BR: 0, T: 180, TL: 180, TR: 180, L: 90, LT: 90, LM: 90, LB: 90, R: -90, RT: -90, RM: -90, RB: -90 };
function lcLayout(n) {
  const list = LC_LAYOUTS[n] || LC_LAYOUTS[4], id = (S.settings.layouts || {})[n];
  return list.find(l => l.id === id) || list[0];
}
function lcRot(k) { const L = S.draft.life, lay = lcLayout(L.n); return LC_ROT[lay.pos[L.seats.indexOf(k)]] || 0; }
function layoutPreview(lay, meIdx) {
  return '<span class="lprev" style="grid-template-areas:' + lay.areas + ';grid-template-rows:' + lay.rows + ';grid-template-columns:' + lay.cols + '">' +
    lay.pos.map((p, i) => '<i style="grid-area:' + p + '"' + (i === (meIdx || 0) ? ' class="me"' : '') + '></i>').join('') + '</span>';
}
const LC_COLORS = ['#EF8DA7', '#5AA9F0', '#5CC28A', '#F0A35A', '#B497F2', '#5CCBCB'];
const LC_HOW = ['Combat damage', 'Commander damage', 'Combo', 'Infect / poison', 'Life drain', 'Alternate win card', 'Mill', 'Concession', 'Other'];
const LC = { bubble: {}, panel: null, menu: null, swap: null, hl: null, spinning: false, timer: null, histTab: 'list', wake: null, nudge: {}, pend: [], prompt: null };

/* ----- elimination messages ----- */
const ELIM_DEFAULTS = {
  general: ['Died to your own incompetence', 'You were the archenemy all along', 'Skill issue', "Should've read the card", 'Outplayed by yourself',
    'Salt deposit established', 'Your deck is now a coaster', 'Sent to the shadow realm', 'Rest in pieces', 'Thoughts and prayers',
    'Gone, but not forgotten (yet)', 'Scooped by fate', 'Board wiped, emotionally', "You've been archived", 'What happened?'],
  cmd: ["{killer}'s commander has your name in its notes app", 'Commander damage: 21. Feelings hurt: also 21.', "Got bonked by {killer}'s general", "{killer}'s commander sends its regards"],
  poison: ['Phyrexian compleation achieved', 'Ten little poison counters, zero friends', 'Glistening, then gone', "Should've packed artifact removal"],
  combat: ['Forgot to block', '{killer} turned sideways, you turned to dust', 'Chump-blocked by your own hubris']
};
const ELIM_CATS = [['general', 'Any kind of death'], ['cmd', 'Commander damage'], ['poison', 'Poison / infect'], ['combat', 'Combat damage']];
function elimLines(cat) {
  const custom = S.settings.elimLines && S.settings.elimLines[cat];
  return (Array.isArray(custom) ? custom : ELIM_DEFAULTS[cat]).filter(x => String(x).trim());
}
/** Picks a line matching how they died; lines naming {killer} only when someone else did it. */
function lcRollLine(k) {
  const P = S.draft.life.p[k], o = P.out;
  if (!o) return;
  const killer = o.by && o.by !== k ? o.by : '';
  const ok = l => killer || l.indexOf('{killer}') === -1;
  const cat = o.how === 'Commander damage' ? 'cmd' : o.how === 'Infect / poison' ? 'poison' : o.how === 'Combat damage' ? 'combat' : 'general';
  let pool = cat !== 'general' ? elimLines(cat).filter(ok) : [];
  if (!pool.length) pool = elimLines('general').filter(ok);
  o.line = pool.length ? pool[Math.floor(Math.random() * pool.length)] : 'Out';
}
function lcLineText(k) {
  const o = S.draft.life.p[k].out;
  if (!o) return '';
  const killer = o.by && o.by !== k ? lcInfo(o.by).name : 'someone';
  return String(o.line || 'Out').replace(/\{killer\}/g, killer);
}
function lcEnsure() {
  const d = S.draft, keys = lcKeys();
  let L = d.life;
  if (!L || L.n !== keys.length || L.seats.length !== keys.length || L.seats.some(k => keys.indexOf(k) === -1)) {
    L = d.life = { n: keys.length, start: startLife(), seats: keys.slice(), p: {}, hist: [], first: null, active: null, round: 1, turnAt: null, startAt: Date.now(), outCount: 0, over: false };
  }
  if (d.firstKey && L.first !== d.firstKey && !L.hist.some(h => h.ty === 'turn')) {
    L.first = d.firstKey; L.active = d.firstKey; L.turnAt = Date.now();
  }
  keys.forEach(k => { if (!L.p[k]) L.p[k] = { life: L.start, poison: 0, rad: 0, cmd: {}, out: null }; });
  keys.forEach(k => { const P = L.p[k]; if (!P.emb) P.emb = []; if (P.ring == null) P.ring = 0; if (!P.tax) P.tax = {}; if (P.time == null) { P.time = 0; P.tturns = 0; } });
  if (L.turnId == null) L.turnId = 0;
  if (!L.snap) lcSnap();
  return L;
}
function lcAlive() { const L = S.draft.life; return L.seats.filter(k => !L.p[k].out); }

function lcValue(k, ty, src) {
  const P = S.draft.life.p[k];
  if (ty === 'cmd') return P.cmd[src] || 0;
  if (ty === 'tax') return (P.tax || {})[src] || 0;
  return ty === 'life' ? P.life : (P[ty] || 0); // poison, rad, ring, energy, exp
}
function lcLog(k, ty, delta, src) {
  const L = S.draft.life, now = Date.now(), h = L.hist, last = h[h.length - 1], v = lcValue(k, ty, src);
  if (last && last.k === k && last.ty === ty && (last.src || '') === (src || '') && now - last.t < 3000) {
    last.d += delta; last.v = v; last.t = now;
    if (!last.d) h.pop();
  } else h.push({ t: now, k: k, ty: ty, d: delta, v: v, src: src || '', r: L.round });
  if (ty === 'life') {
    const b = LC.bubble[k];
    LC.bubble[k] = { d: (b && now - b.t < 1800 ? b.d : 0) + delta, t: now };
  }
}
/** Commander damage logs the life it costs and the damage itself as a linked pair, merged for quick repeated taps. */
function lcLogCmd(k, src, d) {
  const L = S.draft.life, h = L.hist, now = Date.now(), n = h.length, P = L.p[k];
  const a = h[n - 2], b = h[n - 1];
  if (a && b && b.ty === 'cmd' && b.k === k && b.src === src && a.ty === 'life' && a.cm === src && a.k === k && now - b.t < 3000) {
    a.d -= d; a.v = P.life; a.t = now; b.d += d; b.v = P.cmd[src]; b.t = now;
    if (!b.d) h.splice(n - 2, 2);
  } else {
    h.push({ t: now, k: k, ty: 'life', d: -d, v: P.life, src: '', cm: src, r: L.round });
    h.push({ t: now, k: k, ty: 'cmd', d: d, v: P.cmd[src], src: src, r: L.round });
  }
  if (!(LC.show && LC.show[k] != null)) { const bb = LC.bubble[k]; LC.bubble[k] = { d: (bb && now - bb.t < 1800 ? bb.d : 0) - d, t: now }; }
}
/* ----- undo ----- */
const UNDO_TY = { life: 'life', poison: 'poison', rad: 'rad', ring: 'Ring temptation', cmd: 'commander damage', energy: 'energy', exp: 'experience', tax: 'commander tax' };
function lcUndoIndex() {
  const h = (S.draft.life || {}).hist || [];
  for (let i = h.length - 1; i >= 0; i--) { const e = h[i]; if (UNDO_TY[e.ty] && !(e.ty === 'life' && e.cm)) return i; }
  return -1;
}
function lcUndoLabel() {
  const i = lcUndoIndex();
  if (i < 0) return '';
  const e = S.draft.life.hist[i], sign = e.d > 0 ? '+' : '−';
  let what = UNDO_TY[e.ty];
  if (e.ty === 'cmd') what = 'commander damage from ' + lcInfo(e.src.split(':')[0]).name;
  if (e.ty === 'tax') what = 'casts of ' + shortCmd(lcInfo(e.k)['c' + (+e.src + 1)] || 'commander');
  return lcInfo(e.k).name + ' ' + sign + Math.abs(e.d) + ' ' + what;
}
/** Takes back the most recent change. Quick taps on the same thing within 3 seconds count as one change. */
function lcUndo() {
  const L = S.draft.life, h = L.hist, i = lcUndoIndex();
  if (i < 0) return;
  const e = h[i], P = L.p[e.k];
  lcCountdownFinish();
  if (e.ty === 'cmd') {
    P.cmd[e.src] = Math.max(0, (P.cmd[e.src] || 0) - e.d); P.life += e.d;
    const j = i - 1;
    if (h[j] && h[j].ty === 'life' && h[j].cm === e.src && h[j].k === e.k) h.splice(j, 2); else h.splice(i, 1);
    LC.bubble[e.k] = { d: e.d, t: Date.now() };
  } else {
    if (e.ty === 'tax') { P.tax = P.tax || {}; P.tax[e.src] = Math.max(0, (P.tax[e.src] || 0) - e.d); }
    else if (e.ty === 'life') { P.life -= e.d; LC.bubble[e.k] = { d: -e.d, t: Date.now() }; }
    else P[e.ty] = Math.max(0, (P[e.ty] || 0) - e.d);
    h.splice(i, 1);
  }
  lcCheckOut(e.k);
  H.touch(); lcRenderSheets(); lcRenderOverlays(); lcUpdate();
}
/* ----- commander damage countdown ----- */
/** Starts counting a held life total down to its real value once that player's damage screen is closed. Never takes over 1 second. */
function lcCountdowns() {
  const show = LC.show || {};
  Object.keys(show).forEach(k => {
    if (show[k] == null || (LC.panel && LC.panel.k === k) || (LC.cd && LC.cd[k])) return;
    const L = S.draft && S.draft.life, P = L && L.p[k];
    if (!P) { delete show[k]; return; }
    const from = show[k], to = P.life, steps = Math.abs(to - from);
    if (!steps) { delete show[k]; lcAfterCountdown(k); return; }
    const dir = to > from ? 1 : -1, every = Math.min(150, 1000 / steps);
    LC.cd = LC.cd || {};
    const c = LC.cd[k] = { from: from, cur: from, to: to, start: Date.now() };
    const tick = () => {
      if (LC.cd[k] !== c) return;
      c.cur += dir;
      show[k] = c.cur;
      LC.bubble[k] = { d: c.cur - c.from, t: Date.now() };
      if (c.cur === c.to) { delete LC.cd[k]; delete show[k]; lcUpdate(); lcAfterCountdown(k); return; }
      lcUpdate();
      c.timer = setTimeout(tick, every);
    };
    c.timer = setTimeout(tick, every);
  });
}
/** Jumps any running countdown straight to its final total (someone tapped something). */
function lcCountdownFinish() {
  const cd = LC.cd || {}, show = LC.show || {};
  Object.keys(cd).forEach(k => { clearTimeout(cd[k].timer); LC.bubble[k] = { d: cd[k].to - cd[k].from, t: Date.now() }; delete cd[k]; delete show[k]; lcAfterCountdown(k); });
  Object.keys(show).forEach(k => { if (!(LC.panel && LC.panel.k === k)) { delete show[k]; lcAfterCountdown(k); } });
  lcUpdate();
}
function lcAfterCountdown(k) {
  if (!S.draft || !S.draft.life || !S.draft.life.p[k]) return;
  if (lcCheckOut(k)) { lcRenderSheets(); lcRenderOverlays(); }
}
function lcApply(k, ty, delta, src) {
  if (LC.spinning) return;
  const L = S.draft.life, P = L.p[k];
  if (!P) return;
  const before = lcValue(k, ty, src);
  let after = before + delta;
  if (ty !== 'life') after = Math.max(0, after);
  const actual = after - before;
  if (!actual) return;
  if (ty === 'cmd') {
    const x = src.split(':')[0];
    if (actual > 0) lcQueueCmd(k, x, cmdTotal(k, x));
    // While the damage screen is open, the panel keeps showing the old life total; it counts down when the screen closes
    if (LC.panel && LC.panel.k === k && (LC.show || (LC.show = {}))[k] == null) LC.show[k] = P.life;
    P.cmd[src] = after; P.life -= actual;
    lcLogCmd(k, src, actual);
  } else {
    if (ty === 'tax') { P.tax = P.tax || {}; P.tax[src] = after; } else if (ty === 'life') P.life = after; else P[ty] = after;
    lcLog(k, ty, actual, src);
  }
  const changed = lcCheckOut(k);
  H.touch();
  if (changed) { lcRenderSheets(); lcRenderOverlays(); }
  else if ((ty === 'cmd' || ty === 'ring' || ty === 'tax') && LC.panel) lcRenderSheets();
  lcUpdate();
}
/** Marks a player out (or back in) based on life, poison and commander damage. Returns true if that changed. */
function lcCheckOut(k) {
  const L = S.draft.life, P = L.p[k];
  let cause = null, by = '', how = '';
  const hit = Object.keys(P.cmd).find(s => P.cmd[s] >= 21);
  if (hit) { cause = 'Commander damage'; by = hit.split(':')[0]; how = 'Commander damage'; }
  else if (P.poison >= poisonMax()) { cause = 'Poison'; how = 'Infect / poison'; }
  else if (P.life <= 0 && !(LC.show && LC.show[k] != null)) { cause = 'Life'; how = 'Combat damage'; } // waits for the countdown
  if (!cause) P.hold = false;
  // 1v1 (not teams): unless someone says otherwise, the other player knocked them out
  if (cause && !by && L.seats.length === 2 && !teamSize()) by = L.seats.find(x => x !== k) || '';
  if (cause && !P.out && !P.hold) {
    L.outCount++;
    P.out = { order: L.outCount, cause: cause, by: by, how: how, at: Date.now(), r: L.round };
    lcRollLine(k);
    LC.panel = { k: k, mode: 'out' };
    lcDesigOnOut(k);
    lcCheckOver();
    return true;
  }
  if (!cause && P.out && !P.out.manual) { lcRevive(k); return true; }
  return false;
}
function lcRevive(k) {
  const L = S.draft.life, P = L.p[k], o = P.out.order;
  P.out = null; L.outCount--;
  lcDesigOnRevive(k);
  Object.keys(L.p).forEach(x => { if (L.p[x].out && L.p[x].out.order > o) L.p[x].out.order--; });
  if (LC.panel && LC.panel.k === k) LC.panel = null;
  lcCheckOver();
}
function lcCheckOver() {
  const L = S.draft.life, alive = lcAlive();
  if (alive.length === 1 && !L.over) { L.over = true; L.overAt = Date.now(); LC.menu = 'over'; }
  if (alive.length > 1) L.over = false;
}

function lcSetFirst(k) {
  const d = S.draft, L = d.life;
  L.first = k; L.active = k; L.round = 1; L.turnAt = Date.now();
  if (!L.hist.some(h => h.ty === 'turn')) L.startAt = Date.now();
  assignTurnOrder(k);
  L.hist.push({ t: Date.now(), k: k, ty: 'turn', d: 0, v: 1, src: '', r: 1 });
  d.turns = 1;
  L.turnId = (L.turnId || 0) + 1; lcSnap();
  H.touch();
  toast(lcInfo(k).name + (plural(k) ? ' go first' : ' goes first'));
  lcUpdate();
}
function lcAssignSeats() {
  const d = S.draft, L = d.life;
  if (L.first == null) return;
  const n = L.seats.length, f = L.seats.indexOf(L.first);
  L.seats.forEach((k, i) => setSeatFor(k, ((i - f + n) % n) + 1));
}
function lcPickFirst(target) {
  const L = S.draft.life, order = L.seats;
  const pick = target && order.indexOf(target) !== -1 ? order.indexOf(target) : Math.floor(Math.random() * order.length);
  const total = order.length * 3 + pick;
  let step = 0;
  LC.spinning = true; LC.menu = null; lcRenderOverlays();
  const tick = () => {
    LC.hl = order[step % order.length]; lcUpdate();
    step++;
    if (step <= total) setTimeout(tick, 70 + step * 9);
    else setTimeout(() => { LC.spinning = false; LC.hl = null; lcSetFirst(order[pick]); }, 450);
  };
  tick();
}
function lcPass() {
  const L = S.draft.life;
  if (L.first == null) return lcPickFirst();
  if (LC.prompt) return;
  if (lcNextPrompt()) { LC.prompt.then = 'pass'; return; }
  const items = lcStealCandidates();
  if (items.length) { LC.prompt = { kind: 'pass', taker: L.active, items: items }; return lcRenderPrompt(); }
  lcPassNow();
}
function lcPassNow() {
  const d = S.draft, L = d.life;
  const prev = L.active;
  if (prev && L.p[prev]) { L.p[prev].time = (L.p[prev].time || 0) + (Date.now() - L.turnAt); L.p[prev].tturns = (L.p[prev].tturns || 0) + 1; }
  const order = L.seats, n = order.length, f = order.indexOf(L.first);
  let i = order.indexOf(L.active);
  for (let s = 0; s < n; s++) {
    i = (i + 1) % n;
    if (i === f) L.round++;
    if (!L.p[order[i]].out) break;
  }
  L.active = order[i]; L.turnAt = Date.now(); d.turns = L.round;
  L.hist.push({ t: Date.now(), k: L.active, ty: 'turn', d: 0, v: L.round, src: '', r: L.round });
  L.turnId = (L.turnId || 0) + 1; lcSnap();
  H.touch(); lcUpdate();
  lcTurnReminders(prev);
}

/** Turns the life counter into results and opens the results screen. */
function lcFinish() {
  const d = S.draft, L = d.life, n = L.seats.length;
  const setPlace = (k, p) => {
    if (teamSize()) { (k === 'me' ? teammates() : otherTeam()).forEach(o => { o.place = p; }); if (k === 'me') d.myPlace = p; return; }
    if (k === 'me') d.myPlace = p; else d.opponents[+k.slice(1)].place = p;
  };
  const alive = lcAlive();
  L.seats.forEach(k => { const o = L.p[k].out; if (o) setPlace(k, n - o.order + 1); });
  if (alive.length === 1) setPlace(alive[0], 1);
  const me = L.p.me.out;
  // who knocked whom out, as names: "Myself" when it was their own doing
  const byName = (by, k) => !by ? '' : by === k ? 'Myself' : lcInfo(by).name;
  if (me) { d.elimBy = byName(me.by, 'me'); d.elimHow = me.how || ''; d.myOutRound = me.r || ''; }
  // everyone else's knockouts too (2.0.2); team games are logged by hand
  if (!teamSize()) d.opponents.forEach((o, i) => {
    const out = L.p['o' + i] && L.p['o' + i].out;
    if (out) { o.elimBy = byName(out.by, 'o' + i); o.elimHow = out.how || ''; o.outRound = out.r || ''; }
  });
  // best of 3: each game as it happened, the one on the table included
  if (d.bo3 && L.seats.length === 2 && !teamSize()) {
    const games = ((d.match && d.match.games) || []).slice(), alive0 = lcAlive();
    if (alive0.length === 1) {
      const w = alive0[0], lo = L.seats.find(x => x !== w), o = L.p[lo].out || {};
      games.push({ winner: w, loser: lo, by: o.by || '', how: o.how || '', r: o.r || L.round });
    }
    d.matchGames = games.filter(g => g.loser).map(g => ({ winner: lcInfo(g.winner).name, loser: lcInfo(g.loser).name,
      by: g.by ? byName(g.by, g.loser) : lcInfo(g.winner).name, how: g.how || '', round: g.r || g.rounds || '' }));
  }
  if (alive.length === 1) {
    const last = L.seats.filter(k => L.p[k].out).sort((a, b) => L.p[b].out.order - L.p[a].out.order)[0];
    if (last && L.p[last].out.how) d.winCondition = L.p[last].out.how;
  }
  if (d.bo3 && sides() === 2) {
    // Best of 3: the match score decides who finished first
    const m = matchTally(), other = L.seats.find(k => k !== 'me');
    d.matchW = m.me; d.matchL = m[other];
    matchToPlaces(d);
  }
  const tt = lcTurnTimes(), secs = x => Math.round(x / 1000);
  if (tt.me) { d.myTurnTime = secs(tt.me.time); d.myTurnsTaken = tt.me.turns; }
  d.opponents.forEach((o, i) => {
    const key = teamSize() ? (i < teamSize() - 1 ? 'me' : 'g1') : 'o' + i, t = tt[key];
    if (t) { o.turnTime = secs(t.time); o.turnsTaken = t.turns; }
  });
  d.turns = L.round; d.stage = 'ending'; LC.menu = null;
  H.touch(); H.go('ending');
}

/* ----- emblems, the monarch, the initiative and the Ring ----- */
const ICON = {
  crown: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 7.5l4.6 4.2L12 4.5l4.4 7.2L21 7.5 19.2 17H4.8z"/><rect x="4.8" y="18.4" width="14.4" height="2.4" rx="1.2" fill="currentColor"/></svg>',
  init: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 21V11a8 8 0 0 1 16 0v10h-4.5v-6.5a3.5 3.5 0 0 0-7 0V21z"/><rect x="2.5" y="20" width="19" height="2" rx="1" fill="currentColor"/></svg>',
  ring: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="12.5" rx="7.6" ry="7" fill="none" stroke="currentColor" stroke-width="3"/><path d="M7.2 8.6a6.4 6 0 0 1 5-2.3" fill="none" stroke="#FFF3C8" stroke-width="1.3" stroke-linecap="round"/></svg>'
};
ICON.more = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5l2.3 6.7 6.7 2.3-6.7 2.3L12 21.5l-2.3-6.7L3 12.5l6.7-2.3z"/></svg>';
function panelColor(k) {
  const d = S.draft, pick = (d.pcolors || {})[k];
  const hit = PANEL_COLORS.find(c => c[0] === pick);
  if (hit) return hit;
  return PANEL_COLORS[Math.max(0, lcKeys().indexOf(k)) % PANEL_COLORS.length];
}
function panelBg(k) { const c = panelColor(k)[1]; return 'linear-gradient(150deg,' + c + ' 0%,' + c + 'cc 55%,' + c + '88 100%)'; }
/** Games won so far in a best-of-3 match, counting the game on the table if it's over. */
function matchTally() {
  const d = S.draft, L = d.life, t = {};
  L.seats.forEach(k => { t[k] = 0; });
  ((d.match && d.match.games) || []).forEach(g => { if (t[g.winner] != null) t[g.winner]++; });
  const alive = lcAlive();
  if (L.over && alive.length === 1) t[alive[0]]++;
  return t;
}
const DESIG = {
  monarch: { cls: 'mon', icon: 'crown', take: 'Take the crown', make: 'Make monarch', holds: 'Monarch', tone: 'gold' },
  init: { cls: 'ini', icon: 'init', take: 'Take the initiative', make: 'Take the initiative', holds: 'Has the initiative', tone: 'violet' }
};
const RING_LEVELS = [
  "Your Ring-bearer is legendary and can't be blocked by creatures with greater power.",
  'Whenever your Ring-bearer attacks, draw a card, then discard a card.',
  "Whenever your Ring-bearer becomes blocked by a creature, that creature's controller sacrifices it at end of combat.",
  'Whenever your Ring-bearer deals combat damage to a player, each opponent loses 3 life.'
];
const WHO_TAG = { you: 'You get it', opp1: 'Goes to an opponent', opps: 'Each opponent', any: 'Any player', all: 'Every player' };
const EMB = { list: null, loading: null, err: '' };
const EMB_CACHE = 'smb_emblems_v1', EMB_DAYS = 14;

/** Every card from a Scryfall search, following its pages. */
async function sfAll(q) {
  let url = 'https://api.scryfall.com/cards/search?q=' + encodeURIComponent(q) + '&order=name', out = [];
  while (url) {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (r.status === 404) break; // no matches
    if (!r.ok) throw new Error('Scryfall answered ' + r.status);
    const j = await r.json();
    out = out.concat(j.data || []);
    url = j.has_more ? j.next_page : '';
    if (url) await new Promise(res => setTimeout(res, 120)); // stay polite with Scryfall
  }
  return out;
}
function cardText(c) { return c.card_faces ? c.card_faces.map(f => f.oracle_text || '').join('\n') : (c.oracle_text || ''); }
function wordsOf(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 2); }
function overlap(a, b) { const A = new Set(wordsOf(a)), B = wordsOf(b); return A.size && B.length ? B.filter(w => A.has(w)).length / B.length : 0; }
/** Reads who a card gives this emblem to: 'you', 'opp1' (target opponent), 'opps' (each opponent), 'any' or 'all'. Null if it can't tell. */
function emblemWho(srcText, embText) {
  const map = { 'you': 'you', 'target opponent': 'opp1', 'each opponent': 'opps', 'target player': 'any', 'that player': 'any', 'each player': 'all' };
  const re = /(you|target opponent|each opponent|target player|that player|each player)\s+gets?\s+an\s+emblem(?:\s+with\s+["\u201C]([^"\u201D]*)["\u201D])?/gi;
  let m, best = null, score = -1;
  while ((m = re.exec(String(srcText || '')))) {
    const sc = m[2] ? overlap(m[2], embText) : 0;
    if (sc > score) { score = sc; best = map[m[1].toLowerCase()]; }
  }
  return best;
}
/** Builds the emblem list once (Scryfall), with who each emblem goes to. Cached for two weeks. */
function loadEmblems() {
  if (EMB.list) return Promise.resolve(EMB.list);
  const c = store(EMB_CACHE);
  if (c && c.list && c.list.length && Date.now() - c.at < EMB_DAYS * 864e5) { EMB.list = c.list; return Promise.resolve(c.list); }
  if (!EMB.loading) EMB.loading = (async () => {
    const res = await Promise.all([sfAll('t:emblem include:extras'), sfAll('o:"an emblem" -t:emblem include:extras')]);
    const srcText = {};
    res[1].forEach(card => {
      const t = cardText(card);
      srcText[card.name.toLowerCase()] = t;
      (card.card_faces || []).forEach(f => { srcText[String(f.name).toLowerCase()] = t; });
    });
    const seen = {}, list = [];
    res[0].forEach(card => {
      (card.card_faces || [card]).forEach(f => {
        if (!/emblem/i.test(f.type_line || '')) return;
        const name = String(f.name || card.name).replace(/\s+Emblem$/i, '').trim();
        if (!name || /^the ring\b/i.test(name) || seen[name.toLowerCase()]) return;
        seen[name.toLowerCase()] = 1;
        const iu = f.image_uris || card.image_uris || {}, text = f.oracle_text || '';
        const sources = (card.all_parts || []).filter(p => !/emblem|token/i.test(p.type_line || '')).map(p => p.name);
        if (!sources.length && srcText[name.toLowerCase()] != null) sources.push(name);
        let who = null, from = sources[0] || '';
        sources.some(s => { const w = emblemWho(srcText[String(s).toLowerCase()], text); if (w) { who = w; from = s; } return !!w; });
        list.push({ name: name, text: text, art: iu.art_crop || iu.small || '', img: iu.normal || iu.large || '', from: from, who: who || 'any', known: !!who });
      });
    });
    list.sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) throw new Error('Scryfall returned no emblems');
    EMB.list = list;
    store(EMB_CACHE, { at: Date.now(), list: list });
    return list;
  })().catch(e => { EMB.loading = null; throw e; });
  return EMB.loading;
}
function emblemListHtml(k, q) {
  if (EMB.err) return '<p style="opacity:.8">Could not load emblems from Scryfall (' + esc(EMB.err) + ').</p><button class="lbtn" data-lc="emretry" data-k="' + k + '">Try again</button>';
  if (!EMB.list) return '<p style="opacity:.75">Loading emblems from Scryfall…</p>';
  const words = String(q || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  let hits = EMB.list.filter(e => { const hay = (e.name + ' ' + e.from + ' ' + e.text).toLowerCase(); return words.every(w => hay.indexOf(w) !== -1); });
  if (words.length) { const w0 = words[0]; hits = hits.filter(e => e.name.toLowerCase().indexOf(w0) === 0).concat(hits.filter(e => e.name.toLowerCase().indexOf(w0) !== 0)); }
  if (!hits.length) return '<p style="opacity:.75">No emblems match \u201C' + esc(q) + '\u201D.</p>';
  return '<ul class="emlist">' + hits.slice(0, 40).map(e => '<li><button data-lc="empick" data-k="' + k + '" data-val="' + esc(e.name) + '">' +
    '<span class="th" style="background-image:url(\'' + esc(e.art) + '\')"></span><span><b>' + esc(e.name) +
    '<span class="who">' + esc(e.known ? WHO_TAG[e.who] : 'Ask who gets it') + '</span></b><small>' + esc(e.text) + '</small></span></button></li>').join('') +
    (hits.length > 40 ? '' : '') + '</ul>' + (hits.length > 40 ? '<p style="opacity:.6;font-size:13px">Showing 40 of ' + hits.length + '. Keep typing to narrow it down.</p>' : '');
}
function lcNote(k, text) { const L = S.draft.life; L.hist.push({ t: Date.now(), k: k, ty: 'note', d: 0, v: 0, src: '', r: L.round, text: text }); }
function lcNudge(k, text, tone, always) {
  if (!always && S.settings.reminders === false) return;
  const now = Date.now(), list = (LC.nudge[k] || []).filter(n => now - n.t < 5000 && n.text !== text);
  list.push({ text: text, tone: tone || '', t: now });
  LC.nudge[k] = list.slice(-3);
}
function pname(k) { return lcInfo(k).name; }
function emAdd(to, e, by) {
  const P = S.draft.life.p[to];
  let m = P.emb.find(x => x.name === e.name);
  if (m) m.n++; else P.emb.push(m = { name: e.name, n: 1, art: e.art, img: e.img, text: e.text, from: e.from });
  lcNote(to, pname(to) + ' got the ' + e.name + ' emblem' + (m.n > 1 ? ' (\u00D7' + m.n + ')' : '') + (by && by !== to ? ' from ' + pname(by) : ''));
}
function emDone(k, e, to) {
  LC.panel = { k: k, mode: 'detail', msg: e.name + ' emblem added for ' + to.map(pname).join(', ') + '.' };
  H.touch(); lcRenderSheets(); lcUpdate();
}
/** Puts the emblem where its card says, or asks when the card leaves it up to the player. */
function emResolve(k, name) {
  const L = S.draft.life, e = (EMB.list || []).find(x => x.name === name);
  if (!e) return;
  const alive = L.seats.filter(x => !L.p[x].out), others = alive.filter(x => x !== k);
  let to = null;
  if (e.known && e.who === 'you') to = [k];
  else if (e.known && e.who === 'opps') to = others;
  else if (e.known && e.who === 'all') to = alive;
  else if (e.known && e.who === 'opp1' && others.length === 1) to = others;
  if (to && to.length) { to.forEach(x => emAdd(x, e, k)); return emDone(k, e, to); }
  LC.panel = { k: k, mode: 'emwho', em: name, opts: e.known && e.who === 'opp1' ? others : alive };
  lcRenderSheets();
}
function cmdTotal(k, x) { const c = S.draft.life.p[k].cmd; return (c[x + ':0'] || 0) + (c[x + ':1'] || 0); }
function lcSnap() { const L = S.draft.life; L.snap = {}; L.seats.forEach(k => { L.snap[k] = { life: L.p[k].life, poison: L.p[k].poison }; }); }
/** Moves the crown or the initiative. Taking the initiative always means venturing into the Undercity. */
function lcSetDesig(what, to, why) {
  const L = S.draft.life;
  if ((L[what] || null) === (to || null)) return;
  L[what] = to || null;
  if (!to) return;
  // only life lost after they took it counts toward someone stealing it this turn
  L.snap = L.snap || {}; L.snap[to] = { life: L.p[to].life, poison: L.p[to].poison };
  lcNote(to, pname(to) + (what === 'monarch' ? ' became the monarch' : ' took the initiative') + (why || ''));
  if (what === 'monarch') lcNudge(to, 'Now the monarch', 'gold', true);
  else lcNudge(to, S.settings.reminders === false ? 'Took the initiative' : 'Venture into the Undercity', 'violet', true);
}
function lcNextAlive(k) {
  const L = S.draft.life, s = L.seats, n = s.length, i = s.indexOf(k);
  for (let j = 1; j < n; j++) { const x = s[(i + j) % n]; if (!L.p[x].out) return x; }
  return null;
}
/** If the monarch or initiative holder leaves, the active player takes it (or the next player, if it was the holder's own turn). */
function lcDesigOnOut(k) {
  const L = S.draft.life;
  ['monarch', 'init'].forEach(what => {
    if (L[what] !== k) return;
    const to = L.active && L.active !== k && !L.p[L.active].out ? L.active : lcNextAlive(k);
    if (!to) return;
    L.lastMove = L.lastMove || {};
    L.lastMove[what] = { from: k, to: to, at: Date.now() };
    lcSetDesig(what, to, ' when ' + pname(k) + (isYou(k) ? ' were' : ' was') + ' knocked out');
  });
}
/** Undo an automatic move if someone was brought back right away (a mistaken tap below 0, say). */
function lcDesigOnRevive(k) {
  const L = S.draft.life, lm = L.lastMove || {};
  Object.keys(lm).forEach(what => {
    const m = lm[what];
    if (m.from === k && L[what] === m.to && Date.now() - m.at < 20000) { L[what] = k; LC.nudge[m.to] = []; }
    delete lm[what];
  });
}
/** Commander damage to the monarch or initiative holder: ask once the damage screen closes. */
function lcQueueCmd(k, x, before) {
  const L = S.draft.life;
  if (x === k) return;
  LC.pend = LC.pend || [];
  ['monarch', 'init'].forEach(what => {
    if (L[what] !== k || LC.pend.some(p => p.what === what && p.taker === x)) return;
    LC.pend.push({ what: what, from: k, taker: x, base: before });
  });
}
function lcNextPrompt() {
  const L = S.draft.life;
  while (LC.pend && LC.pend.length) {
    const t = LC.pend[0].taker, group = LC.pend.filter(p => p.taker === t);
    LC.pend = LC.pend.filter(p => p.taker !== t);
    const items = group.filter(p => L[p.what] === p.from && !L.p[t].out && cmdTotal(p.from, t) > p.base);
    if (items.length) { LC.prompt = { kind: 'cmd', taker: t, items: items }; lcRenderPrompt(); return true; }
  }
  return false;
}
/** Holders who lost life or got poison during someone else's turn, not already settled this turn. */
function lcStealCandidates() {
  const L = S.draft.life, a = L.active, snap = L.snap || {}, out = [];
  ['monarch', 'init'].forEach(what => {
    const h = L[what];
    if (!h || h === a || !L.p[h] || L.p[h].out || L.p[a].out) return;
    if ((L.handled || {})[what] === L.turnId) return;
    const s = snap[h];
    if (s && (L.p[h].life < s.life || L.p[h].poison > s.poison)) out.push({ what: what, from: h });
  });
  return out;
}
function poss(k) { return isYou(k) ? 'your' : pname(k) + "'s"; }
function joinNames(keys) { const n = keys.map(pname); return n.length < 2 ? n.join('') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1]; }
function lcPromptHtml() {
  const P = LC.prompt, L = S.draft.life, t = P.taker;
  const froms = P.items.map(i => i.from).filter((x, i, a) => a.indexOf(x) === i);
  const holds = P.items.map(i => (isYou(i.from) ? 'you ' + (i.what === 'monarch' ? 'are the monarch' : 'have the initiative') : pname(i.from) + (i.what === 'monarch' ? ' is the monarch' : ' has the initiative'))).join(', and ');
  let h = '<h4>' + (P.kind === 'cmd' ? 'Commander damage to ' + esc(joinNames(froms)) : esc(joinNames(froms)) + ' lost life on ' + esc(poss(t)) + ' turn') + '</h4>' +
    '<p>' + esc(holds.charAt(0).toUpperCase() + holds.slice(1)) + '. ' + (P.kind === 'cmd' ? '' : 'If it was combat damage from ' + (isYou(t) ? 'you' : esc(pname(t))) + ', it changes hands. ') +
    'Does ' + (isYou(t) ? 'that go to you' : 'that go to ' + esc(pname(t))) + '?</p><div class="pbtns">';
  P.items.forEach(i => { h += '<button class="' + DESIG[i.what].cls + '" data-lc="pans" data-val="' + i.what + '">' + ICON[DESIG[i.what].icon] + esc(DESIG[i.what].take) + '</button>'; });
  if (P.items.length > 1) h += '<button class="both" data-lc="pans" data-val="both">' + ICON.crown + ICON.init + 'Take both</button>';
  return h + '<button data-lc="pans" data-val="no">No</button></div>';
}
function lcRenderPrompt() {
  const el = document.getElementById('lcprompt');
  if (!el) return;
  if (!LC.prompt) { el.innerHTML = ''; return; }
  const rot = lcRot(LC.prompt.taker), side = Math.abs(rot) === 90, W = window.innerWidth, H = window.innerHeight;
  el.innerHTML = '<div class="promptwrap"><div class="sheetbg"></div><div class="sheetrot" style="width:' + (side ? H : W) + 'px;height:' + (side ? W : H) + 'px;transform:translate(-50%,-50%) rotate(' + rot + 'deg)">' +
    '<div class="sheetcard promptcard">' + lcPromptHtml() + '</div></div></div>';
}
function lcAnswer(v) {
  const P = LC.prompt, L = S.draft.life;
  if (!P) return;
  LC.prompt = null;
  L.handled = L.handled || {};
  P.items.forEach(i => { L.handled[i.what] = L.turnId; });
  const take = v === 'both' ? P.items.map(i => i.what) : v === 'no' ? [] : [v];
  take.forEach(w => lcSetDesig(w, P.taker, P.kind === 'cmd' ? ' with commander damage' : ' in combat'));
  H.touch(); lcRenderPrompt(); lcUpdate();
  if (P.kind === 'cmd') { if (!lcNextPrompt() && P.then === 'pass') lcPass(); }
  else lcPassNow();
}
function ringSub(n) { return n ? 'Tempted ' + n + (n === 1 ? ' time' : ' times') : 'Not tempted yet'; }
function embThumb(k, m, big) {
  return '<button class="emb" data-lc="emview" data-k="' + k + '" data-val="' + esc(m.name) + '" style="background-image:url(\'' + esc(m.art) + '\')" aria-label="' + esc(m.name) + ' emblem' + (m.n > 1 ? ', ' + m.n : '') + '">' +
    (m.n > 1 ? '<i>\u00D7' + m.n + '</i>' : '') + '</button>';
}
/** Radiation trefoil, drawn as three blades around a center dot. */
ICON.rad = (() => {
  const c = 12, r1 = 3.4, r2 = 10.5, pt = (r, a) => (c + r * Math.cos(a)).toFixed(2) + ' ' + (c + r * Math.sin(a)).toFixed(2);
  const blade = mid => { const a = mid - Math.PI / 6, b = mid + Math.PI / 6;
    return 'M' + pt(r1, a) + 'L' + pt(r2, a) + 'A' + r2 + ' ' + r2 + ' 0 0 1 ' + pt(r2, b) + 'L' + pt(r1, b) + 'A' + r1 + ' ' + r1 + ' 0 0 0 ' + pt(r1, a) + 'Z'; };
  const d = [-Math.PI / 2, Math.PI / 6, 5 * Math.PI / 6].map(blade).join('');
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="' + d + '"/><circle cx="12" cy="12" r="2.1" fill="currentColor"/></svg>';
})();
ICON.skull = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5c-4.4 0-7.7 3.1-7.7 7.3 0 2.4 1.1 4.2 2.7 5.3v2.4c0 .6.5 1 1 1h1.2v1.6h1.6v-1.6h2.4v1.6h1.6v-1.6H16c.6 0 1-.4 1-1v-2.4c1.6-1.1 2.7-2.9 2.7-5.3 0-4.2-3.3-7.3-7.7-7.3zm-3.3 9.9a1.9 1.9 0 1 1 0-3.8 1.9 1.9 0 0 1 0 3.8zm6.6 0a1.9 1.9 0 1 1 0-3.8 1.9 1.9 0 0 1 0 3.8zM12 13.2l1.1 2h-2.2z"/><path fill="currentColor" d="M3 19.4l1-1.5 17 3.6-1 1.5zM21 19.4l-1-1.5L3 21.5l1 1.5z" opacity=".85"/></svg>';
ICON.energy = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.6 1.8 4.8 13.4h6l-1.6 8.8 9.1-12h-6.1z"/></svg>';
// Experience: three stacked rank chevrons, like an insignia that grows as you level up
ICON.exp = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.6 20.5 8v3.2L12 5.8 3.5 11.2V8zM12 8.4l8.5 5.4V17L12 11.6 3.5 17v-3.2zM12 14.2l8.5 5.4v2.6L12 17.1 3.5 22.2v-2.6z"/></svg>';
const CTR_INFO = {
  energy: { cls: 'energy', name: 'Energy', text: 'Pay energy as a cost for abilities. It stays until you spend it.' },
  exp: { cls: 'exp', name: 'Experience', text: 'Some abilities count your experience counters. They never go away.' }
};
function ctrThumb(k, ty, n) { return '<button class="emb ' + CTR_INFO[ty].cls + '" data-lc="ctrview" data-k="' + k + '" data-val="' + ty + '" aria-label="' + n + ' ' + CTR_INFO[ty].name.toLowerCase() + '">' + ICON[ty] + '<i>' + n + '</i></button>'; }
function radThumb(k, n) { return '<button class="emb rad" data-lc="radview" data-k="' + k + '" aria-label="' + n + ' rad counters">' + ICON.rad + '<i>' + n + '</i></button>'; }
/* ----- big turn reminders: the monarch's draw, the initiative, rad counters ----- */
// Each one grows out of its marker or thumbnail to the middle of the screen, facing that player, pulses, then shrinks back.
// They play one at a time, in order: the monarch at the end of a turn, then the initiative (upkeep), then rads (first main phase).
const BIG_TIMING = {
  monarch: { grow: 450, hold: 1000, shrink: 550, beats: 1 },
  init: { grow: 600, hold: 1900, shrink: 700, beats: 2 },
  rad: { grow: 600, hold: 1900, shrink: 700, beats: 2 }
};
/* ----- coins and dice ----- */
const RNG = { mode: 'coin', coins: 1, dice: 2, sides: 6, result: null, busy: false };
const DIE_COLORS = [['#E04F5F', '#8E1E2B', '#fff'], ['#5B8DEF', '#23458F', '#fff'], ['#4CC38A', '#1F7A50', '#fff'], ['#B07CF0', '#5A2E99', '#fff'],
  ['#F2A34B', '#A9581A', '#fff'], ['#2EC4C4', '#127373', '#fff'], ['#F5D35B', '#B08A12', '#2a2006'], ['#F07FB4', '#A3326A', '#fff']];
const DIE_SHAPES = { 4: 'polygon(50% 4%,97% 92%,3% 92%)', 6: 'inset(0 round 16%)', 8: 'polygon(50% 0,100% 50%,50% 100%,0 50%)',
  10: 'polygon(50% 0,98% 42%,50% 100%,2% 42%)', 12: 'polygon(50% 0,98% 36%,80% 98%,20% 98%,2% 36%)', 20: 'polygon(25% 3%,75% 3%,100% 50%,75% 97%,25% 97%,0 50%)' };
function rngHtml() {
  const coin = RNG.mode === 'coin', n = coin ? RNG.coins : RNG.dice;
  const tabs = '<div class="rngtabs">' + [['coin', 'Coins'], ['dice', 'Dice'], ['attack', 'Attack']].map(t => '<button data-lc="rngmode" data-val="' + t[0] + '" class="' + (RNG.mode === t[0] ? 'on' : '') + '">' + t[1] + '</button>').join('') + '</div>';
  if (RNG.mode === 'attack') {
    const L = S.draft.life, a = L.first != null ? L.active : null, c = attackChoices();
    if (isCmd()) c.forEach(k => { const cm = lcInfo(k).c1; if (cm) { const im = new Image(); im.src = artUrl(cm); } }); // load the art before the roll
    return '<div class="top"><h2>Random attack</h2><button class="link" data-lc="menu">Back</button></div>' + tabs +
      '<p style="margin:0 0 4px;opacity:.85">' + (a ? 'Picks who ' + esc(lcInfo(a).name) + (plural(a) ? ' attack' : ' attacks') + ', from everyone still in the game except ' + (isYou(a) ? 'you' : esc(lcInfo(a).name)) + '.' : 'Picks a player still in the game.') + '</p>' +
      '<div class="rngstage cube" id="rngstage"></div><p class="rngres" id="rngres">' + (RNG.result || '') + '</p>' +
      (c.length ? '<button class="menuitem acc" data-lc="rnggo" style="text-align:center">Roll the attack die</button>' : '<p class="muted">Nobody else is left to attack.</p>');
  }
  let h = '<div class="top"><h2>' + (coin ? 'Flip coins' : 'Roll dice') + '</h2><button class="link" data-lc="menu">Back</button></div>' + tabs +
    '<div class="rngrow"><span>' + (coin ? 'How many coins' : 'How many dice') + '</span><button data-lc="rngn" data-val="-1" aria-label="Fewer">−</button><b>' + n + '</b><button data-lc="rngn" data-val="1" aria-label="More">+</button></div>';
  if (!coin) h += '<div class="rngrow ds"><span>Kind of dice</span><div class="dstyles">' + [4, 6, 8, 10, 12, 20].map(x => '<button data-lc="rngsides" data-val="' + x + '" class="' + (RNG.sides === x ? 'on' : '') + '">d' + x + '</button>').join('') + '</div></div>';
  h += '<div class="rngstage" id="rngstage"></div><p class="rngres" id="rngres">' + (RNG.result || '') + '</p>' +
    '<button class="menuitem acc" data-lc="rnggo" style="text-align:center">' + (coin ? (n === 1 ? 'Flip it' : 'Flip them') : (n === 1 ? 'Roll it' : 'Roll them')) + '</button>';
  return h;
}
/** Everyone still in the game except the player whose turn it is. */
function attackChoices() {
  const L = S.draft.life, a = L.first != null ? L.active : null;
  return L.seats.filter(k => k !== a && !L.p[k].out);
}
/** A big cube with each candidate's commander art and name on its faces. It tumbles in and lands on the chosen player. */
function rollAttack(stage, res) {
  const c = attackChoices();
  if (!c.length) { RNG.busy = false; return; }
  const pick = c[Math.floor(Math.random() * c.length)], W = stage.clientWidth, H = stage.clientHeight;
  const size = Math.round(Math.min(W * .62, H * .72, 230)), half = size / 2;
  // six faces: the chosen player on the face that ends up in front, the others shuffled around it (repeating if needed)
  const final = Math.floor(Math.random() * 6), faces = [], rest = c.slice().sort(() => Math.random() - .5);
  for (let f = 0, j = 0; f < 6; f++) faces.push(f === final ? pick : (c.length > 1 ? rest.filter(x => x !== pick).concat([pick])[j++ % c.length] : pick));
  const FACE_T = ['rotateY(0deg)', 'rotateY(180deg)', 'rotateY(90deg)', 'rotateY(-90deg)', 'rotateX(90deg)', 'rotateX(-90deg)'];
  const SHOW = [[0, 0], [0, 180], [0, -90], [0, 90], [-90, 0], [90, 0]]; // cube turn that brings each face to the front
  const faceHtml = k => {
    const i = lcInfo(k), bg = isCmd() && i.c1 ? 'url(\'' + artUrl(i.c1) + '\') center 30% / cover no-repeat, ' + manaGradient(i.colors, '135deg') : panelBg(k);
    return '<span class="cname">' + esc(i.name) + '</span>' + (isCmd() && i.c1 ? '<span class="ccmd">' + esc(shortCmd(i.c1)) + '</span>' : '') + '<i style="background:' + bg + '"></i>';
  };
  stage.innerHTML = '<div class="cubewrap" style="width:' + size + 'px;height:' + size + 'px;margin:' + (-half) + 'px 0 0 ' + (-half) + 'px"><div class="cube3d">' +
    faces.map((k, f) => '<div class="cface" style="transform:' + FACE_T[f] + ' translateZ(' + half + 'px)">' + faceHtml(k) + '</div>').join('') + '</div></div>';
  const wrap = stage.firstChild, cube = wrap.firstChild, reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tx = 3 + Math.floor(Math.random() * 2), ty = 3 + Math.floor(Math.random() * 2);
  const endX = SHOW[final][0] + 360 * tx, endY = SHOW[final][1] + 360 * ty;
  const done = () => {
    RNG.busy = false;
    const L = S.draft.life, a = L.first != null ? L.active : null;
    RNG.result = (a ? esc(lcInfo(a).name) + (plural(a) ? ' attack ' : ' attacks ') : 'Attack ') + '<b>' + esc(lcInfo(pick).name) + '</b>!';
    res.innerHTML = RNG.result;
    wrap.classList.add('landed');
  };
  if (reduce) { cube.style.transform = 'rotateX(' + SHOW[final][0] + 'deg) rotateY(' + SHOW[final][1] + 'deg)'; return done(); }
  wrap.animate([
    { transform: 'translate(' + (-W) + 'px,' + (-H * .25) + 'px) scale(.7)' },
    { transform: 'translate(' + (-W * .3) + 'px,' + (H * .12) + 'px) scale(.9)', offset: .4 },
    { transform: 'translate(' + (W * .08) + 'px,' + (-H * .06) + 'px) scale(1.04)', offset: .72 },
    { transform: 'translate(0,0) scale(1)' }
  ], { duration: 2200, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' });
  const a = cube.animate([
    { transform: 'rotateX(0deg) rotateY(0deg)' },
    { transform: 'rotateX(' + endX * .7 + 'deg) rotateY(' + endY * .6 + 'deg)', offset: .55 },
    { transform: 'rotateX(' + (endX + 8) + 'deg) rotateY(' + (endY - 6) + 'deg)', offset: .9 },
    { transform: 'rotateX(' + endX + 'deg) rotateY(' + endY + 'deg)' }
  ], { duration: 2200, easing: 'cubic-bezier(.25,.7,.25,1)', fill: 'both' });
  a.onfinish = done;
}
function rngGo() {
  if (RNG.busy) return;
  const stage = document.getElementById('rngstage'), res = document.getElementById('rngres');
  if (!stage) return;
  RNG.busy = true; res.textContent = '';
  if (RNG.mode === 'attack') return rollAttack(stage, res);
  const W = stage.clientWidth, H = stage.clientHeight, reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let done = 0;
  const finish = text => { RNG.busy = false; RNG.result = text; res.textContent = text; };
  if (RNG.mode === 'coin') {
    const n = RNG.coins, size = Math.min(96, (W - 16) / Math.min(n, 3) - 12), out = [];
    stage.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const heads = Math.random() < .5; out.push(heads);
      const c = document.createElement('div'); c.className = 'coin';
      const col = i % 3, row = Math.floor(i / 3), perRow = Math.min(n, 3);
      c.style.width = c.style.height = size + 'px';
      c.style.left = (W / 2 + (col - (perRow - 1) / 2) * (size + 14) - size / 2) + 'px';
      c.style.top = (H / 2 + (row - (Math.ceil(n / 3) - 1) / 2) * (size + 14) - size / 2) + 'px';
      c.innerHTML = '<div class="face h">H</div><div class="face t">T</div>';
      stage.appendChild(c);
      const turns = 5 + Math.floor(Math.random() * 3), end = turns * 360 + (heads ? 0 : 180), lift = -Math.min(110, H * .45);
      const a = reduce ? c.animate([{ opacity: .2 }, { opacity: 1 }], { duration: 400, fill: 'both' }) : c.animate([
        { transform: 'translateY(0) rotateX(0deg) scale(1)' },
        { transform: 'translateY(' + lift + 'px) rotateX(' + end * .5 + 'deg) scale(1.15)', offset: .45 },
        { transform: 'translateY(0) rotateX(' + end + 'deg) scale(1)', offset: .85 },
        { transform: 'translateY(-8px) rotateX(' + end + 'deg) scale(1)', offset: .92 },
        { transform: 'translateY(0) rotateX(' + end + 'deg) scale(1)' }
      ], { duration: 1500 + i * 120, easing: 'cubic-bezier(.25,.6,.35,1)', fill: 'both' });
      if (reduce) c.style.transform = 'rotateX(' + (heads ? 0 : 180) + 'deg)';
      a.onfinish = () => { if (++done === n) { const hc = out.filter(Boolean).length; finish(n === 1 ? (out[0] ? 'Heads' : 'Tails') : out.map(x => x ? 'Heads' : 'Tails').join(', ') + ' (' + hc + (hc === 1 ? ' head, ' : ' heads, ') + (n - hc) + (n - hc === 1 ? ' tail)' : ' tails)')); } };
    }
    return;
  }
  const n = RNG.dice, sides = RNG.sides, size = Math.min(76, W / Math.min(n, 4) - 16), vals = [];
  RNG.colorShift = Math.floor(Math.random() * DIE_COLORS.length); // a different mix of colors each roll
  stage.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const v = 1 + Math.floor(Math.random() * sides); vals.push(v);
    const d = document.createElement('div'); d.className = 'die d' + sides;
    d.style.width = d.style.height = size + 'px'; d.style.clipPath = DIE_SHAPES[sides];
    const hue = DIE_COLORS[(i + RNG.colorShift) % DIE_COLORS.length];
    d.style.background = 'linear-gradient(145deg,' + hue[0] + ',' + hue[1] + ')'; d.style.color = hue[2];
    const perRow = Math.min(n, 4), col = i % perRow, row = Math.floor(i / perRow), rows = Math.ceil(n / perRow);
    const x = W / 2 + (col - (perRow - 1) / 2) * (size + 14) - size / 2, y = H / 2 + (row - (rows - 1) / 2) * (size + 14) - size / 2;
    d.style.left = x + 'px'; d.style.top = y + 'px';
    d.innerHTML = '<b>' + v + '</b>';
    stage.appendChild(d);
    const b = d.firstChild;
    // rolls in from the left edge, tumbling, numbers flickering until it settles
    const fromX = -x - size - 30 - Math.random() * 60, fromY = (Math.random() - .5) * H * .6, spin = (2 + Math.floor(Math.random() * 3)) * 360 * (Math.random() < .5 ? -1 : 1);
    const dur = 1100 + Math.random() * 400 + i * 90;
    const a = reduce ? d.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, fill: 'both' }) : d.animate([
      { transform: 'translate(' + fromX + 'px,' + fromY + 'px) rotate(0deg)' },
      { transform: 'translate(' + fromX * .35 + 'px,' + (-fromY * .4) + 'px) rotate(' + spin * .6 + 'deg)', offset: .45 },
      { transform: 'translate(' + (8 - Math.random() * 16) + 'px,' + (fromY * .12) + 'px) rotate(' + spin * .92 + 'deg)', offset: .78 },
      { transform: 'translate(0,0) rotate(' + spin + 'deg)' }
    ], { duration: dur, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' });
    const flick = setInterval(() => { b.textContent = 1 + Math.floor(Math.random() * sides); }, 70);
    a.onfinish = () => {
      clearInterval(flick); b.textContent = v;
      if (++done === n) finish(n === 1 ? 'Rolled ' + vals[0] : vals.join(' + ') + ' = ' + vals.reduce((p, q) => p + q, 0));
    };
  }
}
/** Total time and turns each player (or team) has taken this game, counting the turn in progress. */
function lcTurnTimes() {
  const d = S.draft, L = d.life, out = {};
  L.seats.forEach(k => {
    const P = L.p[k], c = (d.timeCarry || {})[k] || { time: 0, turns: 0 };
    let time = c.time + (P.time || 0), turns = c.turns + (P.tturns || 0);
    if (k === L.active && L.first != null) {
      // the turn in progress (or the one the game ended on) counts too, unless it was only a few seconds
      const part = (L.over && L.overAt ? L.overAt : Date.now()) - L.turnAt;
      if (part >= 10000) { time += part; turns++; }
    }
    out[k] = { time: time, turns: turns };
  });
  return out;
}
function turnTimeLines() {
  const tt = lcTurnTimes(), rows = Object.keys(tt).filter(k => tt[k].turns).map(k => ({ k: k, avg: tt[k].time / tt[k].turns }));
  if (rows.length < 2) return '';
  rows.sort((a, b) => b.avg - a.avg);
  const nm = k => esc(lcInfo(k).name), f = r => mmss(r.avg);
  return '<p class="ttl">Longest turns: <b>' + nm(rows[0].k) + '</b>, ' + f(rows[0]) + ' on average<br>Shortest turns: <b>' + nm(rows[rows.length - 1].k) + '</b>, ' + f(rows[rows.length - 1]) + ' on average</p>';
}
function lcAnimClear() {
  LC.anims = []; clearTimeout(LC.animT);
  if (LC.curAnim) { try { LC.curAnim.a.cancel(); } catch (e) {} LC.curAnim = null; }
  const layer = document.getElementById('biglayer'); if (layer) layer.innerHTML = '';
}
function lcQueueAnim(it) { (LC.anims = LC.anims || []).push(it); lcRunAnims(); }
function lcRunAnims() {
  if (LC.curAnim || !LC.anims || !LC.anims.length) return;
  const it = LC.anims[0], wait = it.at - Date.now();
  if (wait > 0) { clearTimeout(LC.animT); LC.animT = setTimeout(lcRunAnims, wait); return; }
  LC.anims.shift();
  if (S.view !== 'playing' || !document.getElementById('lc') || (it.valid && !it.valid())) return lcRunAnims();
  lcPlayBig(it);
}
/** Queues the reminders for a turn change: prev just ended their turn, the active player is starting theirs. */
function lcTurnReminders(prev) {
  const L = S.draft.life, a = L.active, id = L.turnId, start = Date.now();
  lcAnimClear();
  if (S.settings.reminders === false) return;
  const live = () => { const L2 = S.draft && S.draft.life; return L2 === L && L2.turnId === id && L2.active === a && !L2.over; };
  if (prev && L.monarch === prev && !L.p[prev].out) lcQueueAnim({ k: prev, kind: 'monarch', at: start });
  if (L.init === a) lcQueueAnim({ k: a, kind: 'init', at: start + 2000, valid: () => live() && L.init === a });
  if (L.p[a].rad) lcQueueAnim({ k: a, kind: 'rad', at: start + 2000, valid: () => live() && L.p[a].rad > 0 });
}
function lcPlayBig(it) {
  const L = S.draft.life, k = it.k, lc = document.getElementById('lc'), panel = document.querySelector('.lp[data-k="' + k + '"]');
  if (!lc || !panel) return lcRunAnims();
  let layer = document.getElementById('biglayer');
  if (!layer) { layer = document.createElement('div'); layer.id = 'biglayer'; document.body.appendChild(layer); }
  const W = window.innerWidth, H = window.innerHeight, rot = lcRot(k);
  const size = Math.round(Math.min(W, H) * .8);
  layer.style.left = W / 2 + 'px'; layer.style.top = H / 2 + 'px';
  layer.style.transform = 'rotate(' + rot + 'deg)';
  let body = '';
  // Address the player by name ("Joey, mill 3"), or plainly when it's you and no name is set
  const who = isYou(k) ? '' : esc(lcInfo(k).name), lead = (t, cap) => who ? who + ', ' + t : cap;
  if (it.kind === 'rad') { const n = L.p[k].rad; body = ICON.rad + '<b>' + n + '</b><span>' + lead('mill ' + n, 'Mill ' + n) + '</span><small>Rad counters</small>'; }
  else if (it.kind === 'init') body = ICON.init + '<span>' + lead('venture into the Undercity', 'Venture into the Undercity') + '</span>';
  else body = ICON.crown + '<span>' + lead('you\u2019re the monarch.', 'You\u2019re the monarch.') + '</span><span class="sub">Draw a card.</span>';
  layer.innerHTML = '<div class="bigrem ' + it.kind + '" style="width:' + size + 'px;height:' + size + 'px;margin:' + (-size / 2) + 'px 0 0 ' + (-size / 2) + 'px;--bs:' + size + 'px">' + body + '</div>';
  const el = layer.firstElementChild;
  // where it starts and ends: the thumbnail or marker it belongs to, measured on screen and turned into the layer's frame
  const src = panel.querySelector(it.kind === 'rad' ? '.emb.rad' : it.kind === 'init' ? '.lmark.ini' : '.lmark.mon') || panel;
  const sr = src.getBoundingClientRect(), dx = sr.left + sr.width / 2 - W / 2, dy = sr.top + sr.height / 2 - H / 2;
  const t = rot * Math.PI / 180, rx = Math.round(Math.cos(t) * dx + Math.sin(t) * dy), ry = Math.round(-Math.sin(t) * dx + Math.cos(t) * dy);
  const s0 = Math.max(.06, Math.min(.3, Math.max(sr.width, sr.height) / size));
  const T = BIG_TIMING[it.kind], total = T.grow + T.hold + T.shrink, at = ms => ms / total;
  const away = 'translate(' + rx + 'px,' + ry + 'px) scale(' + s0 + ')', home = 'translate(0,0) scale(1)';
  let frames;
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    frames = [{ opacity: 0, transform: home, offset: 0 }, { opacity: 1, offset: at(T.grow) }, { opacity: 1, offset: at(T.grow + T.hold) }, { opacity: 0, transform: home, offset: 1 }];
  } else {
    frames = [{ opacity: 0, transform: away, offset: 0, easing: 'cubic-bezier(.2,.8,.3,1)' }, { opacity: 1, transform: 'translate(0,0) scale(1.06)', offset: at(T.grow) }];
    const beat = T.hold / T.beats;
    for (let b = 0; b < T.beats; b++) {
      const o = T.grow + b * beat;
      frames.push({ transform: home, offset: at(o + beat * .35) }, { transform: 'translate(0,0) scale(1.05)', offset: at(o + beat * .7) });
    }
    frames.push({ opacity: 1, transform: home, offset: at(T.grow + T.hold), easing: 'cubic-bezier(.5,0,.8,.4)' }, { opacity: 0, transform: away, offset: 1 });
  }
  const a = el.animate(frames, { duration: total, fill: 'both' });
  LC.curAnim = { it: it, a: a };
  a.onfinish = () => { if (LC.curAnim && LC.curAnim.a === a) { LC.curAnim = null; layer.innerHTML = ''; lcRunAnims(); } };
}
function ringThumb(k, n) { return '<button class="emb ring" data-lc="ringview" data-k="' + k + '" aria-label="The Ring, tempted ' + n + ' times">' + ICON.ring + '<i>' + n + '</i></button>'; }

/* ----- drawing ----- */
function lcHtml() {
  const L = lcEnsure(), lay = lcLayout(L.n);
  const panels = L.seats.map((k, idx) => {
    const pos = lay.pos[idx], info = lcInfo(k);
    const cmd = isCmd();
    const imgs = cmd ? [info.c1, info.c2].filter(Boolean).map(c => '<span class="artimg" style="background-image:url(\'' + artUrl(c) + '\')"></span>').join('') : '';
    return '<div class="lp' + (cmd ? '' : ' plain') + '" data-k="' + k + '" style="grid-area:' + pos + ';background:' + (cmd ? manaGradient(info.colors, '135deg') : panelBg(k)) + '">' +
      '<div class="lpi" data-rot="' + LC_ROT[pos] + '"><div class="art">' + imgs + '</div><div class="shade"></div><div class="lglow"></div>' +
      '<div class="zone minus" data-hold="' + k + '|life|-1"></div><div class="zone plus" data-hold="' + k + '|life|1"></div>' +
      '<span class="sign m">−</span><span class="sign p">+</span>' +
      '<div class="lmarks" data-marks="' + k + '"></div><div class="lname">' + esc(info.name) + '</div>' +
      '<div class="lifev"><b data-life="' + k + '"></b><span class="delta" data-delta="' + k + '"></span></div>' +
      '<div class="lbadges" data-badges="' + k + '"></div>' +
      '<div class="nudge" data-nudge="' + k + '"></div>' +
      '<div class="outtag"><b data-outline="' + k + '"></b><span data-outwhy="' + k + '"></span></div>' +
      '<div class="miniwrap' + (Math.abs(LC_ROT[pos]) === 90 ? ' side' : '') + '"><button class="minimap" data-lc="panel" data-k="' + k + '" aria-label="Commander damage and counters for ' + esc(info.name) + '" ' +
      (cmd ? 'style="grid-template-areas:' + lay.areas + ';grid-template-rows:' + lay.rows + ';grid-template-columns:' + lay.cols + ';transform:translate(-50%,-50%) rotate(' + (-LC_ROT[pos]) + 'deg)" data-mini="' + k + '"></button></div>'
        : 'style="transform:translate(-50%,-50%)" data-nomini="1"><span class="mmicon" aria-hidden="true">' + ICON.more + '</span></button></div>') +
      '</div></div>';
  }).join('');
  return '<div class="lc" id="lc" style="grid-template-areas:' + lay.areas + ';grid-template-rows:' + lay.rows + ';grid-template-columns:' + lay.cols + '">' +
    panels + '<div class="hub" id="hub"></div><div id="lcsheet"></div><div id="lcprompt"></div></div><div id="lcov"></div>';
}
function lcSize() {
  // Park the center hub in the gap above your panel so it never covers anyone's life total
  const mine = document.querySelector('.lp[data-k="me"]'), hub = document.getElementById('hub');
  lcPlaceHub();
  document.querySelectorAll('.lp').forEach(p => {
    const r = p.getBoundingClientRect(), i = p.firstElementChild, rot = +i.dataset.rot, side = Math.abs(rot) === 90;
    i.style.width = (side ? r.height : r.width) + 'px';
    i.style.height = (side ? r.width : r.height) + 'px';
    i.style.transform = 'translate(-50%,-50%) rotate(' + rot + 'deg)';
    const lw = side ? r.height : r.width, lh = side ? r.width : r.height;
    // Every panel keeps the same band free at the top for the round counter, whether or not it's that player's turn,
    // so the life total sits in the same spot no matter where the counter is.
    const band = Math.round(Math.max(36, Math.min(54, lh * 0.18)));
    // and room at the bottom for the commander damage map (or the counters button outside Commander)
    const foot = isCmd() ? (side ? 72 : 108) : 64;
    i.style.setProperty('--hb', band + 'px'); i.style.setProperty('--bb', foot + 'px');
    const room = lh - band - 6 - foot;
    i.style.setProperty('--lf', Math.round(Math.max(40, Math.min(room / 0.78, lw * 0.32, 150))) + 'px'); // digits stand about .75 of the font size
    i.dataset.band = band;
    i.classList.toggle('tight', lw < 320); // markers go icon-only when there's no room for their labels
    i.dataset.lw = Math.round(lw);
  });
  lcPlaceHub();
}
/** Puts the round counter, menu and Pass turn in the band at the top of the active player's panel, facing them, shrunk to fit. */
function lcPlaceHub() {
  const hub = document.getElementById('hub'), L = S.draft && S.draft.life;
  if (!hub || !L) return;
  const k = LC.spinning || L.first == null || L.over ? null : L.active;
  const panel = k && document.querySelector('.lp[data-k="' + k + '"]');
  hub.classList.remove('stack');
  const hw = hub.offsetWidth, hh = hub.offsetHeight;
  if (!panel) {
    const sc = Math.min(1, (window.innerWidth - 16) / hw);
    hub.style.left = '50%'; hub.style.top = '50%'; hub.style.transform = 'translate(-50%,-50%) scale(' + sc + ')';
    return;
  }
  const r = panel.getBoundingClientRect(), rot = lcRot(k), side = Math.abs(rot) === 90;
  const lpi = panel.firstElementChild, band = +lpi.dataset.band || 44;
  const localW = side ? r.height : r.width, localH = side ? r.width : r.height;
  const sc = Math.min(1, band / hh, (localW - 14) / hw);
  // the band's center, in the panel's own (unrotated) coordinates, then turned to match the panel on screen
  const dy = -localH / 2 + 4 + band / 2, t = rot * Math.PI / 180;
  const x = r.left + r.width / 2 - dy * Math.sin(t), y = r.top + r.height / 2 + dy * Math.cos(t);
  hub.style.left = x + 'px'; hub.style.top = y + 'px';
  hub.style.transform = 'translate(-50%,-50%) rotate(' + rot + 'deg) scale(' + sc.toFixed(3) + ')';
}
function lcUpdate() {
  if (S.view !== 'playing' || !document.getElementById('lc')) return;
  const L = S.draft.life, now = Date.now();
  L.seats.forEach(k => {
    const P = L.p[k];
    const panel = document.querySelector('.lp[data-k="' + k + '"]');
    if (!panel) return;
    panel.classList.toggle('active', L.active === k && !L.over);
    panel.classList.toggle('out', !!P.out);
    panel.classList.toggle('hl', LC.hl === k);
    panel.classList.toggle('swapsel', LC.swap === k);
    panel.querySelector('[data-life]').textContent = LC.show && LC.show[k] != null ? LC.show[k] : P.life;
    const b = LC.bubble[k];
    panel.querySelector('[data-delta]').textContent = b && now - b.t < 1800 ? (b.d > 0 ? '+' + b.d : String(b.d)) : '';
    let badges = '';
    if (P.poison) badges += '<span class="pz">' + ICON.skull + P.poison + '</span>';
    const thumbs = [];
    if (P.rad) thumbs.push(radThumb(k, P.rad));
    if (P.energy) thumbs.push(ctrThumb(k, 'energy', P.energy));
    if (P.exp) thumbs.push(ctrThumb(k, 'exp', P.exp));
    if (P.ring) thumbs.push(ringThumb(k, P.ring));
    (P.emb || []).forEach(m => thumbs.push(embThumb(k, m)));
    // as many thumbnails as fit in two rows beside the commander damage map, the last becoming "+N"
    const perRow = Math.max(1, Math.floor(((+panel.firstElementChild.dataset.lw || 300) / 2 - 50) / 42));
    const cap = Math.max(1, perRow * 2 - (P.poison ? 1 : 0));
    badges += thumbs.length > cap ? thumbs.slice(0, cap - 1).join('') + '<button class="emb more" data-lc="panel" data-k="' + k + '" aria-label="More emblems">+' + (thumbs.length - cap + 1) + '</button>' : thumbs.join('');
    const bEl = panel.querySelector('[data-badges]');
    if (bEl.dataset.h !== badges) { bEl.innerHTML = badges; bEl.dataset.h = badges; } // only redraw on change so taps aren't lost
    panel.classList.toggle('monarch', L.monarch === k);
    panel.classList.toggle('init', L.init === k);
    const marks = ['monarch', 'init'].filter(w => L[w] === k).map(w => '<span class="lmark ' + DESIG[w].cls + '">' + ICON[DESIG[w].icon] + '<b>' + (w === 'monarch' ? 'Monarch' : 'Initiative') + '</b></span>').join('');
    const mEl = panel.querySelector('[data-marks]');
    if (mEl.dataset.h !== marks) { mEl.innerHTML = marks; mEl.dataset.h = marks; }
    const nEl = panel.querySelector('[data-nudge]'), live = (LC.nudge[k] || []).filter(n => now - n.t < 5000);
    const nh = live.map(n => '<span class="' + n.tone + '">' + (n.tone === 'gold' ? ICON.crown : n.tone === 'violet' ? ICON.init : '') + esc(n.text) + '</span>').join('');
    if (nh && nEl.dataset.h !== nh) { nEl.innerHTML = nh; nEl.dataset.h = nh; }
    nEl.classList.toggle('show', !!live.length);
    const mini = panel.querySelector('[data-mini]');
    if (mini) {
      const lay = lcLayout(L.n), myRot = lcRot(k);
      mini.innerHTML = L.seats.map((x, idx) => {
        const vals = [P.cmd[x + ':0'] || 0, P.cmd[x + ':1'] || 0], two = !!lcInfo(x).c2;
        const top = Math.max(vals[0], vals[1]);
        return '<span class="mc' + (x === k ? ' self' : '') + (top >= 21 ? ' lethal' : top >= 15 ? ' warn' : '') + '" style="grid-area:' + lay.pos[idx] + '">' +
          '<em style="transform:rotate(' + myRot + 'deg)">' + (two ? vals[0] + '/' + vals[1] : vals[0]) + '</em></span>';
      }).join('');
    }
    if (P.out) {
      panel.querySelector('[data-outline]').textContent = lcLineText(k);
      panel.querySelector('[data-outwhy]').textContent = 'Out' + (P.out.how ? ': ' + P.out.how : '') + (P.out.by && P.out.by !== k ? ', by ' + lcInfo(P.out.by).name : '');
    }
    panel.classList.toggle('justdied', !!(P.out && P.out.at && now - P.out.at < 1800));
  });
  document.querySelectorAll('[data-v]').forEach(el => { const p = el.dataset.v.split('|'); el.textContent = lcValue(p[0], p[1], p[2]); });
  const hub = document.getElementById('hub');
  if (hub) {
    const want = L.first == null ? 'pick' : 'play';
    if (hub.dataset.mode !== want) {
      hub.dataset.mode = want;
      hub.innerHTML = want === 'pick'
        ? '<button class="menu" data-lc="menu" aria-label="Menu">≡</button><button class="pass" data-lc="pick">Pick first player</button>'
        : '<div class="rnd"><b data-rnd></b><small data-tt></small></div><button class="menu" data-lc="menu" aria-label="Menu">≡</button><button class="pass" data-lc="pass">Pass turn</button>';
      lcPlaceHub(); // its width changed
    }
    if (want === 'play') {
      hub.querySelector('[data-rnd]').textContent = 'Round ' + L.round;
      const gn = S.draft.bo3 && L.seats.length === 2 ? 'Game ' + (((S.draft.match && S.draft.match.games.length) || 0) + 1) + ', turn ' : 'Turn ';
      hub.querySelector('[data-tt]').textContent = gn + mmss(now - L.turnAt);
    }
    const at = String(LC.spinning ? '' : L.active);
    if (hub.dataset.at !== at) { hub.dataset.at = at; lcPlaceHub(); }
  }
}
function lcSheetHtml(k) {
  const L = S.draft.life, P = L.p[k], info = lcInfo(k), mode = LC.panel && LC.panel.k === k ? LC.panel.mode : null;
  if (!mode) return '';
  const CI = { poison: ['skull', 'pz'], rad: ['rad', 'rd'], ring: ['ring', 'rg'], energy: ['energy', 'en'], exp: ['exp', 'xp'] };
  const ctr = (label, sub, ty, src) => '<div class="ctr"><span class="lbl">' + esc(label) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
    (CI[ty] ? '<span class="cico ' + CI[ty][1] + '">' + ICON[CI[ty][0]] + '</span>' : '') +
    '<button data-hold="' + k + '|' + ty + '|-1|' + (src || '') + '">−</button><b data-v="' + k + '|' + ty + '|' + (src || '') + '">' + lcValue(k, ty, src) + '</b>' +
    '<button data-hold="' + k + '|' + ty + '|1|' + (src || '') + '">+</button></div>';
  if (mode === 'out') {
    const others = L.seats.filter(x => x !== k);
    return '<h4>' + esc(info.name) + (plural(k) ? ' are' : ' is') + ' out</h4>' +
      '<span class="label" style="color:#ccc">Knocked out by</span><div class="lchips">' +
      others.map(x => '<button data-lc="outby" data-k="' + k + '" data-val="' + x + '" class="' + (P.out.by === x ? 'on' : '') + '">' + esc(lcInfo(x).name) + '</button>').join('') +
      '<button data-lc="outby" data-k="' + k + '" data-val="' + k + '" class="' + (P.out.by === k ? 'on' : '') + '">' + (k === 'me' ? 'Myself' : 'Themselves') + '</button></div>' +
      '<span class="label" style="color:#ccc">How</span><div class="lchips">' +
      LC_HOW.map(h => '<button data-lc="outhow" data-k="' + k + '" data-val="' + esc(h) + '" class="' + (P.out.how === h ? 'on' : '') + '">' + esc(h) + '</button>').join('') + '</div>' +
      '<button class="lbtn acc" data-lc="closesheet">Done</button><button class="lbtn" data-lc="revive" data-k="' + k + '">Not out</button>';
  }
  const back = '<button class="lbtn" data-lc="emback" data-k="' + k + '">Back</button>';
  if (mode === 'emsearch') {
    return '<h4>Add an emblem</h4><p style="margin:0 0 10px;opacity:.8">For emblems ' + esc(isYou(k) ? 'you make' : info.name + ' makes') + '. The app works out who gets it.</p>' +
      '<input type="search" data-emq="1" placeholder="Search emblems" value="' + esc(LC.panel.q || '') + '" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search">' +
      '<div id="emres">' + emblemListHtml(k, LC.panel.q) + '</div><div style="margin-top:10px">' + back + '</div>';
  }
  if (mode === 'emwho') {
    const e = (EMB.list || []).find(x => x.name === LC.panel.em) || { name: LC.panel.em };
    return '<h4>Who gets it?</h4><p style="margin:0 0 4px;opacity:.85">' + esc(e.name) + ' emblem' + (e.from ? ', from ' + esc(e.from) : '') + '</p>' +
      '<div class="lchips">' + LC.panel.opts.map(x => '<button data-lc="emto" data-k="' + k + '" data-val="' + x + '">' + esc(pname(x)) + '</button>').join('') + '</div>' + back;
  }
  if (mode === 'emview') {
    const m = P.emb.find(x => x.name === LC.panel.em);
    if (!m) return '';
    return '<div class="emview"><h4>' + esc(m.name) + ' emblem</h4>' +
      (m.img ? '<img src="' + esc(m.img) + '" alt="' + esc(m.text) + '">' : '<p class="emtext">' + esc(m.text) + '</p>') +
      (m.from ? '<p style="margin:0 0 6px;opacity:.7;text-align:center">From ' + esc(m.from) + '</p>' : '') +
      '<div class="qty"><button data-lc="emqty" data-k="' + k + '" data-val="-1" aria-label="Remove one">−</button><b>' + m.n + '</b><button data-lc="emqty" data-k="' + k + '" data-val="1" aria-label="Add one">+</button></div>' +
      '<button class="lbtn acc" data-lc="emback" data-k="' + k + '">Done</button></div>';
  }
  if (mode === 'ctrview') {
    const t = LC.panel.em, ci = CTR_INFO[t];
    return '<h4>' + esc(ci.name) + '</h4><p style="margin:0 0 10px;opacity:.85">' + esc(ci.text) + '</p>' +
      '<div class="ctrs">' + ctr(ci.name, 'Counters', t) + '</div><div style="margin-top:12px"><button class="lbtn acc" data-lc="emback" data-k="' + k + '">Done</button></div>';
  }
  if (mode === 'radview') {
    return '<h4>Rad counters</h4><p style="margin:0 0 10px;opacity:.85">At the beginning of ' + esc(isYou(k) ? 'your' : info.name + "'s") + ' first main phase, mill that many cards. For each nonland card milled, lose 1 life and remove a rad counter.</p>' +
      '<div class="ctrs">' + ctr('Rad', 'Counters', 'rad') + '</div><div style="margin-top:12px"><button class="lbtn acc" data-lc="emback" data-k="' + k + '">Done</button></div>';
  }
  if (mode === 'ringview') {
    const n = P.ring || 0;
    return '<h4>The Ring</h4><p style="margin:0;opacity:.85">' + esc(info.name) + ': ' + ringSub(n).toLowerCase() + '. Each time the Ring tempts you, choose a creature as your Ring-bearer.</p>' +
      '<ol class="ringlv">' + RING_LEVELS.map((t, i) => '<li class="' + (n > i ? 'on' : '') + '"><b>' + (i + 1) + '</b><span>' + esc(t) + '</span></li>').join('') + '</ol>' +
      '<div class="ctrs">' + ctr('The Ring', 'Times tempted', 'ring') + '</div><div style="margin-top:12px"><button class="lbtn acc" data-lc="emback" data-k="' + k + '">Done</button></div>';
  }
  const lay = lcLayout(L.n), view = rotLayout(lay, lcRot(k));
  let h = '<h4>' + esc(info.name) + '</h4>';
  if (isCmd()) h += '<span class="label" style="color:#ccc">Commander damage taken (also lowers life)</span>' +
    '<div class="cmdtable" style="grid-template-areas:' + view.areas + ';grid-template-rows:' + view.rows + ';grid-template-columns:' + view.cols + '">' +
    L.seats.map((x, idx) => cmdCellHtml(k, x, lay.pos[idx])).join('') + '</div>' +
    '<p class="cmdhint">Tap a player to add 1. Hold to open − / + and fix mistakes.</p>';
  h += '<span class="label" style="color:#ccc;margin-top:12px">Counters</span><div class="ctrs">' + ctr('Poison', poisonMax() + ' is lethal', 'poison') + ctr('Rad', '', 'rad') + ctr('Energy', '', 'energy') + ctr('Experience', '', 'exp') + ctr('The Ring', 'Times tempted', 'ring') + '</div>';
  if (isCmd() && (info.c1 || info.c2)) {
    h += '<span class="label" style="color:#ccc;margin-top:12px">Commander tax</span><p class="cmdhint" style="margin:0 0 4px">Times cast from the command zone. Each cast after the first costs 2 more.</p><div class="ctrs">' +
      [info.c1, info.c2].map((c, i) => c ? ctr(shortCmd(c), 'Tax +' + 2 * ((P.tax || {})[i] || 0), 'tax', String(i)) : '').join('') + '</div>';
  }
  h += '<span class="label" style="color:#ccc;margin-top:12px">Monarch and initiative</span><div class="desig">' + ['monarch', 'init'].map(w => {
    const on = L[w] === k;
    return '<button class="' + DESIG[w].cls + (on ? ' on' : '') + '" data-lc="desig" data-k="' + k + '" data-val="' + w + '">' + ICON[DESIG[w].icon] +
      '<span>' + esc(on ? DESIG[w].holds : DESIG[w].make) + (on ? '<small>Tap to clear</small>' : '') + '</span></button>';
  }).join('') + '</div>';
  h += '<span class="label" style="color:#ccc;margin-top:12px">Emblems</span><div class="emrow">' + (P.rad ? radThumb(k, P.rad) : '') + (P.energy ? ctrThumb(k, 'energy', P.energy) : '') + (P.exp ? ctrThumb(k, 'exp', P.exp) : '') + (P.ring ? ringThumb(k, P.ring) : '') + P.emb.map(m => embThumb(k, m)).join('') +
    '<button class="emadd" data-lc="emadd" data-k="' + k + '">+ Emblem</button></div>' + (LC.panel.msg ? '<p class="emmsg">' + esc(LC.panel.msg) + '</p>' : '');
  if (!isCmd()) {
    const cur = panelColor(k)[0];
    h += '<span class="label" style="color:#ccc;margin-top:12px">Panel color</span><div class="pcolors">' + PANEL_COLORS.map(c =>
      '<button data-lc="pcolor" data-k="' + k + '" data-val="' + c[0] + '" class="' + (c[0] === cur ? 'on' : '') + '" style="background:' + c[1] + '" aria-label="' + c[0] + '" aria-pressed="' + (c[0] === cur) + '"></button>').join('') + '</div>';
  }
  h += '<div style="margin-top:12px"><button class="lbtn acc" data-lc="closesheet">Done</button>' +
    (P.out ? '<button class="lbtn" data-lc="revive" data-k="' + k + '">Bring back in</button>' : '<button class="lbtn" data-lc="markout" data-k="' + k + '">Mark as out</button>') + '</div>';
  return h;
}
/** Rotates a layout grid so it matches the table as seen from a player's seat. */
function parseAreas(a) { return a.match(/'[^']*'/g).map(r => r.slice(1, -1).trim().split(/\s+/)); }
function rotLayout(lay, rot) {
  let M = parseAreas(lay.areas), rows = lay.rows.split(/\s+/), cols = lay.cols.split(/\s+/);
  const H = M.length, W = M[0].length;
  if (rot === 180) { M = M.slice().reverse().map(r => r.slice().reverse()); rows = rows.slice().reverse(); cols = cols.slice().reverse(); }
  else if (rot === 90 || rot === -90) {
    const N = [];
    for (let i = 0; i < W; i++) { N.push([]); for (let j = 0; j < H; j++) N[i].push(rot === 90 ? M[j][W - 1 - i] : M[H - 1 - j][i]); }
    const nr = rot === 90 ? cols.slice().reverse() : cols.slice(), nc = rot === 90 ? rows.slice() : rows.slice().reverse();
    M = N; rows = nr; cols = nc;
  }
  return { areas: M.map(r => "'" + r.join(' ') + "'").join(' '), rows: rows.join(' '), cols: cols.join(' ') };
}
function cmdCellHtml(k, x, area) {
  const o = lcInfo(x), self = x === k, two = !!o.c2, edit = LC.cmdEdit === x;
  const vals = (two ? [0, 1] : [0]).map(ci => ({ ci: ci, v: lcValue(k, 'cmd', x + ':' + ci), name: ci ? o.c2 : o.c1 }));
  const top = Math.max.apply(null, vals.map(a => a.v));
  const label = self ? (isYou(k) ? 'You' : o.name) + ' (own)' : o.name;
  let inner;
  if (edit) {
    inner = '<div class="ce">' + vals.map(a => '<div class="ce-row">' + (two ? '<small>' + esc(shortCmd(a.name)) + '</small>' : '') +
      '<button data-hold="' + k + '|cmd|-1|' + x + ':' + a.ci + '" aria-label="Remove 1">−</button><b data-v="' + k + '|cmd|' + x + ':' + a.ci + '">' + a.v + '</b>' +
      '<button data-hold="' + k + '|cmd|1|' + x + ':' + a.ci + '" aria-label="Add 1">+</button></div>').join('') +
      '<button class="ce-done" data-lc="cmddone">Done</button></div>';
  } else {
    inner = '<div class="ch">' + vals.map(a => '<div class="ch-half" data-cmdcell="' + k + '|' + x + '|' + a.ci + '"' + (a.name ? ' style="--art:url(\'' + artUrl(a.name) + '\')"' : '') + '><b data-v="' + k + '|cmd|' + x + ':' + a.ci + '">' + a.v + '</b>' +
      (two ? '<small>' + esc(shortCmd(a.name)) + '</small>' : '') + '</div>').join('') + '</div>';
  }
  return '<div class="cc' + (self ? ' self' : '') + (top >= 21 ? ' lethal' : top >= 15 ? ' warn' : '') + (edit ? ' editing' : '') + '" style="grid-area:' + area + ';--mc:' + manaGradient(o.colors, '90deg') + '">' +
    '<span class="cc-name">' + esc(label) + '</span>' + inner + '</div>';
}
/* tap a player = +1 commander damage; hold = open − / + */
let cmdPress = null;
document.addEventListener('pointerdown', e => {
  const el = e.target.closest && e.target.closest('[data-cmdcell]');
  if (!el) return;
  e.preventDefault();
  const p = el.dataset.cmdcell.split('|');
  const press = cmdPress = { k: p[0], x: p[1], ci: p[2], fired: false };
  press.t = setTimeout(() => { if (cmdPress !== press) return; press.fired = true; LC.cmdEdit = press.x; lcRenderSheets(); }, 450);
});
document.addEventListener('pointerup', () => {
  if (!cmdPress) return;
  const p = cmdPress; cmdPress = null; clearTimeout(p.t);
  if (!p.fired) { LC.cmdEdit = null; lcApply(p.k, 'cmd', 1, p.x + ':' + p.ci); }
});
document.addEventListener('pointercancel', () => { if (cmdPress) { clearTimeout(cmdPress.t); cmdPress = null; } });

function lcRenderSheets() {
  const el = document.getElementById('lcsheet');
  if (!el) return;
  if (LC.show) setTimeout(lcCountdowns, 0); // a damage screen just closed
  const k = LC.panel && LC.panel.k;
  const html = k ? lcSheetHtml(k) : '';
  if (!html) { el.innerHTML = ''; el.dataset.view = ''; LC.scrollAt = {}; return; }
  const rot = lcRot(k), side = Math.abs(rot) === 90, W = window.innerWidth, H = window.innerHeight;
  // Redrawing the same screen (a tax tap, an emblem, the monarch button) keeps you scrolled where you were
  const view = k + '|' + LC.panel.mode, old = el.querySelector('.sheetcard'), was = el.dataset.view || '';
  LC.scrollAt = LC.scrollAt || {};
  if (old && was) LC.scrollAt[was] = old.scrollTop; // so coming back from an emblem screen returns you to the same spot
  const keep = old && was === view ? old.scrollTop : (was.split('|')[0] === k && LC.scrollAt[view]) || 0;
  el.dataset.view = view;
  el.innerHTML = '<div class="sheetwrap"><div class="sheetbg" data-lc="closesheet"></div>' +
    '<div class="sheetrot" style="width:' + (side ? H : W) + 'px;height:' + (side ? W : H) + 'px;transform:translate(-50%,-50%) rotate(' + rot + 'deg)">' +
    '<div class="sheetcard"><button class="sheetx" data-lc="closesheet" aria-label="Close">✕</button>' + html + '</div></div></div>';
  if (keep) el.querySelector('.sheetcard').scrollTop = keep;
}
function lcHistoryHtml() {
  const L = S.draft.life;
  const color = k => LC_COLORS[L.seats.indexOf(k) % LC_COLORS.length];
  let h = '<div class="inner"><div class="top"><h2>Life history</h2><button class="link" data-lc="closeov">Close</button></div>' +
    '<div class="seg" style="margin-bottom:12px"><button data-lc="histtab" data-val="list" class="' + (LC.histTab === 'list' ? 'on' : '') + '">List</button><button data-lc="histtab" data-val="graph" class="' + (LC.histTab === 'graph' ? 'on' : '') + '">Graph</button></div>';
  if (LC.histTab === 'graph') {
    const W = 340, H = 220, t0 = L.startAt, t1 = Math.max(Date.now(), t0 + 1000);
    const series = L.seats.map(k => {
      const pts = [[t0, L.start]];
      L.hist.filter(e => e.k === k && e.ty === 'life').forEach(e => pts.push([e.t, e.v]));
      pts.push([t1, L.p[k].life]);
      return { k: k, pts: pts };
    });
    const vals = series.flatMap(s => s.pts.map(p => p[1]));
    const max = Math.max(L.start, ...vals), min = Math.min(0, ...vals);
    const X = t => 30 + (t - t0) / (t1 - t0) * (W - 40), Y = v => 10 + (max - v) / (max - min || 1) * (H - 30);
    h += '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;background:rgba(255,255,255,.04);border-radius:12px">' +
      [0, Math.round(max / 2), max].map(v => '<line x1="30" x2="' + (W - 10) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="rgba(255,255,255,.12)"/><text x="4" y="' + (Y(v) + 4) + '" fill="#aaa" font-size="11">' + v + '</text>').join('') +
      series.map(s => {
        let d = '', prev = null;
        s.pts.forEach(p => { d += (prev === null ? 'M' : 'L') + X(p[0]).toFixed(1) + ',' + (prev === null ? Y(p[1]) : Y(prev)).toFixed(1) + ' L' + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1) + ' '; prev = p[1]; });
        return '<path d="' + d + '" fill="none" stroke="' + color(s.k) + '" stroke-width="2.5"/>';
      }).join('') + '</svg>';
    h += '<div class="chips" style="margin-top:10px">' + L.seats.map(k => '<span style="display:flex;align-items:center;gap:6px;margin-right:10px"><i style="width:12px;height:12px;border-radius:3px;background:' + color(k) + '"></i>' + esc(lcInfo(k).name) + ' ' + L.p[k].life + '</span>').join('') + '</div>';
  } else {
    const rows = L.hist.slice().reverse().map(e => {
      const who = lcInfo(e.k).name;
      let what;
      if (e.ty === 'turn') what = '<b>' + esc(who) + '</b>' + (isYou(e.k) ? "r" : "'s") + ' turn, round ' + e.r;
      else if (e.ty === 'life') what = esc(who) + ' ' + (e.d > 0 ? '+' : '') + e.d + ' life, now ' + e.v;
      else if (e.ty === 'cmd') { const src = e.src.split(':'); const o = lcInfo(src[0]); what = esc(who) + ' took ' + e.d + ' commander damage from ' + esc(o.name) + ' (' + e.v + ' total)'; }
      else if (e.ty === 'note') what = esc(e.text);
      else if (e.ty === 'tax') what = esc(who) + ' cast ' + esc(shortCmd(lcInfo(e.k)['c' + (+e.src + 1)] || 'their commander')) + (e.d > 0 ? '' : ' (fixed)') + ', ' + e.v + (e.v === 1 ? ' time' : ' times');
      else if (e.ty === 'exp') what = esc(who) + ' ' + (e.d > 0 ? '+' : '') + e.d + ' experience, now ' + e.v;
      else if (e.ty === 'ring') what = 'The Ring ' + (e.d > 0 ? 'tempted ' + esc(isYou(e.k) ? 'you' : who) : 'count fixed for ' + esc(who)) + ' (' + e.v + (e.v === 1 ? ' time' : ' times') + ')';
      else what = esc(who) + ' ' + (e.d > 0 ? '+' : '') + e.d + ' ' + e.ty + ', now ' + e.v;
      return '<li><span class="t">' + mmss(e.t - L.startAt) + '</span><span>' + what + '</span></li>';
    }).join('');
    h += rows ? '<ul class="plain hist">' + rows + '</ul>' : '<p style="opacity:.7">Nothing yet. Changes show up here as you play.</p>';
  }
  return h + '</div>';
}
function lcRenderOverlays() {
  const el = document.getElementById('lcov');
  if (!el) return;
  const L = S.draft.life;
  let h = '';
  if (LC.menu === 'menu') {
    const ul = lcUndoLabel();
    h = '<div class="lcov"><div class="inner"><div class="top"><h2>Game menu</h2><button class="link" data-lc="closeov">Close</button></div>' +
      (ul ? '<button class="menuitem undo" data-lc="undo"><span>Undo</span><small>' + esc(ul) + '</small></button>' : '') +
      '<button class="menuitem" data-lc="rng">Flip coins or roll dice</button>' +
      '<button class="menuitem" data-lc="rngattack">Random attack</button>' +
      '<button class="menuitem" data-lc="pick">Re-roll who goes first</button>' +
      '<button class="menuitem" data-lc="rotate">Rotate seats</button>' +
      '<button class="menuitem" data-lc="layout">Change layout</button>' +
      '<button class="menuitem" data-lc="hist">Life history</button>' +
      '<button class="menuitem" data-lc="notes">Notes</button>' +
      '<button class="menuitem" data-lc="editpod">Edit pod and players</button>' +
      '<button class="menuitem" data-lc="reset">Reset life totals</button>' +
      '<button class="menuitem acc" data-lc="finish">End game and log results</button>' +
      '<button class="menuitem" data-lc="leave">Back to home (game stays saved)</button>' +
      '<button class="menuitem" data-lc="discardgame" style="color:#FF8A80">Discard this game</button></div></div>';
  } else if (LC.menu === 'rng') {
    h = '<div class="lcov"><div class="inner">' + rngHtml() + '</div></div>';
  } else if (LC.menu === 'layout') {
    h = '<div class="lcov"><div class="inner"><div class="top"><h2>Layout for ' + L.n + ' players</h2><button class="link" data-lc="closeov">Close</button></div>' +
      (LC_LAYOUTS[L.n] || []).map(lay => '<button class="menuitem layoutopt' + (lcLayout(L.n).id === lay.id ? ' acc' : '') + '" data-lc="setlayout" data-val="' + lay.id + '">' +
        layoutPreview(lay) + '<span>' + esc(lay.name) + '</span></button>').join('') + '</div></div>';
  } else if (LC.menu === 'hist') {
    h = '<div class="lcov">' + lcHistoryHtml() + '</div>';
  } else if (LC.menu === 'notes') {
    h = '<div class="lcov"><div class="inner"><div class="top"><h2>Notes</h2><button class="link" data-lc="closeov">Done</button></div>' +
      '<textarea data-field="notes" style="min-height:220px" placeholder="Big plays, misplays, salt">' + esc(S.draft.notes) + '</textarea></div></div>';
  } else if (LC.menu === 'over' && S.draft.bo3 && L.seats.length === 2) {
    const w = lcAlive()[0], t = matchTally(), done = t[w] >= 2, opp = L.seats.find(x => x !== 'me');
    const gameNo = ((S.draft.match && S.draft.match.games.length) || 0) + 1;
    h = '<div class="lcov" style="display:flex;align-items:center"><div class="inner" style="text-align:center">' +
      '<h1 style="font-size:44px">' + esc(lcInfo(w).name) + (done ? (plural(w) ? ' win the match!' : ' wins the match!') : (plural(w) ? ' win game ' : ' wins game ') + gameNo) + '</h1>' +
      (done ? turnTimeLines() : '') + '<p style="opacity:.85;margin:8px 0 22px;font-size:20px">Match: ' + esc(lcInfo('me').name) + ' ' + t.me + ', ' + esc(lcInfo(opp).name) + ' ' + t[opp] + '</p>' +
      (done ? '<button class="menuitem acc" data-lc="finish" style="text-align:center">Log the match</button>'
        : '<button class="menuitem acc" data-lc="nextgame" style="text-align:center">Start game ' + (gameNo + 1) + '</button>') +
      '<button class="menuitem" data-lc="closeov" style="text-align:center">Keep playing</button></div></div>';
  } else if (LC.menu === 'over') {
    const w = lcAlive()[0];
    h = '<div class="lcov" style="display:flex;align-items:center"><div class="inner" style="text-align:center">' +
      '<h1 style="font-size:48px">' + esc(lcInfo(w).name) + (plural(w) ? ' win!' : ' wins!') + '</h1>' +
      '<p style="opacity:.8;margin:8px 0 10px">Round ' + L.round + ', ' + mmss(Date.now() - L.startAt) + ' played</p>' + turnTimeLines() +
      '<button class="menuitem acc" data-lc="finish" style="text-align:center">Log results</button>' +
      '<button class="menuitem" data-lc="closeov" style="text-align:center">Keep playing</button></div></div>';
  }
  if (LC.rotating && !LC.menu) {
    h = '<div class="rotbar" role="toolbar" aria-label="Rotate seats"><button data-lc="rotccw" aria-label="Rotate counterclockwise">⟲</button>' +
      '<span>Rotate seats<small>Turn order stays the same</small></span><button data-lc="rotcw" aria-label="Rotate clockwise">⟳</button>' +
      '<button class="done" data-lc="rotdone">Done</button></div>';
  }
  el.innerHTML = h;
  const sb = document.getElementById('swapbar');
  if (LC.swap !== null && !sb) document.getElementById('lc').insertAdjacentHTML('beforeend', '<div class="swapbar" id="swapbar">Tap two players to swap <button data-lc="swapdone">Done</button></div>');
  if (LC.swap === null && sb) sb.remove();
}
function lcMount() {
  lcSize(); lcRenderSheets(); lcUpdate(); lcRenderOverlays(); lcRenderPrompt();
  if (S.draft.announceFirst) { S.draft.announceFirst = false; H.touch(); setTimeout(() => lcPickFirst(S.draft.firstKey), 350); }
  clearInterval(LC.timer);
  LC.timer = setInterval(lcUpdate, 1000);
}
function lcUnmount() { if (LC.anims || LC.curAnim) lcAnimClear(); clearInterval(LC.timer); LC.timer = null; } // keeping the screen on: see wake.js

function lcAction(act, el) {
  const d = S.draft, L = d.life, k = el.dataset.k;
  switch (act) {
    case 'panel': if (LC.swap !== null || LC.rotating) return; LC.cmdEdit = null; LC.panel = { k: k, mode: L.p[k].out ? 'out' : 'detail' }; return lcRenderSheets();
    case 'closesheet': LC.panel = null; LC.cmdEdit = null; lcRenderSheets(); return lcNextPrompt();
    case 'emview': case 'ringview': case 'radview': case 'ctrview':
      if (LC.swap !== null || LC.rotating) return;
      LC.panel = { k: k, mode: act, em: el.dataset.val, back: LC.panel && LC.panel.k === k ? 'detail' : '' };
      return lcRenderSheets();
    case 'emback':
      if (LC.panel && LC.panel.back === '' && (['emview', 'ringview', 'radview', 'ctrview'].indexOf(LC.panel.mode) !== -1)) { LC.panel = null; lcRenderSheets(); return lcNextPrompt(); }
      LC.panel = { k: k, mode: 'detail' }; return lcRenderSheets();
    case 'emadd': case 'emretry': {
      if (act === 'emretry') EMB.err = '';
      LC.panel = { k: k, mode: 'emsearch', q: '' }; lcRenderSheets();
      const q = document.querySelector('[data-emq]'); if (q) q.focus();
      loadEmblems().catch(err => { EMB.err = (err && err.message) || 'no connection'; }).then(() => {
        const box = document.getElementById('emres');
        if (box && LC.panel && LC.panel.mode === 'emsearch') box.innerHTML = emblemListHtml(LC.panel.k, LC.panel.q);
      });
      return;
    }
    case 'empick': return emResolve(k, el.dataset.val);
    case 'emto': {
      const e = (EMB.list || []).find(x => x.name === LC.panel.em);
      if (!e) return;
      emAdd(el.dataset.val, e, k); return emDone(k, e, [el.dataset.val]);
    }
    case 'emqty': {
      const P = L.p[k], m = P.emb.find(x => x.name === LC.panel.em);
      if (!m) return;
      m.n += +el.dataset.val;
      if (m.n <= 0) { P.emb = P.emb.filter(x => x !== m); lcNote(k, 'Removed the ' + m.name + ' emblem from ' + pname(k)); LC.panel = LC.panel.back ? { k: k, mode: 'detail' } : null; }
      else lcNote(k, pname(k) + ' now has ' + m.n + ' \u00D7 ' + m.name + ' emblem');
      H.touch(); lcRenderSheets(); return lcUpdate();
    }
    case 'desig': {
      const w = el.dataset.val;
      lcSetDesig(w, L[w] === k ? null : k);
      if (LC.panel) LC.panel.msg = '';
      H.touch(); lcRenderSheets(); return lcUpdate();
    }
    case 'pans': return lcAnswer(el.dataset.val);
    case 'undo': lcUndo(); return;
    case 'rng': LC.menu = 'rng'; if (RNG.mode === 'attack') { RNG.mode = 'coin'; RNG.result = null; } return lcRenderOverlays();
    case 'rngattack': LC.menu = 'rng'; RNG.mode = 'attack'; RNG.result = null; return lcRenderOverlays();
    case 'rngmode': RNG.mode = el.dataset.val; RNG.result = null; return lcRenderOverlays();
    case 'rngn': { const f = RNG.mode === 'coin' ? 'coins' : 'dice'; RNG[f] = Math.max(1, Math.min(f === 'coins' ? 6 : 8, RNG[f] + +el.dataset.val)); RNG.result = null; return lcRenderOverlays(); }
    case 'rngsides': RNG.sides = +el.dataset.val; RNG.result = null; return lcRenderOverlays();
    case 'rnggo': return rngGo();
    case 'pcolor': {
      d.pcolors = Object.assign({}, d.pcolors, { [k]: el.dataset.val }); H.touch();
      const p = document.querySelector('.lp[data-k="' + k + '"]'); if (p) p.style.background = panelBg(k);
      return lcRenderSheets();
    }
    case 'nextgame': {
      const alive = lcAlive();
      if (alive.length !== 1) return;
      const winner = alive[0], loser = L.seats.find(x => x !== winner);
      d.match = d.match || { games: [] };
      const lo = L.p[loser].out || {};
      d.match.games.push({ winner: winner, first: L.first, rounds: L.round, loser: loser, by: lo.by || '', how: lo.how || '', r: lo.r || L.round });
      const tt = lcTurnTimes(); d.timeCarry = {}; Object.keys(tt).forEach(x => { d.timeCarry[x] = tt[x]; }); // keep turn times across the match
      const seats = L.seats.slice();
      d.life = null;
      const N = lcEnsure();
      N.seats = seats; N.first = loser; N.active = loser; N.turnAt = Date.now(); N.startAt = Date.now();
      N.hist.push({ t: Date.now(), k: loser, ty: 'turn', d: 0, v: 1, src: '', r: 1 });
      N.turnId = 1; lcSnap();
      LC.menu = null; LC.panel = null; LC.prompt = null; LC.pend = []; LC.nudge = {}; lcAnimClear();
      H.touch(); H.render();
      toast(lcInfo(loser).name + (isYou(loser) ? ' lost game ' : ' lost game ') + d.match.games.length + ', so ' + (isYou(loser) ? 'you go' : 'they go') + ' first');
      return;
    }
    case 'cmddone': LC.cmdEdit = null; return lcRenderSheets();
    case 'outby': L.p[k].out.by = el.dataset.val; lcRollLine(k); H.touch(); lcUpdate(); return lcRenderSheets();
    case 'outhow': L.p[k].out.how = el.dataset.val; lcRollLine(k); H.touch(); lcUpdate(); return lcRenderSheets();
    case 'markout':
      L.outCount++; L.p[k].out = { order: L.outCount, cause: 'manual', by: '', how: 'Concession', manual: true, at: Date.now(), r: L.round }; lcRollLine(k); lcDesigOnOut(k);
      LC.panel = { k: k, mode: 'out' }; lcCheckOver(); H.touch(); lcRenderSheets(); lcUpdate(); return lcRenderOverlays();
    case 'revive': L.p[k].hold = true; lcRevive(k); H.touch(); lcRenderSheets(); lcRenderOverlays(); return lcUpdate();
    case 'pick': if (S.draft.life.hist.some(h => h.ty === 'turn') && !confirm('Pick a new first player and restart the round count?')) return; return lcPickFirst();
    case 'pass': return lcPass();
    case 'menu': LC.menu = 'menu'; return lcRenderOverlays();
    case 'closeov': LC.menu = null; return lcRenderOverlays();
    case 'hist': LC.menu = 'hist'; return lcRenderOverlays();
    case 'layout': LC.menu = 'layout'; return lcRenderOverlays();
    case 'rotate': LC.menu = null; LC.panel = null; LC.rotating = true; lcRenderSheets(); return lcRenderOverlays();
    case 'rotdone': LC.rotating = false; return lcRenderOverlays();
    case 'rotcw': case 'rotccw': {
      const n = L.seats.length;
      L.seats = act === 'rotcw' ? [L.seats[n - 1]].concat(L.seats.slice(0, n - 1)) : L.seats.slice(1).concat([L.seats[0]]);
      H.touch(); return H.render();
    }
    case 'setlayout':
      S.settings.layouts = Object.assign({}, S.settings.layouts, { [L.n]: el.dataset.val }); H.setSettings({ layouts: S.settings.layouts });
      LC.menu = null; return H.render();
    case 'histtab': LC.histTab = el.dataset.val; return lcRenderOverlays();
    case 'notes': LC.menu = 'notes'; return lcRenderOverlays();
    case 'swap': LC.menu = null; LC.swap = ''; lcRenderOverlays(); return lcUpdate();
    case 'swapdone': LC.swap = null; lcRenderOverlays(); return lcUpdate();
    case 'editpod': LC.menu = null; return H.go('setup');
    case 'reset':
      if (!confirm('Reset everyone to ' + L.start + ' life and clear the history?')) return;
      { const seats = L.seats, first = L.first; d.life = null; const N = lcEnsure(); N.seats = seats; if (first) { N.first = first; N.active = first; N.turnAt = Date.now(); } }
      LC.menu = null; LC.panel = null; LC.prompt = null; LC.pend = []; LC.nudge = {}; lcAnimClear(); H.touch(); return H.render();
    case 'finish': LC.prompt = null; LC.pend = []; return lcFinish();
    case 'leave': LC.menu = null; LC.prompt = null; LC.pend = []; return H.go('home');
    case 'discardgame':
      if (!confirm('Discard this game? Nothing from it will be saved.')) return;
      H.dropDraft(); LC.menu = null; LC.prompt = null; LC.pend = []; LC.nudge = {}; toast('Game discarded'); return H.go('home');
  }
}
function lcSwapTap(k) {
  const L = S.draft.life;
  if (!LC.swap) { LC.swap = k; return lcUpdate(); }
  if (LC.swap === k) { LC.swap = ''; return lcUpdate(); }
  const a = L.seats.indexOf(LC.swap), b = L.seats.indexOf(k);
  L.seats[a] = k; L.seats[b] = LC.swap;
  LC.swap = '';
  lcAssignSeats(); H.touch(); H.render();
}

/* press and hold: tap = 1, hold = 10 and keeps going */
let lcPress = null;
document.addEventListener('pointerdown', e => {
  const el = e.target.closest('[data-hold]');
  if (!el || !el.closest('.lc')) return;
  e.preventDefault();
  const parts = el.dataset.hold.split('|'), k = parts[0], ty = parts[1], sign = +parts[2], src = parts[3] || '';
  if (LC.swap !== null && ty === 'life') { lcSwapTap(k); return; }
  if (LC.spinning) return;
  const p = lcPress = { held: false, tap: () => lcApply(k, ty, sign, src) };
  p.timer = setTimeout(() => {
    if (lcPress !== p) return;
    p.held = true; lcApply(k, ty, 10 * sign, src);
    p.rep = setInterval(() => lcApply(k, ty, 10 * sign, src), 650);
  }, 450);
});
function lcEndPress(apply) {
  if (!lcPress) return;
  clearTimeout(lcPress.timer); clearInterval(lcPress.rep);
  if (apply && !lcPress.held) lcPress.tap();
  lcPress = null;
}
document.addEventListener('pointerup', () => lcEndPress(true));
document.addEventListener('pointercancel', () => lcEndPress(false));
document.addEventListener('contextmenu', e => { if (e.target.closest && e.target.closest('.lc')) e.preventDefault(); });
window.addEventListener('resize', () => {
  if (S.view !== 'playing' || !document.getElementById('lc')) return;
  lcSize(); lcPlaceHub();
  const typing = document.activeElement && document.activeElement.matches && document.activeElement.matches('[data-emq]');
  if (!typing) { lcRenderSheets(); lcRenderPrompt(); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.view === 'playing' && document.getElementById('lc')) lcMount(); });

// Any tap during a commander damage countdown jumps it straight to the final life total
document.addEventListener('pointerdown', () => { if (LC.cd && Object.keys(LC.cd).length) lcCountdownFinish(); }, true);


/* ---------- used by the rest of the app ---------- */
/** Clears the life counter's open menus and sheets when leaving a screen. */
export function lcResetUi() { LC.menu = null; LC.panel = null; LC.swap = null; LC.rotating = false; LC.cmdEdit = null; }
export function lcAfterRender() { if (S.view === 'playing' && document.getElementById('lc')) lcMount(); else lcUnmount(); }
export function lcClick(el) { return lcAction(el.dataset.lc, el); }
export function lcEmblemSearch(t) {
  if (!t.dataset || !t.dataset.emq || !LC.panel) return false;
  LC.panel.q = t.value;
  const box = document.getElementById('emres');
  if (box) box.innerHTML = emblemListHtml(LC.panel.k, LC.panel.q);
  return true;
}
export { lcHtml, LC_LAYOUTS, lcLayout, layoutPreview, ELIM_CATS, elimLines };
