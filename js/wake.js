// Keeps the phone or tablet screen on during a game (2.0.2), in the life counter and in Round counter only.
// The phone lets go of this whenever you switch apps or lock the screen, so it's asked for again when you come back.
let lock = null, want = false, asking = false;

async function acquire() {
  if (!want || lock || asking || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
  asking = true;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
    if (!want) release(); // the game ended while it was being asked for
  } catch (e) { lock = null; } // not allowed right now (low battery mode, older devices): the screen just follows auto-lock
  asking = false;
}
function release() {
  const l = lock; lock = null;
  if (l) { try { l.release(); } catch (e) {} }
}
/** On during a game, off otherwise. Safe to call on every screen change. */
export function keepAwake(on) {
  want = !!on;
  if (want) acquire(); else release();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') acquire(); });
