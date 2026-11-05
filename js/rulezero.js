// Rule 0 check (2.0.2): before a Commander game with an Archidekt deck, shows the deck's Game Changers and its
// two-card combos, plus three-card combos if you choose (infinite or game-winning), so you can tell the table. Game Changers come from Scryfall's list,
// combos from Commander Spellbook. The result is saved with the deck and only checked again once the deck changes
// on Archidekt (or when you tap Check again).
import { RELAY_URL } from './config.js';
import { S, uid } from './state.js';
import { esc, toast } from './util.js';
import * as D from './data.js';
import { deckJson, deckCardLists, gameChangers } from './archidekt.js';

const CSB = 'https://backend.commanderspellbook.com/find-my-combos?limit=100';
// what a combo has to produce to count: something infinite, or winning (or making opponents lose) outright
const BIG = /infinite|win the game|lose the game|loses the game/i;

/** Gives up on a step that takes too long, so a weak signal never holds up the game. */
function timeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

/** Which saved check is current: bumped when what gets saved changes, so older saves are checked again. */
const RZ_VERSION = 2;

/**
 * The two- and three-card combos in a Commander Spellbook answer: two or three cards, nothing else needed on the
 * battlefield, and something infinite or game-winning. The same cards listed twice (different variants) are merged.
 * Each combo is { n: 2 or 3, cards, what }. Both sizes are always saved; Settings decides which ones show.
 */
export function combosIn(res) {
  const r = res && (res.results || res);
  const out = {};
  ((r && r.included) || []).forEach(v => {
    const uses = v.uses || [];
    const count = uses.reduce((n, u) => n + (u.quantity || 1), 0);
    if ((count !== 2 && count !== 3) || uses.length !== count || (v.requires || []).length) return;
    const cards = uses.map(u => (u.card && u.card.name) || '').filter(Boolean).sort();
    if (cards.length !== count) return;
    const what = (v.produces || []).map(p => (p.feature && p.feature.name) || '').filter(n => BIG.test(n));
    if (!what.length) return;
    const key = cards.join('|');
    if (!out[key]) out[key] = { n: count, cards: cards, what: [] };
    what.forEach(w => { if (out[key].what.indexOf(w) === -1) out[key].what.push(w); });
  });
  return Object.keys(out).sort((a, b) => out[a].n - out[b].n || (a < b ? -1 : 1)).map(k => ({ n: out[k].n, cards: out[k].cards, what: out[k].what.slice(0, 4).join(', ') }));
}

/** Asks Commander Spellbook directly; if the browser isn't allowed to, asks through the Salt Mine relay instead. */
async function findCombos(lists) {
  const deck = { commanders: lists.commanders.map(n => ({ card: n })), main: lists.main.map(n => ({ card: n, quantity: 1 })) };
  try {
    const res = await timeout(fetch(CSB, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(deck) }), 12000);
    if (res.ok) return combosIn(await res.json());
  } catch (e) { /* not allowed from the browser, or slow: try the relay */ }
  if (!RELAY_URL) throw new Error('no relay');
  // text/plain keeps this a simple request, which Apps Script can answer from another website
  const res = await timeout(fetch(RELAY_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ combos: deck }) }), 20000);
  const j = await res.json();
  if (!j || !j.ok) throw new Error((j && j.error) || 'Combo check failed');
  return combosIn(j.data);
}

/**
 * Checks a deck, or reuses the saved check when the deck hasn't changed on Archidekt since.
 * Returns { v, gc: [card names], combos: [{n, cards, what}], comboOk, at, for } plus offline/stale flags when it had to use an old one.
 */
