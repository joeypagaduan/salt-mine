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
/**
 * Runs batches of 10, a few at a time, so 60 decks don't mean 60 slow calls in a row.
 * A batch that fails leaves nulls for its paths instead of losing everything else.
 */
async function fetchAll(paths, onProgress) {
  const chunks = [];
  for (let i = 0; i < paths.length; i += 10) chunks.push(paths.slice(i, i + 10));
  const out = new Array(paths.length).fill(null);
  let done = 0, next = 0, bad = 0, lastErr = null;
  async function worker() {
    while (next < chunks.length) {
      const mine = next++;
      try {
        const res = await relayMany(chunks[mine]);
        res.forEach((r, j) => { out[mine * 10 + j] = r; });
      } catch (e) { bad++; lastErr = e; }
      done += chunks[mine].length;
      if (onProgress) onProgress(done, paths.length);
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  if (chunks.length && bad === chunks.length) throw lastErr || new Error('The deck relay had a problem');
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
    path = nextPath(r.data.next);
  }
  return out;
}
/**
 * Archidekt's link to the next page, as a path the relay understands. Archidekt can hand back that link as
 * http://, with www., or relative, so anything after /api/ is used (classic accepted any of these too).
 */
function nextPath(next) {
  if (typeof next !== 'string' || !next) return null;
  const i = next.indexOf('/api/');
  if (i !== -1) return next.slice(i + 5);
  return /^decks\//.test(next) ? next : null;
}
const idOf = v => (v == null || v === '' ? '' : String(typeof v === 'object' ? (v.id != null ? v.id : '') : v));
/**
 * Every deck in your folders, the way classic's folder walk did, and the folder each one is in right now.
 * It starts from the folders the app knows, climbs to their parent folders (up to your Archidekt home folder),
 * and goes down into every subfolder. Returns { decks: {id: {id, name, updatedAt, folderId}}, folders: {id: {name, parent}},
 * rootId, errors }. A folder that can't be read is noted in errors and skipped.
 */
export async function folderDecks(seedIds) {
  const decks = {}, folders = {}, seen = {};
  let errors = 0;
  let queue = (seedIds || []).map(String).filter(Boolean);
  for (let round = 0; queue.length && round < 12; round++) {
    const ids = queue.filter((id, i) => !seen[id] && queue.indexOf(id) === i); queue = [];
    if (!ids.length) break;
    ids.forEach(id => { seen[id] = true; });
    let res;
    try { res = await fetchAll(ids.map(id => 'decks/folders/' + id + '/')); } catch (e) { errors += ids.length; continue; }
    const take = (fid, data) => {
      const parent = idOf(data.parentFolder != null ? data.parentFolder : data.parentFolderId);
      if (!folders[fid]) folders[fid] = { name: data.name || '', parent: parent };
      if (parent && !seen[parent]) queue.push(parent);
      (data.subfolders || data.children || []).forEach(sf => {
        const sid = idOf(sf); if (!sid) return;
        if (!folders[sid] && sf.name) folders[sid] = { name: sf.name, parent: fid };
        if (!seen[sid]) queue.push(sid);
      });
      (data.decks || data.results || []).forEach(d => {
        if (d && d.id != null && !decks[String(d.id)]) decks[String(d.id)] = { id: String(d.id), name: d.name || '', updatedAt: d.updatedAt || '', folderId: fid };
      });
    };
    for (let i = 0; i < ids.length; i++) {
      const r = res[i];
      if (!r || !r.ok || !r.data) { errors++; continue; }
      take(ids[i], r.data);
      let path = nextPath(r.data.next);
      for (let page = 1; path && page < 20; page++) {
        let rr; try { rr = await relay({ path: path }); } catch (e) { errors++; break; }
        if (!rr || !rr.ok || !rr.data) { errors++; break; }
        take(ids[i], rr.data); path = nextPath(rr.data.next);
      }
    }
  }
  // your home folder is the one at the top: no parent
  const tops = Object.keys(folders).filter(id => seen[id] && !folders[id].parent);
  return { decks: decks, folders: folders, rootId: tops.length === 1 ? tops[0] : '', errors: errors };
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
  // in-progress and for-someone-else folders stay out of the picker, even "Precon... Working"
  if (/work|progress|\bwip\b|testing|draft/.test(n)) return ['Working', false];
  if (/other|shared|friend|gift|loan/.test(n)) return [String(name), false];
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
 *   existing: your current deck list; folders: {folderId: {name, type, show}}; rootId: your Archidekt home folder, once known
 *   force: reload every deck in full instead of only the ones Archidekt says changed
 * Returns { decks: [changed decks to save], folders: updated folder table, rootId, summary }
 * The folder walk decides which folder each deck is in (as in classic), since moving a deck to another folder
 * doesn't count as a change to the deck on Archidekt.
 */
export async function refreshDecks({ username, extraIds, existing, folders, rootId, force, onProgress }) {
  if (!RELAY_URL) throw new Error('The deck relay isn\u2019t set up yet.');
  const say = msg => onProgress && onProgress(msg);
  say('Looking up your Archidekt decks\u2026');
  const listed = username ? await ownerDecks(username) : [];
  const byId = {};
  listed.forEach(d => { byId[d.id] = d; });
  const have = {};
  (existing || []).forEach(d => { have[d.id] = d; });

  // walk your folders, starting from every folder the app has seen
  say('Checking your folders\u2026');
  const seeds = Object.keys(folders || {}).concat(rootId ? [rootId] : [], (existing || []).filter(d => d.source === 'archidekt').map(d => d.folderId));
  let walk = { decks: {}, folders: {}, rootId: '', errors: 0 };
  if (seeds.some(Boolean)) { try { walk = await folderDecks(seeds); } catch (e) { walk.errors++; } }
  Object.keys(walk.decks).forEach(id => { if (!byId[id]) byId[id] = walk.decks[id]; });
  (extraIds || []).forEach(id => { if (!byId[id]) byId[id] = { id: id, updatedAt: '' }; });

  const stale = Object.keys(byId).filter(id => {
    const h = have[id];
    return force || !h || h.source !== 'archidekt' || !byId[id].updatedAt || h.archUpdated !== byId[id].updatedAt || h.status !== 'ok';
  });
  let gc = null;
  if (stale.length) { say('Getting the Game Changers list\u2026'); try { gc = await gameChangers(); } catch (e) { gc = null; } }
  const results = stale.length ? await fetchAll(stale.map(id => 'decks/' + id + '/'), (n, of) => say('Loading decks: ' + n + ' of ' + of)) : [];
  const parsed = {}, failed = [];
  results.forEach((r, i) => { if (r && r.ok && r.data) parsed[stale[i]] = parseDeck(r.data, gc); else failed.push(stale[i]); });
  // the folder walk knows best where a deck is now
  Object.keys(parsed).forEach(id => { if (walk.decks[id]) parsed[id].folderId = walk.decks[id].folderId; });

  // decks that only moved to another folder
  const moved = [];
  Object.keys(walk.decks).forEach(id => {
    const h = have[id], f = walk.decks[id].folderId;
    if (!parsed[id] && h && h.source === 'archidekt' && String(h.folderId || '') !== f) moved.push({ id: id, folderId: f });
  });

  // New folders: name them (from the walk when it read them) and guess what kind of decks they hold
  folders = Object.assign({}, folders || {});
  const newFolders = [];
  Object.keys(parsed).map(id => parsed[id].folderId).concat(moved.map(m => m.folderId)).forEach(f => { if (f && !folders[f] && newFolders.indexOf(f) === -1) newFolders.push(f); });
  const unnamed = newFolders.filter(f => !(walk.folders[f] && walk.folders[f].name));
  if (unnamed.length) {
    say('Reading your folders\u2026');
    let fr = []; try { fr = await fetchAll(unnamed.map(f => 'decks/folders/' + f + '/')); } catch (e) { fr = []; }
    unnamed.forEach((f, i) => { const r = fr[i]; walk.folders[f] = { name: (r && r.ok && r.data && r.data.name) || 'Folder ' + f }; });
  }
  newFolders.forEach(f => { const g = guessFolderType(walk.folders[f].name); folders[f] = { name: walk.folders[f].name, type: g[0], show: g[1] }; });
  // every other folder the walk found is listed too (empty ones and your home folder), so you can set them up like in classic
  const root = walk.rootId || rootId || '';
  Object.keys(walk.folders).forEach(f => {
    if (folders[f] || !walk.folders[f].name) return;
    const g = f === root ? ['Unsorted', false] : guessFolderType(walk.folders[f].name);
    folders[f] = { name: walk.folders[f].name, type: g[0], show: g[1] };
  });
  // a folder renamed on Archidekt keeps the kind you gave it
  Object.keys(folders).forEach(f => { const w = walk.folders[f]; if (w && w.name && w.name !== folders[f].name) folders[f] = Object.assign({}, folders[f], { name: w.name }); });

  const now = Date.now(), changes = [];
  Object.keys(parsed).forEach(id => {
    const p = parsed[id];
    changes.push(Object.assign(p, { source: 'archidekt', status: 'ok', archUpdated: byId[id].updatedAt || '', refreshedAt: now,
      url: 'https://archidekt.com/decks/' + id }));
  });
  moved.forEach(m => changes.push({ id: m.id, folderId: m.folderId, refreshedAt: now }));
  // Decks that disappeared from Archidekt stay (for old stats) but leave the picker. Only decided when every folder could be read.
  let gone = 0;
  if (!walk.errors) (existing || []).forEach(d => {
    if (d.source === 'archidekt' && !byId[d.id] && d.status !== 'missing') { changes.push({ id: d.id, status: 'missing', refreshedAt: now }); gone++; }
  });
  const kept = Object.keys(byId).length - stale.length;
  const summary = Object.keys(byId).length + ' decks on Archidekt: ' + Object.keys(parsed).length + (force ? ' reloaded' : ' updated') +
    (force ? '' : ', ' + kept + ' unchanged') + (moved.length ? ', ' + moved.length + ' moved to another folder' : '') +
    (gone ? ', ' + gone + ' no longer there' : '') + (failed.length ? ', ' + failed.length + ' couldn\u2019t load' : '') +
    (walk.errors ? '. Some folders couldn\u2019t be read; try again in a minute' : '') + '.';
  return { decks: changes, folders: folders, rootId: root, summary: summary, failed: failed };
}
