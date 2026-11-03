// The app's state, shared by every screen module.
import { store } from './util.js';

export const S = {
  view: 'loading', user: null, profile: null, settings: store('smb_settings') || {}, decks: [],
  busy: '', deckQ: '', form: null, sheetDeck: null, open: {}, unsub: [],
  // games (Phase 2)
  draft: null,          // the game being set up, played or logged (same shape as classic 1.13's draft)
  games: [],            // your games, newest first, in the classic "recent" shape (see game.js fromRecord)
  gamesLoaded: false,
  events: [],           // prerelease-style events with their records
  lastGame: null,       // the game just saved, for "Play again?"
  picker: false, sel: null, gameMenu: null, recentShown: 25, fmtOpen: false, lifeCustom: false
};
export const uid = () => S.user && S.user.uid;
