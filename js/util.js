// Small helpers shared across the app. The theme engine is carried over from the classic Salt Mine 1.13.

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** localStorage with JSON, quietly ignoring private-mode errors. */
export function store(key, val) {
  try {
    if (val === undefined) { const v = localStorage.getItem(key); return v == null ? null : JSON.parse(v); }
    if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val));
  } catch (e) { return null; }
}

export function toast(msg, bad) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.className = bad ? 'bad' : ''; t.style.display = 'block';
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.style.display = 'none'; }, bad ? 5000 : 2600);
}

export function seg(name, values, current, extra) {
  extra = extra || {};
  return '<div class="seg ' + (extra.cls || '') + '">' + values.map(v => {
    const val = typeof v === 'object' ? v.val : v, label = typeof v === 'object' ? v.label : v;
    const on = String(current) === String(val);
    return '<button type="button" data-seg="' + name + '" data-val="' + esc(val) + '" class="' + (on ? 'on' : '') + '" aria-pressed="' + on + '">' + esc(label) + '</button>';
  }).join('') + '</div>';
}

export const MANA = { W: '#E9DDA2', U: '#2E7BC4', B: '#4B4049', R: '#D6452F', G: '#2F8F55', C: '#A8A29E' };
export function manaGradient(ci, dir) {
  const cols = String(ci || 'C').split('').filter(c => MANA[c]).map(c => MANA[c]);
  if (!cols.length) return MANA.C;
  if (cols.length === 1) return cols[0];
  return 'linear-gradient(' + (dir || '180deg') + ',' + cols.join(',') + ')';
}
export function normalizeColors(list) {
  const map = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', w: 'W', u: 'U', b: 'B', r: 'R', g: 'G' }, set = {};
  (list || []).forEach(c => { const l = map[String(c).toLowerCase()]; if (l) set[l] = true; });
  return ['W', 'U', 'B', 'R', 'G'].filter(l => set[l]).join('') || 'C';
}

/* ---------- theme ---------- */
const MANA_ACCENT = { W: '#C9A227', U: '#2E7BC4', B: '#5B3F7A', R: '#D6452F', G: '#2F8F55' };
export const PRESETS = [
  { id: 'salt', name: 'Salt', c1: '#B33C5E', group: 'Classic' },
  { id: 'ocean', name: 'Ocean', c1: '#2F6FB5', group: 'Classic' },
  { id: 'ember', name: 'Ember', c1: '#D0582A', group: 'Classic' },
  { id: 'grove', name: 'Grove', c1: '#2F8F55', group: 'Classic' },
  { id: 'amethyst', name: 'Amethyst', c1: '#7A4FC0', group: 'Classic' },
  { id: 'gold', name: 'Gold', c1: '#B8892A', group: 'Classic' },
  { id: 'slate', name: 'Slate', c1: '#4A5A70', group: 'Classic' },
  { id: 'dusk', name: 'Dusk', c1: '#7A4FC0', c2: '#D0582A', group: 'Classic' }
].concat([['azorius', 'Azorius', 'W', 'U'], ['dimir', 'Dimir', 'U', 'B'], ['rakdos', 'Rakdos', 'B', 'R'], ['gruul', 'Gruul', 'R', 'G'],
  ['selesnya', 'Selesnya', 'G', 'W'], ['orzhov', 'Orzhov', 'W', 'B'], ['izzet', 'Izzet', 'U', 'R'], ['golgari', 'Golgari', 'B', 'G'],
  ['boros', 'Boros', 'R', 'W'], ['simic', 'Simic', 'G', 'U']].map(g => ({ id: g[0], name: g[1], c1: MANA_ACCENT[g[2]], c2: MANA_ACCENT[g[3]], group: 'Guilds' })));

function hexRgb(h) { h = String(h || '#B33C5E').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgbHex(r) { return '#' + r.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
function mix(a, b, t) { const x = hexRgb(a), y = hexRgb(b); return rgbHex(x.map((v, i) => v + (y[i] - v) * t)); }
function lum(h) { const c = hexRgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; }
export function themeColors(settings) {
  const t = (settings && settings.scheme) || { kind: 'preset', id: 'salt' };
  if (t.kind === 'custom') return { c1: t.c1 || '#B33C5E', c2: t.gradient ? (t.c2 || '#2E7BC4') : null };
  const p = PRESETS.find(x => x.id === t.id) || PRESETS[0];
  return { c1: p.c1, c2: p.c2 || null };
}
function paletteCss(c1, c2, dark) {
  const base = dark ? { bg: '#141922', surface: '#1E2530', surface2: '#262E3A', ink: '#E8ECF1', muted: '#9AA5B4', line: '#333C4A' }
                    : { bg: '#EDF0F4', surface: '#FFFFFF', surface2: '#F5F7F9', ink: '#1E2633', muted: '#5B6676', line: '#D3D9E1' };
  const lift = h => dark ? mix(h, '#FFFFFF', lum(h) < .2 ? .45 : .25) : (lum(h) > .45 ? mix(h, '#000000', .35) : h);
  const a1 = lift(c1), a2 = c2 ? lift(c2) : a1;
  const mid = mix(a1, a2, .5), ink = lum(mid) > .35 ? '#16181D' : '#FFFFFF';
  const v = {
    '--bg': mix(base.bg, a1, dark ? .07 : .06), '--surface': mix(base.surface, a1, dark ? .05 : .02), '--surface2': mix(base.surface2, a1, dark ? .07 : .05),
    '--ink': base.ink, '--muted': base.muted, '--line': mix(base.line, a1, .12),
    '--accent': a1, '--accent2': a2, '--accent-ink': ink, '--accent-soft': mix(dark ? base.surface : '#FFFFFF', a1, dark ? .25 : .16),
    '--accent-bg': c2 ? 'linear-gradient(135deg,' + a1 + ',' + a2 + ')' : a1
  };
  return Object.keys(v).map(k => k + ':' + v[k]).join(';') + ';color-scheme:' + (dark ? 'dark' : 'light');
}
export function applyTheme(settings) {
  const t = settings && settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
  const c = themeColors(settings);
  document.getElementById('themevars').textContent =
    ':root{' + paletteCss(c.c1, c.c2, false) + '}' +
    '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){' + paletteCss(c.c1, c.c2, true) + '}}' +
    ':root[data-theme="dark"]{' + paletteCss(c.c1, c.c2, true) + '}';
}
export const schemeSwatch = (c1, c2) => c2 ? 'linear-gradient(135deg,' + c1 + ',' + c2 + ')' : c1;
