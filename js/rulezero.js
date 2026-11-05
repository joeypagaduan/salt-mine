// Rule 0 check: before a Commander game with an Archidekt deck, shows the deck's Game Changers, mass land denial,
// two-card combos and (if you choose) three-card combos, so you can tell the table. Game Changers come from Scryfall's
// list; combos and mass land denial from Commander Spellbook. Since 2.0.3 decks are checked when they refresh (and on
// the day's first open), so the sheet shows the saved result straight away. Check again asks afresh.
import { RELAY_URL } from './config.js';
import { S, uid } from './state.js';
import { esc, toast } from './util.js';
import * as D from './data.js';
import { deckJson, deckCardLists, gameChangers } from './archidekt.js';

const CSB = 'https://backend.commanderspellbook.com/find-my-combos?limit=100';
const CSB_BRACKET = 'https://backend.commanderspellbook.com/estimate-bracket';
export const comboUrl = id => 'https://commanderspellbook.com/combo/' + encodeURIComponent(id) + '/';
// what a combo has to produce to count: something infinite, or winning (or making opponents lose) outright
const BIG = /infinite|win the game|lose the game|loses the game/i;

/** Gives up on a step that takes too long, so a weak signal never holds up the game. */
function timeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

/** Which saved check is current: bumped when what gets saved changes, so older saves are checked again. */
const RZ_VERSION = 3; // 3 (2.0.3): combo links and mass land denial

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
    if (!out[key]) out[key] = { n: count, cards: cards, what: [], id: v.id ? String(v.id) : '' };
    what.forEach(w => { if (out[key].what.indexOf(w) === -1) out[key].what.push(w); });
  });
  return Object.keys(out).sort((a, b) => out[a].n - out[b].n || (a < b ? -1 : 1)).map(k => ({ n: out[k].n, cards: out[k].cards, what: out[k].what.slice(0, 4).join(', '), id: out[k].id }));
}
/** The cards Commander Spellbook counts as mass land denial, from its bracket estimate. */
export function mldIn(res) {
  return ((res && res.cards) || []).filter(c => c && c.massLandDenial && c.card && c.card.name).map(c => c.card.name).filter((n, i, a) => a.indexOf(n) === i).sort();
}

/**
 * Asks Commander Spellbook for the deck's combos and its mass land denial cards: directly first, and through the
 * Salt Mine relay if the browser isn't allowed to. Returns { combos, mld } with mld null if that part couldn't be checked.
 */
async function askSpellbook(lists) {
  const deck = { commanders: lists.commanders.map(n => ({ card: n })), main: lists.main.map(n => ({ card: n, quantity: 1 })) };
  const post = url => timeout(fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(deck) }), 12000)
    .then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))));
  try {
    const both = await Promise.all([post(CSB), post(CSB_BRACKET).catch(() => null)]);
    return { combos: combosIn(both[0]), mld: both[1] ? mldIn(both[1]) : null };
  } catch (e) { /* not allowed from the browser, or slow: try the relay */ }
  if (!RELAY_URL) throw new Error('no relay');
  // text/plain keeps this a simple request, which Apps Script can answer from another website
  const res = await timeout(fetch(RELAY_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ combos: deck, bracket: true }) }), 25000);
  const j = await res.json();
  if (!j || !j.ok) throw new Error((j && j.error) || 'Combo check failed');
  return { combos: combosIn(j.data), mld: Array.isArray(j.data && j.data.mld) ? j.data.mld.slice().sort() : null };
}

/**
 * Checks a deck, or reuses the saved check when the deck hasn't changed on Archidekt since.
 * Returns { v, gc, gcOk, mld, mldOk, combos: [{n, cards, what, id}], comboOk, at, for } plus offline/stale flags when it had to use an old one.
 * fresh: the saved check is good enough when it's current, with no call to Archidekt (the Start game sheet).
 */
