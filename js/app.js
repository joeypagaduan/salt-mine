// Salt Mine Beta: the app shell and the Phase 1 screens (sign-in, profile, settings, decks).
// Game screens live in gameui.js, game logic in game.js.
import { APP_VERSION } from './config.js';
import { esc, store, toast, seg, manaGradient, normalizeColors, PRESETS, themeColors, applyTheme, schemeSwatch } from './util.js';
import * as D from './data.js';
import { refreshDecks, parseDeckIds } from './archidekt.js';
import { S } from './state.js';
import { fromRecord, sortGames, withRecords } from './game.js';
import { ensureCommanders } from './commanders.js';
import * as G from './gameui.js';
import * as ST from './stats.js';
import * as IM from './importer.js';
import * as GR from './groups.js';
import * as SH from './shared.js';
GR.takeJoinFromUrl();

const ICON = {
  gear: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  stats: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  recent: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  decks: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linejoin="round"><rect x="6" y="3" width="13" height="17" rx="2"/><path d="M3.5 6.5v12A2.5 2.5 0 0 0 6 21h10"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/></svg>'
};
const TYPE_ORDER = ['Scratch', 'Upgraded', 'Pre-Con'];
const TYPE_NAMES = { Scratch: 'From scratch', Upgraded: 'Upgraded', 'Pre-Con': 'Pre-cons' };
// what a folder can count as (as in classic, plus the kinds classic kept as typed names)
const FOLDER_KINDS = ['Scratch', 'Upgraded', 'Pre-Con', 'Archived', 'Working', 'For Others', 'Shared', 'Unsorted'];
const KIND_NAMES = Object.assign({ 'For Others': 'For others' }, TYPE_NAMES);
const LOGO = 'icons/icon-192.png';

const app = document.getElementById('app');
applyTheme(S.settings);

/* ---------- start-up ---------- */
// With a profile already on this device, the app opens straight to home and checks the account in the background,
// so a weak signal doesn't hold up the launch screen. The first time on a device it waits for the account.
const SPLASH_UNTIL = Date.now() + 900;
D.watchAuth(async (user, err) => {
  if (err) { S.signinError = err; if (!user) return go('signin'); }
  S.unsub.forEach(u => u()); S.unsub = [];
  S.user = user;
  if (!user) { await splashWait(); return go('signin'); }
  const cached = store('smb_profile_' + user.uid);
  S.profile = cached || null;
  startWatching(user);
  if (cached) {
    go('home');
    D.loadProfile(user.uid).then(p => {
      if (!p || S.user !== user) return;
      S.profile = p; store('smb_profile_' + user.uid, p);
      if (S.view === 'home' || S.view === 'settings') rerenderKeep();
    }).catch(() => {});
  } else if (!(await firstProfile(user))) return;
  // the commander list for typing in opponents' commanders: downloads the first time, then every two weeks
  setTimeout(() => ensureCommanders(false).catch(() => {}), 1500);
});
function splashWait() { return new Promise(r => setTimeout(r, Math.max(0, SPLASH_UNTIL - Date.now()))); }
/** First launch on this device: the profile has to come from the account. Returns false when it couldn't. */
async function firstProfile(user) {
  S.profileError = null;
  try {
    S.profile = await D.loadProfile(user.uid);
  } catch (e) {
    // no connection and nothing on this device yet: don't offer to make a new profile over the real one
    S.profileError = e; await splashWait(); go('noconn'); return false;
  }
  await splashWait();
  if (S.user !== user) return false;
  if (!S.profile) { go('welcome'); return false; }
  store('smb_profile_' + user.uid, S.profile);
  go('home');
  return true;
}
/** Live copies of your settings, decks, games, events and the game in progress. */
function startWatching(user) {
  S.unsub.push(D.watchSettings(user.uid, s => {
    if (!s) return;
    S.settings = Object.assign({}, s, D.pendingSettings()); store('smb_settings', S.settings); applyTheme(S.settings);
    if (S.view === 'settings' || S.view === 'decks' || S.view === 'stats') rerenderKeep();
  }));
  S.unsub.push(D.watchDecks(user.uid, list => {
    if (!list) return;
    S.decks = list;
    if (S.view === 'decks' || S.view === 'home' || S.view === 'stats' || (S.view === 'setup' && !S.picker)) rerenderKeep();
  }));
  G.loadLocalDraft();
  S.eventsRaw = []; S.events = [];
  G.loadGamesCache();
  S.unsub.push(D.watchGames(user.uid, list => {
    S.games = sortGames(list.map(x => { const g = fromRecord(x.id, x.data, x.pending); g.doc = x.raw; return g; }));
    S.gamesLoaded = true;
    S.events = withRecords(S.eventsRaw);
    G.saveGamesCache();
    softRender(['home', 'recent', 'stats', 'inbox']);
  }, err => { S.gamesLoaded = true; toast('Couldn\u2019t load your games: ' + (err.code || err.message), true); softRender(['home', 'recent', 'stats']); }));
  S.unsub.push(D.watchEvents(user.uid, list => {
    if (!list) return;
    S.eventsRaw = list; S.events = withRecords(list);
    softRender(['home', 'stats']);
  }));
  S.unsub.push(D.watchDraft(user.uid, G.onRemoteDraft));
  GR.watchGroupsFor(user).forEach(u => S.unsub.push(u));
}
// once playgroup-mates' names arrive, shared games show them instead of the names first typed
G.H.regames = () => {
  if (!S.games.some(g => g.raw && (g.raw.seats || []).some(x => x.uid && x.uid !== uid()))) return;
  S.games = sortGames(S.games.map(g => { if (!g.raw) return g; const n = fromRecord(g.gameId, g.raw, g.pending); n.doc = g.doc; return n; }));
  softRender(['home', 'recent', 'stats', 'inbox']);
};
/** Redraws once per frame at most, however many updates arrive together (a sync can bring many at once). */
let softRaf = 0, softViews = {};
function softRender(views) {
  views.forEach(v => { softViews[v] = true; });
  if (softRaf) return;
  softRaf = requestAnimationFrame(() => {
    const v = softViews; softRaf = 0; softViews = {};
    if (v[S.view]) rerenderKeep();
  });
}

