// Playgroups (Phase 5a): the people you play with.
// Make a playgroup, invite people with a link, QR code or invite code, and approve who joins (only the organizer can).
// Members can see each other and share the invite; anyone can leave. In the next update, playgroup members become
// players you can add to games, so a game shows up for everyone who played.
import { S, uid, H } from './state.js';
import { esc, toast } from './util.js';
import * as D from './data.js';
import qrcode from './vendor/qrcode.js';

const G5 = { groups: [], loaded: false, requests: {}, reqUnsub: {}, joins: [], declined: {}, people: {}, join: null, renaming: false };
export const GROUPS = G5;
const BASE = location.origin + location.pathname.replace(/index\.html$/, '');
export const inviteLink = token => BASE + '?join=' + token;
const prettyCode = t => String(t || '').replace(/^(.{5})(.{5})$/, '$1-$2');
const cleanCode = t => String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const isAdmin = g => (g.admins || []).indexOf(uid()) !== -1;
const isOrganizer = g => g.createdBy === uid();
const online = () => { if (navigator.onLine) return true; toast('You\u2019re offline. Try again when you\u2019re back online.', true); return false; };
const rr = () => { if (S.view === 'groups' || S.view === 'group' || S.view === 'join' || S.view === 'home') H.rerenderKeep(); };

/* ---------- live data ---------- */
/** Starts watching your playgroups, join requests to groups you organize, and your own requests. Returns unsubscribers. */
export function watchGroupsFor(user) {
  const out = [];
  G5.groups = []; G5.loaded = false; G5.requests = {}; G5.joins = []; G5.declined = {};
  Object.keys(G5.reqUnsub).forEach(k => G5.reqUnsub[k]()); G5.reqUnsub = {};
  out.push(D.watchGroups(user.uid, list => {
    G5.groups = list.sort((a, b) => a.name.localeCompare(b.name)); G5.loaded = true;
    // requests to join: watched for each playgroup you organize
    const admin = {};
    list.filter(isAdmin).forEach(g => {
      admin[g.id] = true;
      if (!G5.reqUnsub[g.id]) G5.reqUnsub[g.id] = D.watchRequests(g.id, reqs => { G5.requests[g.id] = reqs; rr(); }, () => {});
    });
    Object.keys(G5.reqUnsub).forEach(id => { if (!admin[id]) { G5.reqUnsub[id](); delete G5.reqUnsub[id]; delete G5.requests[id]; } });
    loadPeople(); tidyJoins(); rr();
  }, err => { G5.loaded = true; toast('Couldn\u2019t load your playgroups: ' + (err.code || err.message), true); rr(); }));
  out.push(D.watchJoins(user.uid, list => { G5.joins = list; tidyJoins(); rr(); }));
  out.push(() => { Object.keys(G5.reqUnsub).forEach(k => G5.reqUnsub[k]()); G5.reqUnsub = {}; });
  return out;
}
/** Your requests: approved ones (you're a member now) are cleared; ones no longer waiting are shown as not approved. */
let tidying = false;
async function tidyJoins() {
  if (tidying || !G5.loaded || !navigator.onLine) return;
  tidying = true;
  try {
    for (const j of G5.joins) {
      if (G5.groups.some(g => g.id === j.id)) { await D.dropJoin(uid(), j.id).catch(() => {}); continue; }
      if (G5.declined[j.id] == null) {
        const waiting = await D.requestWaiting(j.id, uid()).catch(() => true);
        if (!waiting && !G5.groups.some(g => g.id === j.id)) G5.declined[j.id] = true;
        else G5.declined[j.id] = false;
      }
    }
  } finally { tidying = false; }
  rr();
}
/** Names and photos of everyone in your playgroups, from their public profiles. */
let peopleBusy = false;
async function loadPeople() {
  if (peopleBusy) return;
  const need = [];
  G5.groups.forEach(g => (g.members || []).forEach(m => { if (!G5.people[m] && need.indexOf(m) === -1) need.push(m); }));
  if (!need.length) return;
  peopleBusy = true;
  try { Object.assign(G5.people, await D.loadProfiles(need)); } finally { peopleBusy = false; }
  rr();
}
/** How many people are waiting for you to approve them. */
export const waitingCount = () => Object.keys(G5.requests).reduce((n, k) => n + G5.requests[k].length, 0);
export function homeBlurb() {
  if (!G5.loaded) return 'Loading\u2026';
  const w = waitingCount();
  if (w) return w + (w === 1 ? ' wants to join' : ' want to join');
  const n = G5.groups.length;
  return n ? n + (n === 1 ? ' playgroup' : ' playgroups') : 'Make or join one';
}

