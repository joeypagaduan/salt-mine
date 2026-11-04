# Salt Mine Beta

The next version of The Salt Mine, a Magic: The Gathering game tracker and life counter, rebuilt as a standalone web app with games that sync across devices.

**Status:** Phase 6d. Everything through Phase 5, plus the back button, privacy note, install help, a Settings menu (side by side on tablets), What's new, Delete my account, and bigger tap targets.

- Live: https://joeypagaduan.github.io/salt-mine-next/
- Setup check (troubleshooting): https://joeypagaduan.github.io/salt-mine-next/check.html
- Games: one record per game in the `games` collection, readable only by the accounts listed in it. Each edit keeps the previous version in the game's history, and Delete hides a game rather than erasing it.
- Sign-in and data: Firebase (Authentication and Firestore, with an offline copy on each device). The config in `js/config.js` isn't secret; the database rules in `firestore.rules` decide who can read what, and must be pasted into the Firebase console whenever they change.
- Archidekt decks: through a small Apps Script relay (code lives outside this repo).
- Works offline: `sw.js` keeps the app's files on the device.
- The classic Salt Mine (Apps Script) is separate and unaffected.

## Files

- `index.html`, `css/app.css` (styles from the classic app), `css/beta.css` (additions)
- `js/app.js` the app shell and the Phase 1 screens, `js/state.js` shared state
- `js/gameui.js` game screens (setup, round counter, results, Recent games), `js/lifecounter.js` the life counter, `js/game.js` game logic (formats, drafts, records, share, rematch)
- `js/stats.js` the Stats screen, the home stats card and the stats engines from classic 1.13
- `js/changes.js` What's new and every version's changes (add each new version at the top)
- `js/account.js` Delete my account
- `js/help.js` the privacy note and install help
- `js/owner.js` owner controls (history, restore, lock, deleted games)
- `js/shared.js` shared games (inbox, accept and decline, deck tagging, linking names, "That wasn't me")
- `js/groups.js` playgroups (list, members, invites, join requests), `js/vendor/qrcode.js` QR codes (qrcode-generator, MIT)
- `js/importer.js` import from classic (preview, then save; repeatable, keyed by classic Game ID), `js/xlsx.js` a small .xlsx reader
- `js/commanders.js` the commander list from Scryfall, `js/data.js` Firebase, `js/archidekt.js` deck loading, `js/util.js` helpers and themes, `js/config.js` settings
- `check.html` and `js/check.js`: the Phase 0 setup check

Card data and images come from Scryfall and Archidekt. The Salt Mine is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
