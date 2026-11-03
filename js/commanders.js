// Every legal commander and background, with how each can pair, downloaded from Scryfall and kept on the device.
// Ported from the classic Salt Mine, where the list lived in the Sheet's Commanders tab.
import { store } from './util.js';

const KEY = 'smb_cmds_v1', MAX_AGE = 14 * 24 * 3600 * 1000;
const QUERY = '(is:commander OR t:background) legal:commander';

export const CMD = { list: [], byName: {}, at: 0, loading: null, error: '' };

function index(rows) {
  CMD.list = (rows || []).map(r => ({ n: String(r[0]), ci: String(r[1] || 'C'), p: String(r[2] || ''), pw: String(r[3] || ''), l: String(r[0]).toLowerCase() }));
  CMD.byName = {};
  CMD.list.forEach(c => {
    CMD.byName[c.l] = c;
    // double-faced cards can be typed by their front name alone
    const front = c.l.split(' // ')[0];
    if (front !== c.l && !CMD.byName[front]) CMD.byName[front] = c;
  });
}
(function loadSaved() { const s = store(KEY); if (s && Array.isArray(s.rows)) { index(s.rows); CMD.at = s.at || 0; } })();

/** Figures out how (or whether) a commander can pair with a second one. */
export function pairingFor(card) {
  const text = card.oracle_text || (card.card_faces || []).map(f => f.oracle_text || '').join('\n');
  const type = card.type_line || '', kws = card.keywords || [];
  let m = text.match(/Partner with ([^(\n]+)/);
  if (m) return ['Partner with', m[1].trim()];
  if (/Friends forever/i.test(text)) return ['Friends forever', ''];
  if (/Choose a Background/i.test(text)) return ['Choose a Background', ''];
  if (/Doctor's companion/i.test(text)) return ["Doctor's companion", ''];
  if (/Time Lord Doctor/i.test(type)) return ['Doctor', ''];
  if (/\bBackground\b/.test(type)) return ['Background', ''];
  m = text.match(/Partner\s*[—–-]\s*([^(\n]+)/);
  if (m) return ['Partner group', m[1].trim()];
  if (kws.indexOf('Partner') !== -1 || /^Partner\b/m.test(text)) return ['Partner', ''];
  return ['', ''];
}

const wait = ms => new Promise(r => setTimeout(r, ms));
/**
 * Downloads the list when it's missing or two weeks old (or when forced). About 20 pages, a moment apart,
 * to stay well inside Scryfall's limits. Resolves to a short summary.
 */
export function ensureCommanders(force, onProgress) {
  if (CMD.loading) return CMD.loading;
  if (!force && CMD.list.length && Date.now() - CMD.at < MAX_AGE) return Promise.resolve('');
  if (!navigator.onLine) return Promise.resolve('');
  CMD.loading = (async () => {
    const rows = [];
    let url = 'https://api.scryfall.com/cards/search?q=' + encodeURIComponent(QUERY) + '&unique=oracle&order=name', pages = 0;
    try {
      while (url && pages < 60) {
        pages++;
        const r = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error('Scryfall answered ' + r.status);
        const j = await r.json();
        (j.data || []).forEach(c => { const p = pairingFor(c); rows.push([c.name, (c.color_identity || []).join('') || 'C', p[0], p[1]]); });
        if (onProgress) onProgress(rows.length);
        url = j.has_more ? j.next_page : null;
        if (url) await wait(120);
      }
      if (rows.length) { index(rows); CMD.at = Date.now(); store(KEY, { at: CMD.at, rows: rows }); }
      CMD.error = '';
      return rows.length + ' commanders and backgrounds loaded';
    } catch (e) {
      CMD.error = e.message || String(e);
      throw e;
    } finally { CMD.loading = null; }
  })();
  return CMD.loading;
}

export function searchCmds(q, pred, limit) {
  q = String(q || '').toLowerCase().trim();
  const a = [], b = [], c = [];
  for (const x of CMD.list) {
    if (pred && !pred(x)) continue;
    if (!q) { a.push(x); if (a.length >= limit) break; continue; }
    const i = x.l.indexOf(q);
    if (i === 0) a.push(x);
    else if (i > 0 && /[\s,'-]/.test(x.l[i - 1])) b.push(x);
    else if (i > 0) c.push(x);
    if (a.length >= limit) break;
  }
  return a.concat(b, c).slice(0, limit);
}
export const cmdEntry = name => CMD.byName[String(name || '').toLowerCase().trim()];
export function partnerPredicate(e) {
  if (!e) return null;
  const pw = e.pw.toLowerCase();
  switch (e.p) {
    case 'Partner': return x => x.p === 'Partner' && x.l !== e.l;
    case 'Partner with': return x => pw && (x.l === pw || x.l.startsWith(pw) || pw.startsWith(x.l));
    case 'Friends forever': return x => x.p === 'Friends forever' && x.l !== e.l;
    case 'Choose a Background': return x => x.p === 'Background';
    case 'Background': return x => x.p === 'Choose a Background';
    case "Doctor's companion": return x => x.p === 'Doctor';
    case 'Doctor': return x => x.p === "Doctor's companion";
    case 'Partner group': return x => x.p === 'Partner group' && x.pw.toLowerCase() === pw && x.l !== e.l;
  }
  return null;
}
export function secondLabel(e) {
  if (!e) return '';
  if (e.p === 'Choose a Background') return 'Add a background';
  if (e.p === 'Background') return 'Add the commander';
  if (e.p === 'Doctor') return 'Add a companion';
  if (e.p === "Doctor's companion") return 'Add the Doctor';
  return 'Add a partner';
}
/** Color identity of one or two commanders, like "UR", or '' when unknown. */
export function cmdColors(c1, c2) {
  const set = ((cmdEntry(c1) || {}).ci || '') + ((cmdEntry(c2) || {}).ci || '');
  return ['W', 'U', 'B', 'R', 'G'].filter(l => set.indexOf(l) !== -1).join('') || (set ? 'C' : '');
}