/* ---------- invite links ---------- */
/** An invite link opened the app (?join=CODE): remembered until you're signed in with a profile. */
export function takeJoinFromUrl() {
  const m = /[?&]join=([A-Za-z0-9-]+)/.exec(location.search);
  if (!m) return;
  try { localStorage.setItem('smb_join', cleanCode(m[1])); } catch (e) {}
  history.replaceState(null, '', location.pathname);
}
/** After start-up: opens the join screen for a remembered invite. */
export function pendingJoin() {
  let t = null; try { t = localStorage.getItem('smb_join'); } catch (e) {}
  if (!t) return false;
  try { localStorage.removeItem('smb_join'); } catch (e) {}
  openJoin(t);
  return true;
}
async function openJoin(token) {
  G5.join = { token: cleanCode(token), loading: true };
  H.go('join');
  try {
    if (!/^[A-Z0-9]{10}$/.test(G5.join.token)) throw new Error('bad');
    G5.join.inv = await D.getInvite(G5.join.token);
  } catch (e) { G5.join.inv = null; G5.join.err = e && e.message !== 'bad' ? (e.code || e.message) : ''; }
  G5.join.loading = false;
  if (S.view === 'join') H.rerenderKeep();
}

/* ---------- screens ---------- */
function avatar(p) {
  const letter = String((p && p.name) || '?').charAt(0).toUpperCase();
  return p && p.photo ? '<img class="avatar sm" src="' + esc(p.photo) + '" alt="" referrerpolicy="no-referrer">' : '<span class="avatar sm">' + esc(letter) + '</span>';
}
const top = (back, title) => '<header class="top"><button class="link back" data-act="' + back + '">\u2039 ' + (back === 'home' ? 'Home' : 'Playgroups') + '</button><h3>' + esc(title) + '</h3><span style="width:60px"></span></header>';

export function viewGroups() {
  let h = top('home', 'Playgroups');
  const waiting = G5.joins.filter(j => !G5.groups.some(g => g.id === j.id));
  waiting.forEach(j => {
    const no = G5.declined[j.id];
    h += '<div class="panel gwait"><p style="margin:0"><b>' + esc(j.name) + '</b></p><p class="muted" style="margin:2px 0 8px"><small>' +
      (no ? 'Your request wasn\u2019t approved.' : 'Waiting for ' + esc(j.byName || 'the organizer') + ' to approve you.') + '</small></p>' +
      '<button class="btn sm" data-act="gcancel" data-id="' + esc(j.id) + '">' + (no ? 'OK' : 'Cancel request') + '</button></div>';
  });
  if (!G5.loaded) h += '<p class="muted">Loading your playgroups\u2026</p>';
  else if (!G5.groups.length && !waiting.length) h += '<div class="panel"><p style="margin:0">Playgroups are the people you play with. Make one and share the invite, or join one with a link or code from a friend.</p>' +
    '<p class="muted" style="margin:8px 0 0"><small>Coming next: add playgroup members to your games, so each game shows up for everyone who played once they accept it.</small></p></div>';
  G5.groups.forEach(g => {
    const n = (g.members || []).length, w = (G5.requests[g.id] || []).length, org = G5.people[g.createdBy];
    h += '<button class="gcard" data-act="gopen" data-id="' + esc(g.id) + '"><span class="txt"><span class="name">' + esc(g.name) + '</span>' +
      '<span class="muted">' + n + (n === 1 ? ' member' : ' members') + ' \u00b7 ' + (isOrganizer(g) ? 'You organize this' : 'Organized by ' + esc(org ? org.name : '\u2026')) + '</span></span>' +
      (w ? '<span class="badge warn">' + w + ' waiting</span>' : '') + '</button>';
  });
  h += '<h2>New playgroup</h2><div class="row"><input type="text" id="gname" maxlength="40" placeholder="Name, like Friday Night Commander" autocomplete="off"><button class="btn sm" data-act="gcreate" style="flex:none;width:auto">Make it</button></div>';
  h += '<h2>Join with a code</h2><div class="row"><input type="text" id="gcode" maxlength="16" placeholder="Invite code, like ABCDE-23456" autocomplete="off" autocapitalize="characters" spellcheck="false"><button class="btn sm" data-act="gjoincode" style="flex:none;width:auto">Join</button></div>' +
    '<p class="muted"><small>Or open the invite link a friend sent you, or scan their QR code with your camera.</small></p>';
  return h;
}

