// The Salt Mine settings. None of this is secret: the Firebase config only identifies the project,
// and the database rules decide who can read what.
export const APP_VERSION = '2.0.4';

export const firebaseConfig = {
  apiKey: 'AIzaSyCIbwINcmHqM8cPdj_jpdQ9HzZFCL312S8',
  authDomain: 'the-salt-mine-3130f.firebaseapp.com',
  projectId: 'the-salt-mine-3130f',
  storageBucket: 'the-salt-mine-3130f.firebasestorage.app',
  messagingSenderId: '362174891858',
  appId: '1:362174891858:web:05d19414c3d55590e35c8b'
};

// The Archidekt relay's web app URL (ends in /exec). KEEP the value from Phase 0.
// Support the app: the tip link (Settings > About and account > Support the app)
export const SUPPORT_URL = 'https://paypal.me/whathappened220';

// Feedback (2.0.4): the Google Form's responder link (ends in /viewform) and the entry IDs of its
// App version and Device questions, from FeedbackForm.gs. While FEEDBACK_URL is empty, the feedback link stays hidden.
// KEEP these values on every release, like RELAY_URL.
export const FEEDBACK_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSf0DesXkD4UserAb1Iza692jZ9faG89nLQQuJeBMZZQp5v_Nw/viewform';
export const FEEDBACK_VERSION_ENTRY = '1097577753';
export const FEEDBACK_DEVICE_ENTRY = '765856122';

export const RELAY_URL = 'https://script.google.com/macros/s/AKfycbwxX5YIHO9eDKRHAREeiP8GLAT8h7UughUNr-8m7coGKsLtOi5unpkJSAqWGS54Sy1pqg/exec';

// The app's owner: master controls, and the reserved friend code
export const OWNER_UID = 'NiZxyuiR2Dc1hQDOVCyXBGS2ax23';
export const OWNER_CODE = 'joey-220';

export const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
