// Salt Mine Beta, Phase 0 setup check
import { APP_VERSION, firebaseConfig, RELAY_URL, ARCHIDEKT_USERNAME } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut }
  from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, doc, setDoc, getDoc, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function mark(id, state, html) { const c = $('c-' + id); c.className = 'check ' + state; if (html != null) $('d-' + id).innerHTML = html; }

/* ---------- 1. the app itself ---------- */
const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const ua = navigator.userAgent, ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
$('ver').textContent = 'version ' + APP_VERSION;
mark('app', 'ok', 'Running ' + (standalone ? '<b>from the home screen</b>' : '<b>in the browser</b>') + (ios ? ' on iOS' : /Android/.test(ua) ? ' on Android' : '') + '.');

/* ---------- 2. sign-in ---------- */
let app, auth, db;
try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (err) {
  mark('signin', 'bad', 'Firebase didn\u2019t start: <code>' + esc(err.message) + '</code>');
}
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

if (auth) {
  getRedirectResult(auth).catch(err => showSignInError(err, 'redirect'));
  onAuthStateChanged(auth, user => {
    $('b-signin').hidden = !!user; $('b-signout').hidden = !user; $('b-copy').hidden = !user;
    if (!user) {
      if (!$('c-signin').classList.contains('bad')) mark('signin', 'todo', 'Tap the button. On an iPhone or iPad, also try this after adding the page to your home screen.');
      mark('db', 'todo', 'Runs after you sign in.');
      return;
    }
    mark('signin', 'ok', 'Signed in as <b>' + esc(user.displayName || user.email) + '</b> (' + esc(user.email) + ').<br>Account ID: <code id="uid">' + esc(user.uid) + '</code><br>Phase 1 needs this ID to make you the app\u2019s owner.');
    checkDatabase(user);
  });
}
function showSignInError(err, how) {
  const code = (err && err.code) || '', msg = (err && err.message) || String(err);
  let hint = '';
  if (code === 'auth/unauthorized-domain') hint = 'Add <code>' + esc(location.hostname) + '</code> under Authentication > Settings > Authorized domains in Firebase.';
  else if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') hint = 'The sign-in window was closed before finishing. Try again.';
  else if (ios && standalone) hint = 'This is the iPhone home screen issue the plan mentions. Send me this message and I\u2019ll fix it in Phase 1.';
  mark('signin', 'bad', 'Sign-in didn\u2019t work (' + how + '): <code>' + esc(code || msg) + '</code>' + (hint ? '<br>' + hint : ''));
}
$('b-signin').addEventListener('click', async () => {
  if (!auth) return;
  $('b-signin').disabled = true;
  mark('signin', 'wait', 'Opening Google sign-in\u2026');
  try { await signInWithPopup(auth, provider); }
  catch (err) {
    // Popups can be blocked, especially from a home screen app; fall back to a full-page redirect
    if (/popup-blocked|operation-not-supported|web-storage-unsupported/.test(err.code || '')) {
      try { await signInWithRedirect(auth, provider); return; } catch (e2) { showSignInError(e2, 'redirect'); }
    } else showSignInError(err, 'popup');
  } finally { $('b-signin').disabled = false; }
});
$('b-signout').addEventListener('click', () => signOut(auth));
$('b-copy').addEventListener('click', async () => {
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) return;
  try { await navigator.clipboard.writeText(uid); $('b-copy').textContent = 'Copied'; }
  catch (e) { window.prompt('Copy your account ID:', uid); }
  setTimeout(() => { $('b-copy').textContent = 'Copy my account ID'; }, 1800);
});

