// Download my games (2.0.3): every game you've logged, as a CSV file for a spreadsheet. A copy for your own records;
// the app can't read it back in. One row per game from your seat, then each opponent in their own set of columns.
import { S } from './state.js';
import { toast } from './util.js';
import { ordinal, oppName, DRAW_RESULT } from './game.js';

/** One cell: quoted when needed, and never starting like a formula (so a spreadsheet won't run it). */
function cell(v) {
  let t = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}
const won = g => (g.winCondition === 'Other' ? g.winOther || 'Other' : g.winCondition || '');

/** The CSV text for a list of games (oldest first). */
export function gamesCsv(games) {
  const list = games.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.created - b.created);
  const most = list.reduce((n, g) => Math.max(n, (g.opponents || []).length), 0);
  const head = ['Date', 'Format', 'Set', 'Deck', 'Commander', 'Partner', 'Colors', 'Bracket', 'Players', 'Finish', 'Result', 'Match score', 'Play or draw',
    'Rounds', 'Win condition', 'Knocked out by', 'How', 'Round out', 'Notes'];
  for (let i = 1; i <= most; i++) head.push('Opponent ' + i, 'Opponent ' + i + ' commander or deck', 'Opponent ' + i + ' place', 'Opponent ' + i + ' knocked out by', 'Opponent ' + i + ' how', 'Opponent ' + i + ' round out');
  const rows = [head];
  list.forEach(g => {
    const cmd = !g.format || g.format === 'Commander';
    const result = g.draw || g.resultType === DRAW_RESULT ? 'Draw' : +g.myPlace === 1 ? 'Win' : g.myPlace ? 'Loss' : '';
    const r = [g.date, g.format || 'Commander', g.set, g.deckName, cmd ? g.c1 : '', cmd ? g.c2 : '', cmd ? g.colors : g.myColors || g.colors, g.bracket,
      g.podSize, g.myPlace ? ordinal(+g.myPlace) : '', result, g.matchScore, g.playDraw, g.turns, won(g),
      +g.myPlace > 1 ? g.elimBy : '', +g.myPlace > 1 ? g.elimHow : '', +g.myPlace > 1 ? g.myOutRound : '', g.notes];
    for (let i = 0; i < most; i++) {
      const o = (g.opponents || [])[i];
      if (!o) { r.push('', '', '', '', '', ''); continue; }
      r.push(oppName(o, i), cmd ? [o.c1, o.c2].filter(Boolean).join(' + ') : o.deck, o.place ? ordinal(+o.place) : '', o.elimBy, o.elimHow, o.outRound);
    }
    rows.push(r);
  });
  return rows.map(r => r.map(cell).join(',')).join('\r\n');
}

/** Saves the file: the browser's download, which on a phone opens the share or save sheet. */
export function downloadGames() {
  const games = S.games.filter(g => !g.deleted && g.accepted);
  if (!games.length) return toast('No games to download yet.', true);
  const name = 'salt-mine-games-' + new Date().toISOString().slice(0, 10) + '.csv';
  const blob = new Blob(['\ufeff' + gamesCsv(games)], { type: 'text/csv;charset=utf-8' }); // the mark at the start keeps Excel reading names with accents right
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast(games.length + (games.length === 1 ? ' game' : ' games') + ' downloaded');
}