function go(view) {
  if (view !== 'recent') { S.sel = null; S.gameMenu = null; }
  G.lcResetUi();
  if (G.isEditingView(view) && !S.draft) view = 'home';
  // an invite link opened the app: show it once you're signed in with a profile
  if (view === 'home' && S.profile && S.user && GR.pendingJoin()) return;
  S.view = view; S.picker = false; render(); window.scrollTo(0, 0);
}
function render() {
  const views = { loading: viewLoading, signin: viewSignIn, noconn: viewNoConn, welcome: viewWelcome, archsetup: viewArchSetup, home: viewHome, decks: viewDecks, settings: viewSettings,
    setup: G.viewSetup, playing: G.viewPlaying, ending: G.viewEnd, recent: G.viewRecent, stats: ST.viewStats, import: IM.viewImport, groups: GR.viewGroups, group: GR.viewGroup, join: GR.viewJoin, inbox: SH.viewInbox, linkguest: SH.viewLinkGuest };
  if (G.isEditingView(S.view) && !S.draft) S.view = 'home';
  app.innerHTML = (views[S.view] || viewHome)() + (S.picker && S.draft ? G.viewPicker() : '') + (S.form ? viewDeckForm() : '') + (S.sheetDeck ? viewDeckSheet() : '');
  G.afterRender();
  if (S.view === 'stats') ST.afterStats();
}
function rerenderKeep() {
  const y = window.scrollY, a = document.activeElement, id = a && a.id, pos = a && a.selectionStart;
  render(); window.scrollTo(0, y);
  if (id) { const el = document.getElementById(id); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} } }
}

