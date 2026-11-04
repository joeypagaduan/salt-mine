// What's new (Phase 6): the newest version's changes in Settings, and every earlier version on its own page.
// Each change is tagged Added, Changed, Fixed or Removed. Add the next version at the top of VERSIONS.
import { esc } from './util.js';
import { APP_VERSION } from './config.js';

export const VERSIONS = [
  { v: '2.0.0', title: 'The Salt Mine', items: [
    ['Changed', 'The app is now called The Salt Mine, and it lives at a new, shorter address. Old links and home-screen icons forward to it.'],
    ['Changed', 'Out of beta: version 2.0.0.']] },
  { v: '2.0.0-alpha.16', title: 'Support the app', items: [
    ['Added', 'Support the app, in Settings > About and account: optional tips through PayPal. Everything stays free.']] },
  { v: '2.0.0-alpha.15', title: 'Privacy note', items: [
    ['Changed', 'The privacy note says the app\u2019s owner can see account emails and game records, to run and support the app.'],
    ['Added', 'The app notes when you last opened it and which version you have (once a day).']] },
  { v: '2.0.0-alpha.14', title: 'Settings, account', items: [
    ['Added', 'Settings is now a menu of sections. On a tablet, the menu stays on the left with the section beside it.'],
    ['Added', 'Delete my account, in Settings > About and account.'],
    ['Added', 'What\u2019s new, with every earlier version.'],
    ['Changed', 'Bigger buttons and text on phones and tablets, so everything is easy to tap.']] },
  { v: '2.0.0-alpha.13', title: 'Back button, help', items: [
    ['Added', 'The phone\u2019s Back button steps back through screens, closes sheets and menus first, and keeps a game in progress.'],
    ['Added', 'A privacy note, and steps for adding the app to a home screen.']] },
  { v: '2.0.0-alpha.12', title: 'Owner controls', items: [
    ['Added', 'For the app\u2019s owner: a game\u2019s edit history with restore, locking games, and bringing back deleted games.'],
    ['Added', 'Choose your deck in Edit game, including on games someone else logged.'],
    ['Added', 'A \u201CNew version ready\u201D banner.'],
    ['Changed', 'Leaving a game you opened without changing it leaves nothing to resume.'],
    ['Changed', 'Only whoever logged a game can delete it.']] },
  { v: '2.0.0-alpha.11', title: 'Shared game fixes', items: [
    ['Fixed', 'Commanders show on shared games, in Recent games and on the edit screen.'],
    ['Added', 'Edit game lists everyone in the pod with their commander.'],
    ['Changed', 'Typing on a phone scrolls the box up so suggestions show above the keyboard.'],
    ['Changed', 'Six quick picks for players, the people you play with most first.'],
    ['Added', 'Playgroup-mates with the same name show their friend codes.']] },
  { v: '2.0.0-alpha.10', title: 'Shared games', items: [
    ['Added', 'Add playgroup-mates to games; they accept or decline them in their inbox.'],
    ['Added', 'Tag your deck when accepting, edit games you\u2019ve accepted, and \u201CThat wasn\u2019t me\u201D.'],
    ['Added', 'Link games: send your games with a typed-in name to that person.'],
    ['Added', 'Hand a playgroup to a new organizer.'],
    ['Removed', 'Delete on games someone else logged (\u201CThat wasn\u2019t me\u201D replaces it).']] },
  { v: '2.0.0-alpha.9', title: 'Playgroups', items: [
    ['Added', 'Playgroups: invite by link, QR code or invite code, and the organizer approves who joins.']] },
  { v: '2.0.0-alpha.8', title: 'Folders like classic', items: [
    ['Added', 'Import from classic can copy classic\u2019s folder settings.'],
    ['Added', 'Every Archidekt folder is listed with its deck count, and more kinds of folder.']] },
  { v: '2.0.0-alpha.7', title: 'Deck refresh fixes', items: [
    ['Fixed', 'Decks moved between Archidekt folders, and decks Archidekt\u2019s search missed, now show up.'],
    ['Added', 'Reload every deck.']] },
  { v: '2.0.0-alpha.6', title: 'Import from classic', items: [
    ['Added', 'Import your games from a download of your classic Sheet, with a preview first. Importing again only adds what\u2019s new.']] },
  { v: '2.0.0-alpha.5', title: 'Stats', items: [
    ['Added', 'Stats for Commander and other formats, and the home screen summary.']] },
  { v: '2.0.0-alpha.4', title: 'Speed', items: [
    ['Changed', 'Opens faster, and copes better with a weak signal.']] },
  { v: '2.0.0-alpha.3', title: 'Life counter', items: [
    ['Added', 'The full life counter from classic.']] },
  { v: '2.0.0-alpha.2', title: 'Games', items: [
    ['Added', 'Game setup, quick logging, results, Recent games, rematch and share.']] },
  { v: '2.0.0-alpha.1', title: 'The start', items: [
    ['Added', 'Sign in with Google, profiles with friend codes, decks from Archidekt or typed in, settings and themes, and offline use.']] }
];
const CLASSIC = [
  ['Added', 'Your games sync across your devices, and playgroups share games between friends.'],
  ['Changed', 'Full screen only applies during a game.'],
  ['Changed', 'The life history\u2019s Graph tab is easier to read.'],
  ['Removed', 'The Google Sheet: your data lives in your account instead (classic keeps working on its own).']
];
const itemsHtml = items => '<ul class="changes">' + items.map(x => '<li><span class="tag ' + x[0].toLowerCase() + '">' + x[0] + '</span><span>' + esc(x[1]) + '</span></li>').join('') + '</ul>';

export function whatsNewHtml() {
  const cur = VERSIONS.find(x => x.v === APP_VERSION) || VERSIONS[0];
  return '<div class="panel"><p style="margin:0"><b>Version ' + esc(cur.v) + '</b> <span class="muted">' + esc(cur.title) + '</span></p>' + itemsHtml(cur.items) + '</div>' +
    '<button class="btn" data-act="changelog">Earlier versions</button>' +
    '<p class="muted supline">Enjoying the updates? <button class="link" data-act="support">Support the app</button></p>';
}
export function viewChangelog() {
  let h = '<header class="top"><button class="link back" data-act="navback">\u2039 Back</button><h3>All versions</h3><span style="width:60px"></span></header>';
  VERSIONS.forEach(x => { h += '<h2>' + esc(x.v.replace('2.0.0-', '')) + ' <small class="muted">' + esc(x.title) + '</small></h2>' + itemsHtml(x.items); });
  h += '<h2>Compared with classic</h2>' + itemsHtml(CLASSIC);
  return h;
}
