// A small .xlsx reader, just enough for a downloaded Salt Mine Sheet: every tab, as rows of plain values.
// No library needed: an .xlsx is a zip of XML files, the browser unzips them (DecompressionStream) and reads the XML.
// Numbers come back as numbers (dates stay as spreadsheet serial numbers; see serialToParts), text as text.

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** The files inside a zip, as { name: { method, data } }, from its central directory. */
function zipEntries(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = u16(bytes, eocd + 10), dec = new TextDecoder();
  let p = u32(bytes, eocd + 16);
  const out = {};
  for (let n = 0; n < count; n++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error('bad zip directory');
    const method = u16(bytes, p + 10), size = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28), extraLen = u16(bytes, p + 30), commentLen = u16(bytes, p + 32), local = u32(bytes, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    out[name] = { method: method, data: bytes.subarray(start, start + size) };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
async function unzipText(entry) {
  if (!entry) return null;
  let data = entry.data;
  if (entry.method === 8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('old-browser');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    data = new Uint8Array(await new Response(stream).arrayBuffer());
  } else if (entry.method !== 0) throw new Error('unsupported zip compression');
  return new TextDecoder().decode(data);
}
const xml = s => new DOMParser().parseFromString(s, 'application/xml');
const all = (node, tag) => Array.from(node.getElementsByTagNameNS('*', tag));
/** Text of a shared or inline string, skipping phonetic hints. */
function stringText(si) { return all(si, 't').filter(t => !(t.parentNode && t.parentNode.localName === 'rPh')).map(t => t.textContent).join(''); }
function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return -1;
  let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Reads an .xlsx file (a File, Blob or ArrayBuffer) into { tabName: [[cell, ...], ...] }.
 * Empty cells are null. Throws Error('old-browser') when this browser can't unzip.
 */
export async function readXlsx(file) {
  const buf = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const files = zipEntries(new Uint8Array(buf));
  const find = name => files[name] || files[Object.keys(files).find(k => k.toLowerCase() === name.toLowerCase())];
  const wbText = await unzipText(find('xl/workbook.xml'));
  if (!wbText) throw new Error('not a spreadsheet');
  const relsText = await unzipText(find('xl/_rels/workbook.xml.rels'));
  const targets = {};
  if (relsText) all(xml(relsText), 'Relationship').forEach(r => { targets[r.getAttribute('Id')] = r.getAttribute('Target'); });
  const ssText = await unzipText(find('xl/sharedStrings.xml'));
  const shared = ssText ? all(xml(ssText), 'si').map(stringText) : [];

  const out = {};
  for (const s of all(xml(wbText), 'sheet')) {
    const name = s.getAttribute('name');
    const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id');
    let target = targets[rid] || '';
    target = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const text = await unzipText(find(target));
    if (!text) continue;
    const rows = [];
    all(xml(text), 'row').forEach((row, ri) => {
      const r = (parseInt(row.getAttribute('r'), 10) || ri + 1) - 1, vals = [];
      all(row, 'c').forEach((c, ci) => {
        const i = c.hasAttribute('r') ? colIndex(c.getAttribute('r')) : ci;
        const t = c.getAttribute('t') || 'n', v = all(c, 'v')[0];
        let val = null;
        if (t === 'inlineStr') { const is = all(c, 'is')[0]; val = is ? stringText(is) : ''; }
        else if (v) {
          const raw = v.textContent;
          if (t === 's') val = shared[parseInt(raw, 10)] != null ? shared[parseInt(raw, 10)] : '';
          else if (t === 'b') val = raw === '1';
          else if (t === 'str' || t === 'e' || t === 'd') val = raw;
          else val = raw === '' ? null : (isNaN(+raw) ? raw : +raw);
        }
        if (i >= 0) vals[i] = val;
      });
      for (let k = 0; k < vals.length; k++) if (vals[k] === undefined) vals[k] = null;
      rows[r] = vals;
    });
    for (let k = 0; k < rows.length; k++) if (!rows[k]) rows[k] = [];
    out[name] = rows;
  }
  return out;
}

/** A spreadsheet date number as the clock time written in the Sheet: { y, m (1-12), d, h, mi, s, ms }. */
export function serialToParts(n) {
  const t = new Date(Math.round((n - 25569) * 864e5));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds(), ms: t.getUTCMilliseconds() };
}