/* ---------- screens ---------- */
function viewLoading() {
  return '<div class="loading splash"><img class="logo-big" src="' + LOGO + '" alt=""><h1>Salt Mine Beta</h1><p class="byline">by Joey Pagaduan</p><p class="byline ver">Version ' + esc(APP_VERSION) + '</p></div>';
}
function viewSignIn() {
  const e = S.signinError;
  return '<div class="loading splash"><img class="logo-big" src="' + LOGO + '" alt=""><h1>Salt Mine Beta</h1><p class="byline">Track your Magic games, synced across your devices.</p>' +
    '<button class="btn primary big" style="max-width:340px;margin:22px auto 0" data-act="signin">Sign in with Google</button>' +
    (e ? '<p class="muted" style="margin-top:14px">Sign-in didn\u2019t finish: ' + esc(e.code || e.message || e) + '</p>' : '') +
    '<p class="muted" style="margin-top:18px"><small>Your games are private to you unless you play them with friends in a playgroup.</small></p></div>';
}
function viewNoConn() {
  const e = S.profileError;
  return '<div class="loading splash"><img class="logo-big" src="' + LOGO + '" alt=""><h1>Can\u2019t reach your account</h1>' +
    '<p class="byline">This is the first time Salt Mine Beta has opened on this device, so it needs a connection once to load your profile. After that it works offline.</p>' +
    '<button class="btn primary big" style="max-width:340px;margin:22px auto 0" data-act="retryprofile"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Trying\u2026' : 'Try again') + '</button>' +
    (e ? '<p class="muted" style="margin-top:14px"><small>' + esc(e.code || e.message || e) + '</small></p>' : '') + '</div>';
}
function viewWelcome() {
  const u = S.user, first = String(u.displayName || '').split(' ')[0];
  const code = D.isOwner(u.uid) ? D.suggestCode(u.uid) : D.codeBase(S.welcomeName || first) + '-####';
  return '<div class="welcome"><img class="logo-big" src="' + LOGO + '" alt=""><h1>Welcome</h1>' +
    '<p class="muted">Pick the name your friends will see at the table.</p>' +
    '<div class="field"><label for="wname">Display name</label><input id="wname" type="text" maxlength="40" value="' + esc(S.welcomeName != null ? S.welcomeName : first) + '" autocomplete="nickname"></div>' +
    '<div class="panel"><span class="label">Your friend code</span><b class="code">' + esc(code) + '</b>' +
    '<p class="muted" style="margin:6px 0 0"><small>' + (D.isOwner(u.uid) ? 'Reserved for you as the app\u2019s owner.' : 'The numbers are picked for you. Friends use this code to find you, and it never changes.') + '</small></p></div>' +
    '<button class="btn primary big" style="margin-top:16px" data-act="makeprofile"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Setting up\u2026' : 'Continue') + '</button></div>';
}
function viewArchSetup() {
  return '<div class="welcome"><h1>Your decks</h1><p class="muted">If your decks are on Archidekt, enter your username and they\u2019ll load automatically. Decks need to be public or unlisted.</p>' +
    '<div class="field"><label for="auser">Archidekt username</label><input id="auser" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc((S.settings.archidekt || {}).username || '') + '"></div>' +
    (S.busy ? '<p class="status">' + esc(S.busy) + '</p>' : '') +
    '<button class="btn primary big" data-act="archload"' + (S.busy ? ' disabled' : '') + '>Load my decks</button>' +
    '<button class="btn" style="margin-top:10px" data-act="home">Skip for now</button>' +
    '<p class="muted" style="margin-top:12px"><small>You can also type in decks, or change this later in Settings.</small></p></div>';
}
function viewHome() {
  const p = S.profile || {}, live = pickerDecks();
  let h = '<header class="top"><span class="brand"><img src="' + LOGO + '" alt=""><h1>Salt Mine <span class="beta">Beta</span></h1></span><button class="icon gear" data-act="settings" aria-label="Settings">' + ICON.gear + '</button></header>';
  h += '<section class="homecard hello">' + avatar(p, S.user) + '<div><b class="cond" style="font-size:24px">Hi, ' + esc(p.name || 'there') + '</b>' +
    '<p class="muted" style="margin:2px 0 0">Friend code <b class="code sm">' + esc(p.code || '') + '</b>' + (D.isOwner(S.user && S.user.uid) ? ' <span class="pill">Owner</span>' : '') + '</p></div></section>';
  h += G.homeGameHtml() + SH.homeInboxHtml();
  const n = G.gameCount();
  h += '<div class="navgrid"><button class="navbtn" data-act="recent">' + ICON.recent + 'Recent games<small class="muted">' + (n == null ? 'Loading\u2026' : n + (n === 1 ? ' game' : ' games')) + '</small></button>' +
    '<button class="navbtn" data-act="decks">' + ICON.decks + 'Decks<small class="muted">' + live.length + ' ready</small></button>' +
    '<button class="navbtn" data-act="stats">' + ICON.stats + 'Stats<small class="muted">' + esc(ST.statsBlurb()) + '</small></button>' +
    '<button class="navbtn" data-act="groups">' + ICON.people + 'Playgroups<small class="muted">' + esc(GR.homeBlurb()) + '</small>' +
    (GR.waitingCount() ? '<span class="dot" aria-hidden="true"></span>' : '') + '</button></div>';
  h += '<p class="muted" style="margin-top:14px;text-align:center"><small>Beta, part 5 of 6. Add playgroup-mates to your games and they get them to accept. Bring classic games over in Settings > Data. Your classic Salt Mine keeps working as usual.</small></p>';
  if (!navigator.onLine) h += '<p class="muted" style="margin-top:6px;text-align:center"><small>Offline. Changes save on this device and sync when you\u2019re back online.</small></p>';
  return h;
}
function avatar(p, user) {
  const photo = (p && p.photo) || (user && user.photoURL);
  const letter = String((p && p.name) || 'S').charAt(0).toUpperCase();
  return photo ? '<img class="avatar" src="' + esc(photo) + '" alt="" referrerpolicy="no-referrer">' : '<span class="avatar">' + esc(letter) + '</span>';
}