function groupNow() { return G5.groups.find(g => g.id === S.groupId); }
export function viewGroup() {
  const g = groupNow();
  if (!g) return top('groups', 'Playgroup') + '<p class="muted">' + (G5.loaded ? 'You\u2019re not in this playgroup anymore.' : 'Loading\u2026') + '</p>';
  const admin = isAdmin(g), me = uid();
  let h = top('groups', g.name);
  const reqs = G5.requests[g.id] || [];
  if (admin && reqs.length) {
    h += '<h2>Wants to join <small class="muted">' + reqs.length + '</small></h2>';
    reqs.forEach(r => {
      h += '<div class="panel person">' + avatar(r) + '<span class="txt"><b>' + esc(r.name) + '</b><small class="muted">Friend code ' + esc(r.code) + '</small></span>' +
        '<span class="acts"><button class="btn sm primary" data-act="gapprove" data-id="' + esc(r.id) + '">Approve</button><button class="btn sm" data-act="gdecline" data-id="' + esc(r.id) + '">Decline</button></span></div>';
    });
  }
  const members = (g.members || []).slice().sort((a, b) => (b === g.createdBy) - (a === g.createdBy) || (b === me) - (a === me) ||
    String((G5.people[a] || {}).name || '').localeCompare(String((G5.people[b] || {}).name || '')));
  h += '<h2>Members <small class="muted">' + members.length + '</small></h2>';
  members.forEach(m => {
    const p = G5.people[m] || {};
    h += '<div class="panel person">' + avatar(p) + '<span class="txt"><b>' + esc(p.name || 'Loading\u2026') + (m === me ? ' <span class="muted">(you)</span>' : '') + '</b>' +
      '<small class="muted">' + (p.code ? 'Friend code ' + esc(p.code) : '') + '</small></span>' +
      (m === g.createdBy ? '<span class="pill">Organizer</span>' : admin && m !== me ? '<button class="link danger" data-act="gremove" data-id="' + esc(m) + '">Remove</button>' : '') + '</div>';
  });

  h += '<h2>Invite</h2>';
  if (g.inviteOn && g.invite) {
    const link = inviteLink(g.invite);
    h += '<div class="panel invite"><div class="qr">' + qrSvg(link) + '</div>' +
      '<p style="margin:10px 0 2px;text-align:center">Invite code <b class="code">' + esc(prettyCode(g.invite)) + '</b></p>' +
      '<p class="muted" style="margin:0;text-align:center"><small>Scan with a phone camera, or share the link. ' + (admin ? 'You approve everyone who asks to join.' : 'The organizer approves everyone who asks to join.') + '</small></p>' +
      '<div class="row" style="margin-top:10px"><button class="btn sm" data-act="gshare">Share link</button><button class="btn sm" data-act="gcopy">Copy link</button></div></div>';
  } else h += '<div class="panel"><p style="margin:0">Invites are off' + (admin ? '' : '. Ask the organizer to turn them on') + '.</p></div>';
  if (admin) {
    h += '<div class="row" style="margin-top:8px"><button class="btn sm" data-act="ginviteon">' + (g.inviteOn ? 'Turn invites off' : 'Turn invites on') + '</button>' +
      '<button class="btn sm" data-act="gnewlink">Make a new link</button></div><p class="muted" style="margin-top:4px"><small>A new link stops the old link and code from working.</small></p>';
    h += '<h2>Playgroup</h2><div class="row"><input type="text" id="grename" maxlength="40" value="' + esc(g.name) + '" autocomplete="off" aria-label="Playgroup name"><button class="btn sm" data-act="grename" style="flex:none;width:auto">Rename</button></div>';
  }
  h += '<div style="margin-top:22px">' + (isOrganizer(g)
    ? '<button class="link danger" data-act="gdelete">Delete this playgroup</button><p class="muted" style="margin-top:4px"><small>Your games aren\u2019t affected.</small></p>'
    : '<button class="link danger" data-act="gleave">Leave this playgroup</button>') + '</div>';
  return h;
}
function qrSvg(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), pad = 3, size = n + pad * 2;
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) path += 'M' + (c + pad) + ' ' + (r + pad) + 'h1v1h-1z';
  return '<svg viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="QR code for the invite link" shape-rendering="crispEdges"><rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + path + '" fill="#000"/></svg>';
}