export async function checkDeck(deck, force, fresh) {
  const saved = deck.rz || null;
  if (fresh && !force && saved && !needsCheck(deck)) return saved;
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
  let combos = [], comboOk = true, mld = null;
  const same = saved && saved.v === RZ_VERSION;
  try { const a = await askSpellbook(lists); combos = a.combos; mld = a.mld; }
  catch (e) { comboOk = false; combos = same && saved.combos ? saved.combos : []; }
  const mldOk = mld !== null;
  if (!mldOk) mld = same && saved.mld ? saved.mld : [];
  const rz = { v: RZ_VERSION, for: edited, at: Date.now(), gc: gc, gcOk: !!gcSet, mld: mld, mldOk: mldOk, combos: combos, comboOk: comboOk };
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
const comboLine = c => c.cards.join(' + ') + ' (' + c.what + ')' + (c.id ? ' ' + comboUrl(c.id) : '');
/** What you'd say at the table, for Copy. Every count shows, even when it's 0. */
export function tableText(deck, rz) {
  const c = shown(rz);
  const lines = [deck.name + (deck.c1 ? ' (' + [deck.c1, deck.c2].filter(Boolean).join(' / ') + ')' : '') +
    (deck.bracket !== '' && deck.bracket != null ? ', bracket ' + deck.bracket : '')];
  lines.push('Game Changers (' + (rz.gc || []).length + ')' + ((rz.gc || []).length ? ': ' + rz.gc.join(', ') : ''));
  lines.push('Mass land denial (' + (rz.mld || []).length + ')' + ((rz.mld || []).length ? ': ' + rz.mld.join(', ') : ''));
  lines.push('Two-card combos (' + c.two.length + ')' + (c.two.length ? ': ' + c.two.map(comboLine).join('; ') : ''));
  if (showThree()) lines.push('Three-card combos (' + c.three.length + ')' + (c.three.length ? ': ' + c.three.map(comboLine).join('; ') : ''));
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
    // every count shows, 0 included; each list sits under its count
    const c = shown(rz);
    const section = (title, n, items) => '<div class="rz-sec"><div class="rz-count"><span>' + title + '</span><b' + (n ? ' class="hit"' : '') + '>' + n + '</b></div>' +
      (n ? '<ul class="rz-list">' + items + '</ul>' : '') + '</div>';
    const cardsLi = list => list.map(n => '<li>' + esc(n) + '</li>').join('');
    const combosLi = list => list.map(x => '<li><b>' + esc(x.cards.join(' + ')) + '</b><br><small class="muted">' + esc(x.what) + '</small>' +
      (x.id ? '<br><a class="rz-link" href="' + esc(comboUrl(x.id)) + '" target="_blank" rel="noopener">View on Commander Spellbook \u203a</a>' : '') + '</li>').join('');
    h += section('Game Changers', (rz.gc || []).length, cardsLi(rz.gc || []));
    h += section('Mass land denial', (rz.mld || []).length, cardsLi(rz.mld || []));
    h += section('Two-card combos', c.two.length, combosLi(c.two));
    if (showThree()) h += section('Three-card combos', c.three.length, combosLi(c.three));
    if (rz.mldOk === false) h += '<p><small>Couldn\u2019t check mass land denial this time' + ((rz.mld || []).length ? ', so it\u2019s from the last check' : '') + '.</small></p>';
    if (rz.gcOk === false) h += '<p><small>Couldn\u2019t get the Game Changers list from Scryfall this time.</small></p>';
    if (!rz.comboOk) h += '<p><small>Couldn\u2019t reach Commander Spellbook, so combos ' + ((rz.combos || []).length ? 'are from the last check' : 'weren\u2019t checked') + '.</small></p>';
    if (rz.offline) h += '<p><small>You\u2019re offline, so this is the last check.</small></p>';
    if (rz.stale) h += '<p><small>Couldn\u2019t reach Archidekt, so this is the last check. Changes since then won\u2019t show.</small></p>';
    h += '<p><small>Checked ' + esc(when(rz.at)) + '. Combos and mass land denial from Commander Spellbook.</small></p>';
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
      '<p class="status" style="color:var(--ink)">Checking for Game Changers, mass land denial and combos\u2026</p>' +
      '<button class="btn primary" data-rz="go">Start without checking</button><button class="btn" data-rz="close">Back</button>';
  };
  const go = force => {
    const mine = ++run; loading();
    checkDeck(deck, force, true).then(res => {
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
  // the saved check (kept current by deck refreshes) shows right away; a deck never checked waits for its first check
  go(false);
}

/** Whether starting this game should show the Rule 0 check first. */
export function wantsRuleZero(d, deck) {
  return S.settings.ruleZero !== false && !!deck && deck.source === 'archidekt' && d.stage === 'setup' && !d.quick && !d.gameId;
}

/* ---------- checking decks in the background (2.0.3) ---------- */
/** Whether a deck's saved check is missing, from an older version, incomplete, or from before its last Archidekt edit. */
export function needsCheck(deck) {
  const rz = deck.rz;
  return deck.source === 'archidekt' && deck.status === 'ok' &&
    (!rz || rz.v !== RZ_VERSION || !rz.comboOk || (!!deck.archUpdated && rz.for !== deck.archUpdated));
}
/** The small banner at the top while decks update. null hides it; done shows a short "updated" note first. */
export function banner(text, done) {
  let el = document.getElementById('rzbanner');
  if (text == null) {
    if (!el) return;
    if (done) { el.textContent = done; el.classList.add('done'); setTimeout(() => { if (el.classList.contains('done')) el.remove(); }, 2200); }
    else el.remove();
    return;
  }
  if (!el) { el = document.createElement('div'); el.id = 'rzbanner'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.classList.remove('done'); el.textContent = text;
}
let sweeping = false;
/**
 * Checks every deck in your picker that needs it, two at a time, with the banner counting along.
 * Only while Rule 0 check is on. Decks hidden from the picker are skipped (they're checked when you start a game with them).
 */
export async function sweepDecks(decks, opts) {
  opts = opts || {};
  if (sweeping || S.settings.ruleZero === false || !navigator.onLine) return 0;
  const todo = (decks || []).filter(needsCheck);
  if (!todo.length) { if (opts.doneText) banner(null, opts.doneText); return 0; }
  sweeping = true;
  const total = todo.length; let done = 0;
  const show = () => banner('Checking your decks for Rule 0\u2026 ' + done + ' of ' + total);
  show();
  const worker = async () => {
    while (todo.length) {
      const d = todo.shift();
      try { await checkDeck(d, false); } catch (e) { /* that deck is checked again next time */ }
      done++; show();
    }
  };
  try { await Promise.all([worker(), worker()]); } finally { sweeping = false; }
  banner(null, opts.doneText || 'Decks updated');
  return total;
}