/* ---------- decks ---------- */
const folders = () => ((S.settings.archidekt || {}).folders) || {};
function deckInfo(d) {
  if (d.source === 'typed') return { type: d.type || 'Scratch', show: !d.retired, folder: 'Typed in' };
  const f = folders()[d.folderId];
  return { type: f ? f.type : 'Unsorted', show: d.status === 'ok' && !!(f && f.show), folder: f ? f.name : (d.folderId ? 'Folder ' + d.folderId : 'No folder') };
}
const pickerDecks = () => S.decks.filter(d => deckInfo(d).show);
function deckCard(d) {
  const i = deckInfo(d);
  return '<button class="deck" data-act="opendeck" data-id="' + esc(d.id) + '"><span class="stripe" style="background:' + manaGradient(d.colors) + '"></span>' +
    '<span class="txt"><span class="name">' + esc(d.name) + '</span><span class="cmd">' + esc([d.c1, d.c2].filter(Boolean).join(' + ') || i.type) + '</span></span>' +
    (d.bracket !== '' && d.bracket != null ? '<span class="badge">B' + esc(d.bracket) + '</span>' : '') + '</button>';
}
function deckListHtml() {
  const q = S.deckQ.toLowerCase().trim();
  const match = d => !q || (d.name + ' ' + (d.c1 || '') + ' ' + (d.c2 || '')).toLowerCase().indexOf(q) !== -1;
  const shown = S.decks.filter(d => deckInfo(d).show && match(d)), hidden = S.decks.filter(d => !deckInfo(d).show && match(d));
  if (!S.decks.length) return '<p class="muted">No decks yet. Load them from Archidekt or type one in.</p>';
  let h = '';
  const groups = {};
  shown.forEach(d => { const t = deckInfo(d).type; (groups[t] = groups[t] || []).push(d); });
  Object.keys(groups).sort((a, b) => (TYPE_ORDER.indexOf(a) + 1 || 99) - (TYPE_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b)).forEach(t => {
    h += '<h2>' + esc(TYPE_NAMES[t] || t) + ' <small class="muted">' + groups[t].length + '</small></h2>' + groups[t].sort((a, b) => a.name.localeCompare(b.name)).map(deckCard).join('');
  });
  if (!shown.length && q) h += '<p class="muted">No decks in the picker match \u201C' + esc(S.deckQ) + '\u201D.</p>';
  if (hidden.length) {
    h += '<details class="collapse" id="hiddendecks"' + (S.open.hiddendecks ? ' open' : '') + '><summary><h2 style="display:inline">Not in the picker <small class="muted">' + hidden.length + '</small></h2></summary>' +
      '<p class="muted"><small>Decks in folders you\u2019ve hidden (like Archived), retired typed-in decks, and decks no longer on Archidekt. They still count in your stats.</small></p>' +
      hidden.sort((a, b) => a.name.localeCompare(b.name)).map(deckCard).join('') + '</details>';
  }
  return h;
}
function viewDecks() {
  const a = S.settings.archidekt || {};
  let h = '<header class="top"><button class="link back" data-act="home">\u2039 Home</button><h3>Decks</h3><span style="width:60px"></span></header>';
  h += '<input type="search" id="deckq" placeholder="Search by deck or commander" value="' + esc(S.deckQ) + '" autocomplete="off">';
  h += '<div class="row" style="margin-top:10px">' + (a.username ? '<button class="btn" data-act="refresh"' + (S.busy ? ' disabled' : '') + '>Refresh from Archidekt</button>' : '<button class="btn" data-act="archsetup">Connect Archidekt</button>') +
    '<button class="btn" data-act="newdeck">+ Type in a deck</button></div>';
  if (S.busy) h += '<p class="status">' + esc(S.busy) + '</p>';
  else if (a.lastSummary) h += '<p class="muted" style="margin:8px 0 0"><small>Last refresh ' + esc(niceWhen(a.lastRefresh)) + ': ' + esc(a.lastSummary) + '</small></p>';
  h += '<div id="decklist">' + deckListHtml() + '</div>';
  return h;
}
function niceWhen(t) {
  if (!t) return '';
  const d = new Date(t), mins = Math.round((Date.now() - t) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return mins + ' minutes ago';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function viewDeckSheet() {
  const d = S.decks.find(x => x.id === S.sheetDeck);
  if (!d) return '';
  const i = deckInfo(d);
  let h = '<div class="overlay" role="dialog" aria-label="' + esc(d.name) + '"><div class="inner"><div class="top"><h3>' + esc(d.name) + '</h3><button class="link" data-act="closesheet">Close</button></div>' +
    '<div class="deckhero" style="background:' + manaGradient(d.colors, '135deg') + '"></div>' +
    '<dl class="facts"><dt>Commander' + (d.c2 ? 's' : '') + '</dt><dd>' + esc([d.c1, d.c2].filter(Boolean).join(' + ') || 'None set') + '</dd>' +
    '<dt>Bracket</dt><dd>' + (d.bracket !== '' && d.bracket != null ? esc(d.bracket) + (d.bracketSource ? ' <small class="muted">(' + esc(d.bracketSource) + ')</small>' : '') : 'Not set') + '</dd>' +
    '<dt>Kind</dt><dd>' + esc(TYPE_NAMES[i.type] || i.type) + (d.source === 'archidekt' ? ' <small class="muted">(folder: ' + esc(i.folder) + ')</small>' : '') + '</dd>' +
    '<dt>In the picker</dt><dd>' + (i.show ? 'Yes' : 'No' + (d.status === 'missing' ? ' (no longer on Archidekt)' : d.retired ? ' (retired)' : ' (folder is hidden)')) + '</dd></dl>';
  if (d.source === 'archidekt') h += '<a class="btn" href="' + esc(d.url) + '" target="_blank" rel="noopener">Open on Archidekt</a><p class="muted"><small>Change a folder\u2019s kind, or hide it from the picker, in Settings under Archidekt.</small></p>';
  else h += '<button class="btn" data-act="editdeck" data-id="' + esc(d.id) + '">Edit</button><button class="btn" style="margin-top:8px" data-act="retiredeck" data-id="' + esc(d.id) + '">' + (d.retired ? 'Put back in the picker' : 'Retire (hide from the picker)') + '</button>';
  return h + '</div></div>';
}
function viewDeckForm() {
  const f = S.form;
  return '<div class="overlay" role="dialog" aria-label="Type in a deck"><div class="inner"><div class="top"><h3>' + (f.id ? 'Edit deck' : 'Type in a deck') + '</h3><button class="link" data-act="closeform">Cancel</button></div>' +
    '<div class="field"><label for="fname">Deck name</label><input id="fname" type="text" maxlength="60" value="' + esc(f.name) + '" autocomplete="off"></div>' +
    '<div class="field ta"><label for="fc1">Commander</label><input id="fc1" type="text" data-ac="c1" value="' + esc(f.c1) + '" autocomplete="off" placeholder="Start typing a card name"><ul class="ta-list" hidden></ul></div>' +
    '<div class="field ta"><label for="fc2">Partner or background (optional)</label><input id="fc2" type="text" data-ac="c2" value="' + esc(f.c2) + '" autocomplete="off"><ul class="ta-list" hidden></ul></div>' +
    '<div class="field"><span class="label">Kind</span>' + seg('ftype', TYPE_ORDER.map(t => ({ val: t, label: TYPE_NAMES[t] })), f.type) + '</div>' +
    '<div class="field"><span class="label">Bracket (optional)</span>' + seg('fbracket', [1, 2, 3, 4, 5], f.bracket) + '</div>' +
    '<button class="btn primary" data-act="savedeck"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Saving\u2026' : 'Save deck') + '</button></div></div>';
}

/* ---------- settings ---------- */
function viewSettings() {
  const p = S.profile || {}, st = S.settings, sc = st.scheme || { kind: 'preset', id: 'salt' }, a = st.archidekt || {};
  let h = '<header class="top"><button class="link back" data-act="home">\u2039 Home</button><h3>Settings</h3><span style="width:60px"></span></header>';
  h += '<h2>You</h2><div class="panel"><div class="row" style="align-items:center">' + avatar(p, S.user) +
    '<div style="flex:1"><label for="pname" class="label">Display name</label><input id="pname" type="text" maxlength="40" value="' + esc(p.name || '') + '"></div></div>' +
    '<p style="margin:12px 0 0">Friend code <b class="code sm">' + esc(p.code || '') + '</b> <button class="link" data-act="copycode">Copy</button>' + (D.isOwner(S.user.uid) ? ' <span class="pill">Owner</span>' : '') + '</p></div>';
  h += ST.settingsStatsHtml();

  h += '<details class="collapse" id="appearsec"' + (S.open.appearsec ? ' open' : '') + '><summary><h2 style="display:inline">Appearance</h2></summary>';
  h += '<div class="field"><span class="label">Light or dark</span>' + seg('theme', [{ val: 'system', label: 'Match device' }, { val: 'light', label: 'Light' }, { val: 'dark', label: 'Dark' }], st.theme || 'system') + '</div>';
  ['Classic', 'Guilds'].forEach(g => {
    h += '<span class="label">' + (g === 'Classic' ? 'Color schemes' : 'Guild pairs') + '</span><div class="swatches">' +
      PRESETS.filter(x => x.group === g).map(x => '<button class="swatch' + (sc.kind !== 'custom' && sc.id === x.id ? ' on' : '') + '" data-act="preset" data-val="' + x.id + '"><i style="background:' + schemeSwatch(x.c1, x.c2) + '"></i><span>' + esc(x.name) + '</span></button>').join('') + '</div>';
  });
  const tc = themeColors(st), cc = sc.kind === 'custom' ? sc : { c1: tc.c1, c2: tc.c2 || '#2E7BC4', gradient: !!tc.c2 };
  const grad = sc.kind === 'custom' ? sc.gradient : cc.gradient;
  h += '<span class="label" style="margin-top:14px">Your own colors</span><div class="panel">' +
    seg('custgrad', [{ val: 'solid', label: 'Solid' }, { val: 'grad', label: 'Gradient' }], sc.kind === 'custom' ? (sc.gradient ? 'grad' : 'solid') : '') +
    '<div class="row" style="margin-top:12px;align-items:center"><label class="colorpick">Color 1<input type="color" data-cust="c1" value="' + esc(cc.c1) + '"></label>' +
    (grad ? '<label class="colorpick">Color 2<input type="color" data-cust="c2" value="' + esc(cc.c2) + '"></label>' : '<span></span>') +
    '<span class="swatchbig" style="background:' + schemeSwatch(cc.c1, grad ? cc.c2 : null) + '"></span></div></div></details>';

  h += '<details class="collapse" id="archsec"' + (S.open.archsec ? ' open' : '') + '><summary><h2 style="display:inline">Archidekt</h2></summary>' +
    '<div class="field"><label for="suser">Archidekt username</label><input id="suser" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(a.username || '') + '"></div>' +
    '<div class="field"><label for="sextra">Extra deck links (optional)</label><textarea id="sextra" rows="2" placeholder="Unlisted decks: paste their Archidekt links">' + esc((a.extraIds || []).map(id => 'https://archidekt.com/decks/' + id).join('\n')) + '</textarea></div>' +
    '<button class="btn" data-act="savearch">Save and refresh decks</button>' +
    '<button class="link" style="display:block;margin-top:10px" data-act="reloadall">Reload every deck</button>' +
    '<p class="muted" style="margin-top:4px"><small>Loads every deck again in full, in case one shows the wrong folder, commander or bracket.' +
    (a.lastSummary ? ' Last refresh: ' + esc(a.lastSummary) : '') + '</small></p>';
  // folders in the picker first, then the rest, your Archidekt home folder last; each with how many decks it holds now
  const fl = folders(), counts = {};
  S.decks.forEach(d => { if (d.source !== 'typed' && d.status !== 'missing' && d.folderId) counts[d.folderId] = (counts[d.folderId] || 0) + 1; });
  const fids = Object.keys(fl).sort((x, y) => (x === a.rootId) - (y === a.rootId) || (!!fl[y].show - !!fl[x].show) ||
    (TYPE_ORDER.indexOf(fl[x].type) + 1 || 99) - (TYPE_ORDER.indexOf(fl[y].type) + 1 || 99) || fl[x].name.localeCompare(fl[y].name));
  if (fids.length) {
    h += '<span class="label" style="margin-top:16px">Folders</span><p class="muted" style="margin-top:0"><small>What kind of decks each folder holds, and whether they show in the deck picker. New folders on Archidekt show up here after a refresh.</small></p>';
    fids.forEach(id => {
      const f = fl[id], kinds = FOLDER_KINDS, cur = kinds.indexOf(f.type) === -1 ? 'other' : f.type, n = counts[id] || 0;
      h += '<div class="panel folderrow"><div class="sline"><b>' + esc(f.name) + (id === a.rootId ? ' <span class="muted">(home folder)</span>' : '') + '</b><span class="muted">' + n + (n === 1 ? ' deck' : ' decks') + '</span></div>' +
        '<div class="row" style="margin-top:8px;align-items:center">' +
        '<select data-folder="' + esc(id) + '" aria-label="Kind of decks in ' + esc(f.name) + '">' + kinds.map(k => '<option value="' + k + '"' + (cur === k ? ' selected' : '') + '>' + esc(KIND_NAMES[k] || k) + '</option>').join('') +
        (cur === 'other' ? '<option value="other" selected>' + esc(f.type) + '</option>' : '') + '</select>' +
        '<label class="check"><input type="checkbox" data-fshow="' + esc(id) + '"' + (f.show ? ' checked' : '') + '> In the picker</label></div></div>';
    });
  }
  h += '</details>';

  h += G.settingsGameHtml();
  h += '<h2>About</h2><div class="panel"><p style="margin:0">Salt Mine Beta, version ' + esc(APP_VERSION) + '</p>' +
    '<p class="muted" style="margin:4px 0 0">Signed in as ' + esc(S.user.email) + '</p>' +
    '<button class="btn" style="margin-top:12px" data-act="signout">Sign out</button></div>' +
    '<p class="muted" style="margin-top:14px"><small>Card data and images come from Scryfall and Archidekt. The Salt Mine is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. \u00A9Wizards of the Coast LLC.</small></p>';
  return h;
}

/* ---------- actions ---------- */
const uid = () => S.user && S.user.uid;
Object.assign(G.H, {
  go: go, render: render, rerenderKeep: () => { const y = window.scrollY; render(); window.scrollTo(0, y); }, setSettings: patch => setSettings(patch),
  pickerDecks: pickerDecks, deckType: d => deckInfo(d).type,
  newDeck: fromPicker => { S.form = { name: '', c1: '', c2: '', type: 'Scratch', bracket: '', fromPicker: !!fromPicker }; rerenderKeep(); }
});
const setSettings = patch => { Object.assign(S.settings, patch); store('smb_settings', S.settings); D.saveSettings(uid(), patch); };

/** Gives up on a step that needs the internet if it takes too long (a weak signal can leave it waiting). */
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('The connection is too slow right now. Try again in a moment.')), ms))]);
}
async function doRefresh(username, force) {
  if (!navigator.onLine) { toast('You\u2019re offline. Refresh your decks once you\u2019re back online.', true); return null; }
  const a = Object.assign({}, S.settings.archidekt || {});
  if (username != null) a.username = username;
  S.busy = 'Starting\u2026'; rerenderKeep();
  try {
    const res = await refreshDecks({ username: a.username, extraIds: a.extraIds || [], existing: S.decks, folders: a.folders || {}, rootId: a.rootId || '', force: !!force,
      onProgress: msg => { S.busy = msg; const el = document.querySelector('.status'); if (el) el.textContent = msg; } });
    if (res.decks.length) { S.busy = 'Saving\u2026'; await D.saveDecks(uid(), res.decks); }
    a.folders = res.folders; a.rootId = res.rootId; a.lastRefresh = Date.now(); a.lastSummary = res.summary;
    setSettings({ archidekt: a });
    S.busy = ''; toast(res.summary);
    return res;
  } catch (err) {
    S.busy = ''; toast(err.message || String(err), true); rerenderKeep();
    return null;
  }
}

