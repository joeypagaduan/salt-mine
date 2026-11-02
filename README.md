# Salt Mine Beta

The next version of The Salt Mine, a Magic: The Gathering game tracker and life counter, rebuilt as a standalone web app with games that sync across devices.

**Status:** Phase 0, a setup check page that confirms sign-in, the database and the Archidekt relay all work.

- Live: https://joeypagaduan.github.io/salt-mine-next/
- Sign-in and data: Firebase (Authentication and Firestore). The config in `js/config.js` isn't secret; the database rules in `firestore.rules` decide who can read what.
- Archidekt decks: through a small Apps Script relay (code lives outside this repo).
- The classic Salt Mine (Apps Script) is separate and unaffected.

Card data and images come from Scryfall and Archidekt. The Salt Mine is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