export async function checkDeck(deck, force) {
  const saved = deck.rz || null;
  if (!navigator.onLine) return saved ? Object.assign({}, saved, { offline: true }) : { offline: true, none: true };
  let j;
  try { j = await timeout(deckJson(deck.id), 15000); }
  catch (e) { return saved ? Object.assign({}, saved, { stale: true }) : { failed: true }; }
  const edited = j.updatedAt || '';
  if (!force && saved && saved.v === RZ_VERSION && saved.comboOk && edited && saved.for === edited) return saved;
  const lists = deckCardLists(j);
  let gcSet = null;
  try { gcSet = await timeout(gameChangers(), 15000); } catch (e) { gcSet = null; }
  const gc = gcSet ? lists.commanders.concat(lists.main).filter(n => gcSet[n]).sort() : (saved ? saved.gc || [] : []);
  let combos = [], comboOk = true;
  try { combos = await findCombos(lists); } catch (e) { comboOk = false; combos = saved && saved.v === RZ_VERSION && saved.combos ? saved.combos : []; }
  const rz = { v: RZ_VERSION, for: edited, at: Date.now(), gc: gc, gcOk: !!gcSet, combos: combos, comboOk: comboOk };
  deck.rz = rz;
  D.saveDeck(uid(), { id: deck.id, rz: rz }).catch(() => {});
  return rz;
}

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
/** Whether three-card combos show (Settings > During games > Combos to show). Two-card only unless you choose. */
export const showThree = () => S.settings.ruleZeroCombos === 'three';
/** The saved combos, split by size, keeping only what Settings says to show. */
function shown(rz) {
  const all = rz.combos || [], size = c => c.n || (c.cards || []).length;
  return { two: all.filter(c => size(c) === 2), three: showThree() ? all.filter(c => size(c) === 3) : [] };
}
function summary(rz) {
  const g = (rz.gc || []).length, c = shown(rz);
  if (!g && !c.two.length && !c.three.length) return 'Nothing to flag';
  return [g ? plural(g, 'Game Changer', 'Game Changers') : '', c.two.length ? plural(c.two.length, 'two-card combo', 'two-card combos') : '',
    c.three.length ? plural(c.three.length, 'three-card combo', 'three-card combos') : ''].filter(Boolean).join(', ');
}
const comboLine = c => c.cards.join(' + ') + ' (' + c.what + ')';
/** What you'd say at the table, for Copy. */
export function tableText(deck, rz) {
  const c = shown(rz);
  const lines = [deck.name + (deck.c1 ? ' (' + [deck.c1, deck.c2].filter(Boolean).join(' / ') + ')' : '') +
    (deck.bracket !== '' && deck.bracket != null ? ', bracket ' + deck.bracket : '')];
  lines.push('Game Changers: ' + ((rz.gc || []).length ? rz.gc.join(', ') : 'none'));
  lines.push('Two-card combos: ' + (c.two.length ? c.two.map(comboLine).join('; ') : 'none'));
  if (showThree()) lines.push('Three-card combos: ' + (c.three.length ? c.three.map(comboLine).join('; ') : 'none'));
  return lines.join('\n');
}
function when(at) {
  if (!at) return '';
  const d = new Date(at);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function resultHtml(deck, rz) {
  let h = '<h3 style="margin:2px 0 2px">Rule 0 check</h3><p style="margin:0 0 10px">' + esc(deck.name) +
    (deck.bracket !== '' && deck.bracket != null ? ' <span class="badge">B' + esc(deck.bracket) + '</span>' : '') + '</p>';
  if (rz.failed || rz.none) {
    h += '<p style="color:var(--ink)"><b>Couldn\u2019t check this deck' + (rz.none ? ' while offline' : '') + '.</b></p><p>Check your deck on Archidekt if you want to tell the table about Game Changers or combos.</p>';
  } else {
    h += '<p style="color:var(--ink);font-size:1.1em;margin-bottom:12px"><b>' + esc(summary(rz)) + '</b></p>';
    if ((rz.gc || []).length) h += '<span class="label">Game Changers</span><ul style="margin:4px 0 12px;padding-left:20px;color:var(--ink)">' + rz.gc.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>';
    const c = shown(rz);
    const list = (title, items) => '<span class="label">' + title + '</span><ul style="margin:4px 0 12px;padding-left:20px;color:var(--ink)">' +
      items.map(x => '<li><b>' + esc(x.cards.join(' + ')) + '</b><br><small class="muted">' + esc(x.what) + '</small></li>').join('') + '</ul>';
    if (c.two.length) h += list('Two-card combos', c.two);
    if (c.three.length) h += list('Three-card combos', c.three);
    if (rz.gcOk === false) h += '<p><small>Couldn\u2019t get the Game Changers list from Scryfall this time.</small></p>';
    if (!rz.comboOk) h += '<p><small>Couldn\u2019t reach Commander Spellbook, so combos ' + ((rz.combos || []).length ? 'are from the last check' : 'weren\u2019t checked') + '.</small></p>';
    if (rz.offline) h += '<p><small>You\u2019re offline, so this is the last check.</small></p>';
    if (rz.stale) h += '<p><small>Couldn\u2019t reach Archidekt, so this is the last check. Changes since then won\u2019t show.</small></p>';
    h += '<p><small>Checked ' + esc(when(rz.at)) + '. Combos from Commander Spellbook.</small></p>';
  }
  h += '<button class="btn primary" data-rz="go">Got it, start game</button>';
  if (!rz.failed && !rz.none) h += '<button class="btn" data-rz="copy">Copy for the table</button>';
  h += '<button class="btn" data-rz="again">Check again</button><button class="btn" data-rz="close">Back</button>';
  return h;
}

/**
 * Opens the Rule 0 sheet for a deck, then calls onStart if you start the game from it.
 * While it's checking, you can start without waiting.
 */
export function openRuleZero(deck, onStart) {
  let el = document.getElementById('rzsheet');
  if (el) el.remove();
  el = document.createElement('div'); el.id = 'rzsheet';
  el.innerHTML = '<div class="actscrim" data-rz="close"></div><div class="actsheet" role="dialog" aria-label="Rule 0 check" style="max-height:88vh;overflow-y:auto"><div class="inner"></div></div>';
  document.body.appendChild(el);
  const inner = el.querySelector('.inner');
  let rz = null, run = 0;
  const loading = () => {
    inner.innerHTML = '<h3 style="margin:2px 0 2px">Rule 0 check</h3><p style="margin:0 0 10px">' + esc(deck.name) + '</p>' +
      '<p class="status" style="color:var(--ink)">Checking for Game Changers and combos\u2026</p>' +
      '<button class="btn primary" data-rz="go">Start without checking</button><button class="btn" data-rz="close">Back</button>';
  };
  const go = force => {
    const mine = ++run; loading();
    checkDeck(deck, force).then(res => {
      if (mine !== run || !document.body.contains(el)) return; // closed or started meanwhile
      rz = res; inner.innerHTML = resultHtml(deck, rz);
    });
  };
  el.addEventListener('click', async e => {
    const a = e.target.closest('[data-rz]'); if (!a) return;
    const act = a.dataset.rz;
    if (act === 'close') { run++; el.remove(); return; }
    if (act === 'go') { run++; el.remove(); onStart(); return; }
    if (act === 'again') return go(true);
    if (act === 'copy' && rz) {
      const text = tableText(deck, rz);
      try { await navigator.clipboard.writeText(text); }
      catch (err) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e2) {} ta.remove(); }
      toast('Copied');
    }
  });
  // the saved check shows right away when the deck hasn't changed; otherwise the sheet waits for the new one
  go(false);
}

/** Whether starting this game should show the Rule 0 check first. */
export function wantsRuleZero(d, deck) {
  return S.settings.ruleZero !== false && !!deck && deck.source === 'archidekt' && d.stage === 'setup' && !d.quick && !d.gameId;
}