app.addEventListener('click', async e => {
  const lcBtn = e.target.closest('[data-lc]');
  if (lcBtn) return G.lcClick(lcBtn);
  const el = e.target.closest('[data-act],[data-seg]');
  if (!el) return;
  if (el.dataset.seg) return onSeg(el.dataset.seg, el.dataset.val);
  const act = el.dataset.act;
  if (ST.onStatsAct(act, el) || IM.onImportAct(act, el) || GR.onGroupsAct(act, el) || SH.onSharedAct(act, el) || G.onAct(act, el) || G.onSettingsAct(act, el)) return;
  switch (act) {
    case 'signin':
      S.signinError = null;
      try { await D.signIn(); } catch (err) { S.signinError = err; render(); }
      return;
    case 'signout':
      if (confirm('Sign out of Salt Mine Beta on this device?')) { D.flushSettings(uid()); G.clearGamesCache(); await D.signOut(); store('smb_settings', null); }
      return;
    case 'retryprofile': {
      S.busy = 'trying'; render();
      const user = S.user, ok = await firstProfile(user);
      S.busy = ''; if (S.view === 'noconn') render();
      if (ok) setTimeout(() => ensureCommanders(false).catch(() => {}), 1500);
      return;
    }
    case 'makeprofile': {
      const name = document.getElementById('wname').value.trim();
      if (!name) return toast('Pick a display name first.', true);
      if (!navigator.onLine) return toast('You need a connection to set up your profile. Try again once you\u2019re online.', true);
      S.busy = 'saving'; render();
      try { S.profile = await withTimeout(D.createProfile(S.user, name), 20000); store('smb_profile_' + uid(), S.profile); S.busy = ''; go('archsetup'); }
      catch (err) { S.busy = ''; render(); toast('Couldn\u2019t set up your profile: ' + (err.code || err.message), true); }
      return;
    }
    case 'archload': {
      const u = document.getElementById('auser').value.trim();
      if (!u) return toast('Enter your Archidekt username, or skip for now.', true);
      const res = await doRefresh(u);
      if (res) go('decks');
      return;
    }
    case 'archsetup': return go('archsetup');
    case 'home': case 'decks': case 'settings': S.form = null; S.sheetDeck = null; return go(act);
    case 'refresh': return doRefresh();
    case 'reloadall': {
      const username = document.getElementById('suser').value.trim();
      if (!username && !((S.settings.archidekt || {}).extraIds || []).length) return toast('Enter your Archidekt username first.', true);
      return doRefresh(username, true);
    }
    case 'opendeck': S.sheetDeck = el.dataset.id; return rerenderKeep();
    case 'closesheet': S.sheetDeck = null; return rerenderKeep();
    case 'newdeck': S.form = { name: '', c1: '', c2: '', type: 'Scratch', bracket: '' }; return rerenderKeep();
    case 'editdeck': { const d = S.decks.find(x => x.id === el.dataset.id); S.sheetDeck = null; S.form = { id: d.id, name: d.name, c1: d.c1 || '', c2: d.c2 || '', type: d.type || 'Scratch', bracket: d.bracket == null ? '' : d.bracket }; return rerenderKeep(); }
    case 'closeform': S.form = null; return rerenderKeep();
    case 'savedeck': return saveTypedDeck();
    case 'retiredeck': { const d = S.decks.find(x => x.id === el.dataset.id); D.saveDeck(uid(), { id: d.id, retired: !d.retired }).catch(() => {}); S.sheetDeck = null; toast(d.retired ? 'Back in the picker' : 'Retired'); return rerenderKeep(); }
    case 'preset': setSettings({ scheme: { kind: 'preset', id: el.dataset.val } }); applyTheme(S.settings); return rerenderKeep();
    case 'copycode': try { await navigator.clipboard.writeText(S.profile.code); toast('Copied'); } catch (err) { window.prompt('Your friend code:', S.profile.code); } return;
    case 'savearch': {
      const username = document.getElementById('suser').value.trim();
      const extraIds = parseDeckIds(document.getElementById('sextra').value);
      setSettings({ archidekt: Object.assign({}, S.settings.archidekt || {}, { username: username, extraIds: extraIds }) });
      if (!username && !extraIds.length) return toast('Saved');
      return doRefresh(username);
    }
  }
});
function onSeg(name, val) {
  if (ST.onStatsSeg(name, val)) return;
  if (G.isEditingView(S.view) && G.onSegG(name, val)) return;
  if (G.onSettingsSeg(name, val)) return;
  if (name === 'theme') { setSettings({ theme: val }); applyTheme(S.settings); return rerenderKeep(); }
  if (name === 'custgrad') {
    const tc = themeColors(S.settings), cur = S.settings.scheme && S.settings.scheme.kind === 'custom' ? S.settings.scheme : { c1: tc.c1, c2: tc.c2 || '#2E7BC4' };
    setSettings({ scheme: { kind: 'custom', c1: cur.c1, c2: cur.c2 || '#2E7BC4', gradient: val === 'grad' } }); applyTheme(S.settings); return rerenderKeep();
  }
  if (name === 'ftype') { S.form.type = val; return rerenderKeep(); }
  if (name === 'fbracket') { S.form.bracket = String(S.form.bracket) === String(val) ? '' : +val; return rerenderKeep(); }
}
app.addEventListener('toggle', e => { if (e.target.id) S.open[e.target.id] = e.target.open; }, true);
app.addEventListener('input', e => {
  const t = e.target;
  if (G.onInputG(t) || G.onSettingsInput(t)) return;
  if (t.id === 'deckq') { S.deckQ = t.value; document.getElementById('decklist').innerHTML = deckListHtml(); return; }
  if (t.id === 'wname') { S.welcomeName = t.value; const c = document.querySelector('.welcome .code'); if (c && !D.isOwner(uid())) c.textContent = D.codeBase(t.value) + '-####'; return; }
  if (t.dataset.cust) {
    const tc = themeColors(S.settings), cur = S.settings.scheme && S.settings.scheme.kind === 'custom' ? S.settings.scheme : { c1: tc.c1, c2: tc.c2 || '#2E7BC4', gradient: !!tc.c2 };
    S.settings.scheme = Object.assign({}, cur, { kind: 'custom', [t.dataset.cust]: t.value });
    applyTheme(S.settings);
    const big = document.querySelector('.swatchbig'); if (big) big.style.background = schemeSwatch(S.settings.scheme.c1, S.settings.scheme.gradient ? S.settings.scheme.c2 : null);
    clearTimeout(S._ct); S._ct = setTimeout(() => setSettings({ scheme: S.settings.scheme }), 400);
    return;
  }
  if (t.dataset.ac) return autocomplete(t);
  if (S.form && /^f(name|c1|c2)$/.test(t.id)) S.form[{ fname: 'name', fc1: 'c1', fc2: 'c2' }[t.id]] = t.value;
});
app.addEventListener('change', e => {
  const t = e.target;
  if (ST.onStatsChange(t) || SH.onSharedChange(t) || IM.onImportChange(t) || G.onChangeG(t) || G.onSettingsChange(t)) return;
  if (t.id === 'pname') {
    const name = t.value.trim(); if (!name || name === S.profile.name) return;
    S.profile.name = name; store('smb_profile_' + uid(), S.profile);
    D.renameProfile(uid(), name).catch(() => {}); return toast('Name saved');
  }
  if (t.dataset.folder || t.dataset.fshow) {
    const a = Object.assign({}, S.settings.archidekt || {}), fl = Object.assign({}, a.folders || {}), id = t.dataset.folder || t.dataset.fshow;
    const f = Object.assign({}, fl[id]);
    if (t.dataset.folder && t.value !== 'other') { f.type = t.value; f.show = TYPE_ORDER.indexOf(t.value) !== -1; }
    if (t.dataset.fshow) f.show = t.checked;
    fl[id] = f; a.folders = fl; setSettings({ archidekt: a }); return rerenderKeep();
  }
});

