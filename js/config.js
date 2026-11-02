// Salt Mine Beta settings. None of this is secret: the Firebase config only identifies the project,
// and the database rules decide who can read what.
export const APP_VERSION = '2.0.0-phase0';

export const firebaseConfig = {
  apiKey: 'AIzaSyCIbwINcmHqM8cPdj_jpdQ9HzZFCL312S8',
  authDomain: 'the-salt-mine-3130f.firebaseapp.com',
  projectId: 'the-salt-mine-3130f',
  storageBucket: 'the-salt-mine-3130f.firebasestorage.app',
  messagingSenderId: '362174891858',
  appId: '1:362174891858:web:05d19414c3d55590e35c8b'
};

// The Archidekt relay's web app URL (ends in /exec). Paste it between the quotes.
export const RELAY_URL = 'https://script.google.com/macros/s/AKfycbwxX5YIHO9eDKRHAREeiP8GLAT8h7UughUNr-8m7coGKsLtOi5unpkJSAqWGS54Sy1pqg/exec';

// Used by the setup check to try the relay
export const ARCHIDEKT_USERNAME = 'what_happened_atthe_salt_mine';