/* ---------- 3. the database and its privacy rules ---------- */
async function checkDatabase(user) {
  mark('db', 'wait', 'Saving a test note to your account\u2026');
  try {
    const note = doc(db, 'users', user.uid, 'checks', 'phase0');
    const stamp = Date.now();
    await setDoc(note, { stamp: stamp, at: serverTimestamp(), device: (ios ? 'iOS' : /Android/.test(ua) ? 'Android' : 'computer') + (standalone ? ', home screen' : ', browser') });
    const back = await getDoc(note);
    if (!back.exists() || back.data().stamp !== stamp) throw new Error('The note didn\u2019t read back the same.');
    // Someone else's data must be refused
    let blocked = false;
    try { await getDoc(doc(db, 'users', 'someone-else', 'checks', 'phase0')); }
    catch (err) { blocked = /permission/i.test(err.code || err.message || ''); }
    if (!blocked) return mark('db', 'bad', 'Saving works, but <b>another account\u2019s data wasn\u2019t blocked</b>. Check the Rules tab in Firestore against the rules in the setup steps.');
    mark('db', 'ok', 'Saved and read back a note in your account, and other people\u2019s data is blocked.');
  } catch (err) {
    const code = err.code || '';
    mark('db', 'bad', 'The database check failed: <code>' + esc(code || err.message) + '</code>' +
      (/permission/i.test(code) ? '<br>The rules may not be published yet: Firestore Database > Rules > Publish.' : ''));
  }
}

/* ---------- 4. the Archidekt relay ---------- */
const savedRelay = localStorage.getItem('sm_beta_relay') || '';
const relayUrl = () => (RELAY_URL || $('relay').value || '').trim();
if (!RELAY_URL) { $('f-relay').hidden = false; $('relay').value = savedRelay; }
$('arch').value = localStorage.getItem('sm_beta_arch') || ARCHIDEKT_USERNAME;
$('d-relay').innerHTML = RELAY_URL ? 'Tap the button to fetch your public Archidekt decks through the relay.' : 'The relay URL isn\u2019t in <code>js/config.js</code> yet. Paste it below to test it now.';

async function relay(params) {
  const q = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  const res = await fetch(relayUrl() + '?' + q); // a plain GET, which Apps Script answers for any site
  if (!res.ok) throw new Error('The relay answered ' + res.status);
  return res.json();
}
$('b-relay').addEventListener('click', async () => {
  const url = relayUrl(), user = $('arch').value.trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) return mark('relay', 'bad', 'That doesn\u2019t look like a relay URL. It should start with <code>https://script.google.com/macros/s/</code> and end with <code>/exec</code>.');
  if (!RELAY_URL) localStorage.setItem('sm_beta_relay', url);
  localStorage.setItem('sm_beta_arch', user);
  $('b-relay').disabled = true;
  const t0 = performance.now();
  try {
    mark('relay', 'wait', 'Reaching the relay\u2026');
    const ping = await relay({ ping: 1 });
    if (!ping.ok) throw new Error('The relay didn\u2019t answer as expected.');
    mark('relay', 'wait', 'Relay version ' + esc(ping.relay) + ' is up. Asking Archidekt for <b>' + esc(user) + '</b>\u2019s decks\u2026');
    const list = await relay({ path: 'decks/v3/?ownerUsername=' + encodeURIComponent(user) + '&pageSize=50' });
    if (!list.ok) throw new Error(list.error || 'Archidekt error');
    const decks = (list.data && list.data.results) || [];
    if (!decks.length) return mark('relay', 'bad', 'The relay works, but Archidekt returned <b>no public decks</b> for that username. Check the spelling, and that the decks are public or unlisted.');
    // Fetch a few full decks in one batch, the way the app will
    const some = decks.slice(0, 3);
    const det = await relay({ paths: some.map(d => 'decks/' + d.id + '/').join('|') });
    const got = (det.results || []).filter(r => r.ok).length;
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    mark('relay', 'ok', 'Found <b>' + decks.length + (list.data.next ? '+' : '') + '</b> public decks for ' + esc(user) + ' and loaded full details for ' + got + ' of ' + some.length + ' (' + secs + ' seconds):' +
      '<ul class="decks">' + some.map(d => '<li>' + esc(d.name) + '</li>').join('') + '</ul>' +
      (RELAY_URL ? '' : 'Working. Put this URL in <code>js/config.js</code> so you don\u2019t have to paste it again.'));
  } catch (err) {
    mark('relay', 'bad', 'The relay test failed: <code>' + esc(err.message) + '</code><br>Check that the relay is deployed with <b>Who has access: Anyone</b>, and that you copied the web app URL ending in <code>/exec</code>.');
  } finally { $('b-relay').disabled = false; }
});
