// Help screens (Phase 6): the privacy note, and how to put the app on a home screen (for friends you invite).
import { S, H } from './state.js';
import { esc } from './util.js';
import { SUPPORT_URL } from './config.js';

const top = (back, label, title) => '<header class="top"><button class="link back" data-act="' + back + '">\u2039 ' + label + '</button><h3>' + esc(title) + '</h3><span style="width:60px"></span></header>';
const backTo = () => ['navback', 'Back'];

export function viewPrivacy() {
  const b = backTo();
  return top(b[0], b[1], 'Privacy') + '<div class="prose">' +
    '<p>Salt Mine Beta is a free, unofficial app for tracking Magic: The Gathering games, run by Joey Pagaduan for friends and playgroups. There are no ads, nothing is sold, and the app doesn\u2019t track how you use it.</p>' +
    '<h2>What\u2019s saved</h2><p>Signing in with Google gives the app your name, email address and profile photo. Your profile keeps the display name you choose, your friend code and your photo. The app also saves your games, decks, settings and playgroups so they sync across your devices. It also notes when you last opened the app and which version you have. Everything is stored with Google\u2019s Firebase.</p>' +
    '<h2>Who can see it</h2><ul>' +
    '<li><b>Anyone signed in</b> can see a profile\u2019s display name, friend code and photo. Your email address isn\u2019t shown to other players.</li>' +
    '<li><b>Your games</b> are seen only by the players linked to them. A game someone else logged with you in it waits for you to accept it before it counts for you.</li>' +
    '<li><b>Your decks and settings</b> are only yours. When you accept a game and tag your deck, the others in that game see the deck\u2019s name and commander.</li>' +
    '<li><b>Playgroups</b> are seen by their members. Joining one shares your profile with them.</li>' +
    '<li><b>Joey</b>, who runs the app, can see a shared game\u2019s edit history and lock it, but only for games he played in.</li><li><b>The app\u2019s owner</b> can see account emails and game records to run and support the app.</li></ul>' +
    '<h2>Other services</h2><p>Decks come from Archidekt (only public decks, through a small helper Joey runs), and card names and art from Scryfall.</p>' +
    '<h2>Removing your data</h2><p>Settings > About and account > <b>Delete my account</b> erases your profile, friend code, decks, settings and the games only you played, and takes you out of everything else. Games you played with others stay in their records, with your seat as a typed-in name. This can\u2019t be undone.</p>' +
    '<p class="muted"><small>The Salt Mine is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. \u00a9Wizards of the Coast LLC.</small></p></div>';
}

export function viewInstall() {
  const b = backTo();
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/.test(navigator.userAgent);
  const iosBlock = '<h2>iPhone or iPad</h2><ol class="steps"><li>Open the link in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (the square with an arrow).</li><li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>';
  const androidBlock = '<h2>Android</h2><ol class="steps"><li>Open the link in <b>Chrome</b>.</li><li>Tap <b>\u22ee</b> (top right), then <b>Install app</b> or <b>Add to Home screen</b>.</li><li>In Samsung Internet instead: tap <b>\u2261</b>, then <b>Add page to</b> > <b>Home screen</b>.</li></ol>' +
    '<p class="muted"><small>It shows up as <b>Salt Mine \u03b2</b>. If your phone says it\u2019s already installed but you can\u2019t find it, search your apps for \u201CSalt Mine.\u201D</small></p>';
  return top(b[0], b[1], 'Install') + '<div class="prose">' +
    '<p>Salt Mine Beta works best from your home screen: it opens full screen like an app, and works without a connection at the table.</p>' +
    (android && !ios ? androidBlock + iosBlock : iosBlock + androidBlock) +
    '<h2>Then</h2><p>Open it from the new icon and sign in with Google. If a friend sent you a playgroup invite, open their link once more after signing in.</p></div>';
}

const ACTS = { privacy: 1, install: 1 };
export function onHelpAct(act, el) {
  if (!ACTS[act]) return false;
  S.installBack = el && el.dataset.back ? [el.dataset.back, el.dataset.backLabel || 'Back'] : null;
  H.go(act);
  return true;
}

/* ---------- Support the app (Phase 6d): optional tips, nothing unlocked ---------- */
const SUPPORT_TITLES = ['No Mana Cost', 'Free to Cast', 'Enjoying The Salt Mine?', 'Buy Joey a Booster'];
let supportTitle = '';
/** A different headline each time the screen opens (never the same one twice in a row). */
function pickTitle() {
  let last = -1;
  try { last = Number(localStorage.getItem('smb_support_t')); } catch (e) {}
  let i = Math.floor(Math.random() * SUPPORT_TITLES.length);
  if (i === last) i = (i + 1 + Math.floor(Math.random() * (SUPPORT_TITLES.length - 1))) % SUPPORT_TITLES.length;
  try { localStorage.setItem('smb_support_t', String(i)); } catch (e) {}
  return SUPPORT_TITLES[i];
}
export function openSupport() { supportTitle = pickTitle(); H.go('support'); }
export function viewSupport() {
  if (!supportTitle) supportTitle = pickTitle();
  return '<header class="top"><button class="link back" data-act="navback">\u2039 Back</button><h3>Support the app</h3><span style="width:60px"></span></header>' +
    '<div class="support"><span class="supic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 3v3M12 3v3"/></svg></span>' +
    '<h2>' + esc(supportTitle) + '</h2>' +
    '<p>The Salt Mine is free, and every feature works without paying. I build it in my spare time for our playgroup and anyone else who wants it.</p>' +
    '<p>If it\u2019s made your game nights better, a tip helps with the time it takes and any costs as more people join.</p>' +
    '<a class="btn primary" href="' + esc(SUPPORT_URL) + '" target="_blank" rel="noopener">Tip with PayPal</a>' +
    '<p class="muted"><small>Opens PayPal. Tips don\u2019t unlock anything. Thank you either way.</small></p></div>';
}