/* ---------- typed-in decks ---------- */
let acTimer = null;
function autocomplete(input) {
  const list = input.parentElement.querySelector('.ta-list'), q = input.value.trim();
  clearTimeout(acTimer);
  if (q.length < 2) { list.hidden = true; return; }
  acTimer = setTimeout(async () => {
    try {
      const r = await fetch('https://api.scryfall.com/cards/autocomplete?q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' } });
      const j = await r.json();
      const names = (j.data || []).slice(0, 8);
      if (!names.length) { list.hidden = true; return; }
      list.innerHTML = names.map(n => '<li data-pick="' + esc(n) + '">' + esc(n) + '</li>').join('');
      list.hidden = false;
    } catch (e) { list.hidden = true; }
  }, 200);
}
app.addEventListener('pointerdown', e => {
  const li = e.target.closest('[data-pick]');
  if (!li) { document.querySelectorAll('.ta-list').forEach(l => { if (!l.contains(e.target)) l.hidden = true; }); return; }
  e.preventDefault();
  const input = li.closest('.ta').querySelector('input');
  input.value = li.dataset.pick;
  S.form[input.dataset.ac] = li.dataset.pick;
  li.parentElement.hidden = true;
});
async function cardColors(name) {
  if (!name) return [];
  try {
    const r = await fetch('https://api.scryfall.com/cards/named?exact=' + encodeURIComponent(name), { headers: { Accept: 'application/json' } });
    if (!r.ok) return [];
    return (await r.json()).color_identity || [];
  } catch (e) { return []; }
}
async function saveTypedDeck() {
  const f = S.form;
  f.name = document.getElementById('fname').value.trim(); f.c1 = document.getElementById('fc1').value.trim(); f.c2 = document.getElementById('fc2').value.trim();
  if (!f.name && !f.c1) return toast('Give the deck a name or a commander.', true);
  S.busy = 'saving'; rerenderKeep();
  const colors = normalizeColors((await cardColors(f.c1)).concat(await cardColors(f.c2)));
  const deck = { id: f.id || 't-' + Date.now().toString(36), source: 'typed', name: f.name || f.c1, c1: f.c1, c2: f.c2, colors: f.c1 ? colors : 'C',
    type: f.type, bracket: f.bracket === '' ? '' : +f.bracket, bracketSource: f.bracket === '' ? '' : 'Set by you', retired: false, status: 'ok' };
  D.saveDeck(uid(), deck).catch(() => {}); // saves on this device right away, and syncs when online
  if (f.fromPicker && S.draft) {
    if (!S.decks.some(x => x.id === deck.id)) S.decks.push(deck);
    S.draft.deckId = deck.id; S.draft.deckName = deck.name; G.touch();
  }
  S.busy = ''; S.form = null; toast(f.id ? 'Deck updated' : 'Deck added'); rerenderKeep();
}

// Closing the app or switching away sends anything still waiting a moment to be sent (settings, the game in progress).
function flushAll() { if (!S.user) return; D.flushSettings(uid()); G.flushDraft(); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
window.addEventListener('pagehide', flushAll);
window.addEventListener('online', () => { if (S.view === 'home') rerenderKeep(); });
window.addEventListener('offline', () => { if (S.view === 'home') rerenderKeep(); });
render();

/* ---------- works offline: cache the app's files ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