export function viewJoin() {
  const j = G5.join || {};
  let h = top('groups', 'Join a playgroup');
  if (j.loading) return h + '<p class="muted">Opening the invite\u2026</p>';
  const inv = j.inv;
  if (!inv) return h + '<div class="panel"><p style="margin:0">' + (j.err ? 'Couldn\u2019t open the invite (' + esc(j.err) + '). Check your connection and try again.' : 'That invite doesn\u2019t work. It may be mistyped, or the organizer made a new one. Ask them for a fresh link or code.') + '</p></div>';
  const already = G5.groups.find(g => g.id === inv.gid), asked = G5.joins.find(x => x.id === inv.gid);
  h += '<div class="panel" style="text-align:center"><p class="muted" style="margin:0">You\u2019re invited to</p><h2 style="margin:4px 0">' + esc(inv.name) + '</h2>' +
    (inv.byName ? '<p class="muted" style="margin:0">Organized by ' + esc(inv.byName) + '</p>' : '') + '</div>';
  if (already) return h + '<p>You\u2019re already in this playgroup.</p><button class="btn primary" data-act="gopen" data-id="' + esc(inv.gid) + '">Open it</button>';
  if (asked && !G5.declined[inv.gid]) return h + '<p>You asked to join. ' + esc(inv.byName || 'The organizer') + ' will approve you.</p><button class="btn" data-act="groups">See your playgroups</button>';
  if (!inv.on) return h + '<p>Invites to this playgroup are turned off right now. Ask ' + esc(inv.byName || 'the organizer') + ' to turn them on.</p>';
  return h + '<p>Joining shares your display name, friend code and photo with the members. ' + esc(inv.byName || 'The organizer') + ' approves you first.</p>' +
    '<button class="btn primary" data-act="gask">Ask to join</button><button class="btn" style="margin-top:8px" data-act="groups">Not now</button>';
}

