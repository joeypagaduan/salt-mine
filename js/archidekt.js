// Loading decks from Archidekt, through the Salt Mine relay (Archidekt doesn't allow other websites to call it directly).
// Ported from the classic Salt Mine: commanders and colors from the Commander category, brackets from Archidekt
// or estimated from Game Changers, and deck types from the folder each deck lives in.
import { RELAY_URL } from './config.js';
import { normalizeColors, store } from './util.js';

const API = 'https://archidekt.com/api/';

async function relay(params) {
  const q = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  const res = await fetch(RELAY_URL + '?' + q);
  if (!res.ok) throw new Error('The deck relay answered ' + res.status);
  return res.json();
}
/** Fetches up to 10 Archidekt paths in one relay call. */
async function relayMany(paths) {
  const r = await relay({ paths: paths.join('|') });
  if (!r.ok) throw new Error(r.error || 'The deck relay had a problem');
  return r.results;
}
/** Runs batches of 10, a few at a time, so 60 decks don't mean 60 slow calls in a row. */
async function fetchAll(paths, onProgress) {
  const chunks = [];
  for (let i = 0; i < paths.length; i += 10) chunks.push(paths.slice(i, i + 10));
  const out = [];
  let done = 0, next = 0;
  async function worker() {
    while (next < chunks.length) {
      const mine = next++;
      const res = await relayMany(chunks[mine]);
      res.forEach((r, j) => { out[mine * 10 + j] = r; });
      done += chunks[mine].length;
      if (onProgress) onProgress(done, paths.length);
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  return out;
}

/** Every public deck for a username: [{id, name, updatedAt}]. */
export async function ownerDecks(username) {
  let path = 'decks/v3/?ownerUsername=' + encodeURIComponent(username) + '&pageSize=50';
  const out = [];
  for (let page = 0; path && page < 20; page++) {
    const r = await relay({ path: path });
    if (!r.ok) throw new Error(r.status === 429 ? 'Archidekt asked us to slow down. Try again in a minute.' : (r.error || 'Archidekt error'));
    (r.data.results || []).forEach(d => {
      const owner = d.owner && (d.owner.username || d.owner.name);
      if (d.id != null && (!owner || owner === username)) out.push({ id: String(d.id), name: d.name || '', updatedAt: d.updatedAt || '' });
    });
    path = typeof r.data.next === 'string' && r.data.next.indexOf(API) === 0 ? r.data.next : null;
  }
  return out;
}

/** Pulls deck IDs out of text like "123, https://archidekt.com/decks/456/name". */
export function parseDeckIds(text) {
  const ids = [];
  String(text || '').split(/[\s,]+/).forEach(t => {
    const m = t.match(/archidekt\.com\/decks\/(\d+)/) || t.match(/^(\d{3,})$/);
    if (m && ids.indexOf(m[1]) === -1) ids.push(m[1]);
  });
  return ids;
}

export function guessFolderType(name) {
  const n = String(name).toLowerCase();
  if (/archiv|retired|old/.test(n)) return ['Archived', false];
  if (/upgrad/.test(n)) return ['Upgraded', true];
  if (/pre-?con|precon/.test(n)) return ['Pre-Con', true];
  if (/scratch|brew|custom/.test(n)) return ['Scratch', true];
  return [String(name), false];
}

/** The official Game Changers list from Scryfall, kept for a week. Used to estimate brackets. */
async function gameChangers() {
  const c = store('smb_gc');
  if (c && c.list && Date.now() - c.at < 7 * 864e5) return c.list;
  const set = {};
  let url = 'https://api.scryfall.com/cards/search?q=' + encodeURIComponent('is:gamechanger') + '&unique=oracle';
  for (let p = 0; url && p < 5; p++) {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) break;
    const j = await r.json();
    (j.data || []).forEach(card => { set[card.name] = 1; });
    url = j.has_more ? j.next_page : null;
  }
  if (Object.keys(set).length) store('smb_gc', { at: Date.now(), list: set });
  return set;
}

function cardName(e) { const c = e.card || {}; return (c.oracleCard && c.oracleCard.name) || c.name || e.name || ''; }
function cardColors(e) { const c = e.card || {}; return (c.oracleCard && (c.oracleCard.colorIdentity || c.oracleCard.color_identity)) || []; }

/** The parts of Archidekt's (very large) deck JSON the app uses. */
export function parseDeck(d, gc) {
  const cards = d.cards || [];
  const excluded = { maybeboard: true, sideboard: true };
  (d.categories || []).forEach(cat => { if (cat && cat.includedInDeck === false && cat.name) excluded[String(cat.name).toLowerCase()] = true; });
  let gcCount = 0;
  if (gc) cards.forEach(c => {
    if (c.deletedAt) return;
    if ((c.categories || []).some(x => excluded[String(x).toLowerCase()])) return;
    if (gc[cardName(c)]) gcCount++;
  });
  let suggested = '';
  Object.keys(d).forEach(k => {
    if (k !== 'edhBracket' && /bracket/i.test(k) && suggested === '') {
      const v = d[k], n = (v && typeof v === 'object') ? (v.bracket || v.value || v.estimate) : v;
      if (n !== null && n !== undefined && n !== '' && !isNaN(Number(n))) suggested = Number(n);
    }
  });
  const cmdrs = cards.filter(c => (c.categories || []).some(cat => String(cat).toLowerCase() === 'commander') && !c.deletedAt);
  const names = cmdrs.map(cardName).filter(Boolean);
  let colors = [];
  cmdrs.forEach(c => { colors = colors.concat(cardColors(c)); });
  let parent = d.parentFolder != null ? d.parentFolder : (d.parentFolderId != null ? d.parentFolderId : null);
  if (parent && typeof parent === 'object') parent = parent.id;
  let bracket = '', source = '';
  if (d.edhBracket != null && d.edhBracket !== '') { bracket = d.edhBracket; source = 'Set in Archidekt'; }
  else if (suggested !== '') { bracket = suggested; source = 'Archidekt suggestion'; }
  else if (gc) { bracket = gcCount === 0 ? 2 : gcCount <= 3 ? 3 : 4; source = 'Estimated (Game Changers)'; }
  return {
    id: String(d.id), name: d.name || '', c1: names[0] || '', c2: names[1] || '',
    colors: names.length ? normalizeColors(colors) : 'C', bracket: bracket, bracketSource: source,
    gameChangers: gc ? gcCount : null, folderId: parent != null ? String(parent) : ''
  };
}

/**
 * Brings your Archidekt decks up to date.
 *   existing: your current deck list; folders: {folderId: {name, type, show}}
 * Returns { decks: [changed decks to save], folders: updated folder table, summary }
 * Only decks Archidekt says changed since the last refresh get reloaded in full.
 */
export async function refreshDecks({ username, extraIds, existing, folders, onProgress }) {
  if (!RELAY_URL) throw new Error('The deck relay isn\u2019t set up yet.');
  const say = msg => onProgress && onProgress(msg);
  say('Looking up your Archidekt decks\u2026');
  const listed = username ? await ownerDecks(username) : [];
  const byId = {};
  listed.forEach(d => { byId[d.id] = d; });
  (extraIds || []).forEach(id => { if (!byId[id]) byId[id] = { id: id, updatedAt: '' }; });
  const have = {};
  (existing || []).forEach(d => { have[d.id] = d; });
  const stale = Object.keys(byId).filter(id => {
    const h = have[id];
    return !h || h.source !== 'archidekt' || !byId[id].updatedAt || h.archUpdated !== byId[id].updatedAt || h.status !== 'ok';
  });
  let gc = null;
  if (stale.length) { say('Getting the Game Changers list\u2026'); try { gc = await gameChangers(); } catch (e) { gc = null; } }
  const results = stale.length ? await fetchAll(stale.map(id => 'decks/' + id + '/'), (n, of) => say('Loading decks: ' + n + ' of ' + of)) : [];
  const parsed = {}, failed = [];
  results.forEach((r, i) => { if (r && r.ok && r.data) parsed[stale[i]] = parseDeck(r.data, gc); else failed.push(stale[i]); });

  // New folders: look up their names and guess what kind of decks they hold
  folders = Object.assign({}, folders || {});
  const newFolders = [];
  Object.keys(parsed).forEach(id => { const f = parsed[id].folderId; if (f && !folders[f] && newFolders.indexOf(f) === -1) newFolders.push(f); });
  if (newFolders.length) {
    say('Reading your folders\u2026');
    const fr = await fetchAll(newFolders.map(f => 'decks/folders/' + f + '/'));
    newFolders.forEach((f, i) => {
      const name = (fr[i] && fr[i].ok && fr[i].data && fr[i].data.name) || 'Folder ' + f;
      const g = guessFolderType(name);
      folders[f] = { name: name, type: g[0], show: g[1] };
    });
  }

  const now = Date.now(), changes = [];
  Object.keys(parsed).forEach(id => {
    const p = parsed[id];
    changes.push(Object.assign(p, { source: 'archidekt', status: 'ok', archUpdated: byId[id].updatedAt || '', refreshedAt: now,
      url: 'https://archidekt.com/decks/' + id }));
  });
  // Decks that disappeared from Archidekt stay (for old stats) but leave the picker
  (existing || []).forEach(d => {
    if (d.source === 'archidekt' && !byId[d.id] && d.status !== 'missing') changes.push({ id: d.id, status: 'missing', refreshedAt: now });
  });
  const kept = Object.keys(byId).length - stale.length;
  const summary = Object.keys(byId).length + ' decks on Archidekt: ' + Object.keys(parsed).length + ' updated, ' + kept + ' unchanged' +
    (failed.length ? ', ' + failed.length + ' couldn\u2019t load' : '') + '.';
  return { decks: changes, folders: folders, summary: summary, failed: failed };
}