/* ---------- taps ---------- */
async function attempt(fn, done) {
  if (!online()) return;
  try { await fn(); if (done) toast(done); }
  catch (e) { toast('That didn\u2019t work: ' + (e.code || e.message), true); }
  rr();
}
const ACTS = { groups: 1, gopen: 1, gcreate: 1, gjoincode: 1, gask: 1, gcancel: 1, gapprove: 1, gdecline: 1, gremove: 1, gleave: 1, gdelete: 1, grename: 1, ginviteon: 1, gnewlink: 1, gshare: 1, gcopy: 1 };
/** Taps on the playgroup screens. Returns true when handled (the work itself may carry on after). */
export function onGroupsAct(act, el) {
  if (!ACTS[act]) return false;
  doAct(act, el);
  return true;
}
async function doAct(act, el) {
  const id = el && el.dataset.id, g = groupNow(), me = uid();
  switch (act) {
    case 'groups': H.go('groups'); return true;
    case 'gopen': S.groupId = id; H.go('group'); return true;
    case 'gcreate': {
      const name = String((document.getElementById('gname') || {}).value || '').trim();
      if (!name) return toast('Give the playgroup a name first.', true), true;
      if (!online()) return true;
      try { S.groupId = await D.createGroup(me, name, (S.profile || {}).name || ''); H.go('group'); toast('Playgroup made. Share the invite to bring people in.'); }
      catch (e) { toast('Couldn\u2019t make it: ' + (e.code || e.message), true); }
      return true;
    }
    case 'gjoincode': {
      const code = cleanCode((document.getElementById('gcode') || {}).value);
      if (code.length !== 10) return toast('Invite codes have 10 letters and numbers.', true), true;
      if (!online()) return true;
      openJoin(code); return true;
    }
    case 'gask': {
      const inv = G5.join && G5.join.inv;
      if (!inv) return true;
      await attempt(() => D.requestJoin(me, S.profile || {}, inv), 'Asked to join ' + inv.name + '.');
      delete G5.declined[inv.gid];
      return true;
    }
    case 'gcancel': await attempt(() => (G5.declined[id] ? D.dropJoin(me, id) : D.cancelJoin(me, id))); delete G5.declined[id]; return true;
    case 'gapprove': {
      const r = (G5.requests[S.groupId] || []).find(x => x.id === id);
      if (r) G5.people[id] = { name: r.name, code: r.code, photo: r.photo };
      await attempt(() => D.approveRequest(S.groupId, id), r ? r.name + ' is in.' : 'Approved.'); return true;
    }
    case 'gdecline': {
      const r = (G5.requests[S.groupId] || []).find(x => x.id === id);
      if (confirm('Decline ' + (r ? r.name : 'this request') + '?')) await attempt(() => D.declineRequest(S.groupId, id));
      return true;
    }
    case 'gremove': {
      const p = G5.people[id] || {};
      if (g && confirm('Remove ' + (p.name || 'this person') + ' from ' + g.name + '? They can ask to join again with an invite.')) await attempt(() => D.removeMember(g.id, id), 'Removed.');
      return true;
    }
    case 'gleave':
      if (g && confirm('Leave ' + g.name + '? You can ask to join again with an invite.')) { await attempt(() => D.leaveGroup(g.id, me), 'You left ' + g.name + '.'); H.go('groups'); }
      return true;
    case 'gdelete':
      if (g && confirm('Delete ' + g.name + ' for everyone? Members won\u2019t see it anymore. Games aren\u2019t affected.')) { await attempt(() => D.deleteGroup(g), 'Deleted.'); H.go('groups'); }
      return true;
    case 'grename': {
      const name = String((document.getElementById('grename') || {}).value || '').trim();
      if (g && name && name !== g.name) await attempt(() => D.renameGroup(g, name), 'Renamed.');
      return true;
    }
    case 'ginviteon': if (g) await attempt(() => D.setInviteOn(g, !g.inviteOn), g.inviteOn ? 'Invites are off.' : 'Invites are on.'); return true;
    case 'gnewlink':
      if (g && confirm('Make a new invite link? The old link and code stop working.')) await attempt(() => D.newInvite(g, (S.profile || {}).name || ''), 'New link ready.');
      return true;
    case 'gshare': case 'gcopy': {
      if (!g) return true;
      const link = inviteLink(g.invite), text = 'Join my playgroup "' + g.name + '" on Salt Mine Beta: ' + link;
      if (act === 'gshare' && navigator.share) { navigator.share({ title: g.name, text: text }).catch(() => {}); return true; }
      try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch (e) { window.prompt('Invite link:', link); }
      return true;
    }
  }
  return false;
}
