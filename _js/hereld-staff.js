/* Hereld staff console.
   Loaded on demand by hereld-app.js when the signed-in account holds a staff
   role. Every action in here goes through an RPC that checks the caller's rank
   in the database, so removing a button from this file removes a button and
   nothing else. The rank checks below only decide what is worth drawing. */
(function () {
'use strict';
var H = window.Hereld, U = window.HU;
var esc = U.esc, ic = U.icon;
var db, my, role, go, url, col;
var over = null;
var painting = 0;
var RANK = { moderator: 1, admin: 2, superadmin: 3 };
function atLeast(min) { return (RANK[role] || 0) >= (RANK[min] || 1); }
var PAGES = [
{ id: 'dash',      label: 'Dashboard',        ic: 'gauge',    min: 'moderator' },
{ id: 'users',     label: 'People',           ic: 'users',    min: 'moderator' },
{ id: 'posts',     label: 'Posts',            ic: 'quill',    min: 'moderator' },
{ id: 'reports',   label: 'Reports',          ic: 'flag',     min: 'moderator' },
{ id: 'notes',     label: 'Community notes',  ic: 'file',     min: 'moderator' },
{ id: 'companies', label: 'Companies',        ic: 'building', min: 'admin' },
{ id: 'bots',      label: 'Seed accounts',    ic: 'robot',    min: 'admin' },
{ id: 'nova',      label: 'Supernova',        mark: true,     min: 'superadmin' },
{ id: 'staff',     label: 'Staff',            ic: 'shield',   min: 'superadmin' },
{ id: 'platform',  label: 'Platform account', ic: 'tick',     min: 'superadmin' },
{ id: 'settings',  label: 'Settings',         ic: 'gear',     min: 'admin' },
{ id: 'log',       label: 'Audit log',        ic: 'clock',    min: 'moderator' }
];
function num(n) {
n = Number(n || 0);
if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M';
if (n >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'K';
return String(n);
}
function stamp(iso) {
var d = new Date(iso);
if (!d.getTime()) return '';
return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) +
' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
function who(p, sub) {
if (!p) return '<span class="hd-stf-who"><span class="hd-av hd-av--sm" aria-hidden="true">?</span>' +
'<span class="hd-stf-who-t"><b>Removed account</b></span></span>';
return '<span class="hd-stf-who">' + H.avatar(p, 'hd-av--sm') +
'<span class="hd-stf-who-t"><b>' + esc(p.name || p.handle) + '</b>' +
'<small>' + H.tag(p.handle) + (sub ? ' <span class="hd-dot">&middot;</span> ' + esc(sub) : '') + '</small></span></span>';
}
function flags(p) {
var out = [];
if (p.banned) out.push(tag('Banned', 'bad'));
if (p.suspended_until && new Date(p.suspended_until) > new Date()) out.push(tag('Suspended', 'warn'));
if (p.is_platform) out.push(tag('Platform', 'blue'));
if (p.verified) out.push(tag('Verified', 'ok'));
if (p.is_company) out.push(tag('Company'));
if (p.is_bot) out.push(tag('Seed'));
if (p.warn_count) out.push(tag(p.warn_count + (p.warn_count === 1 ? ' warning' : ' warnings'), 'warn'));
return out.join('');
}
function tag(text, kind) {
return '<span class="hd-stf-tag' + (kind ? ' hd-stf-tag--' + kind : '') + '">' + esc(text) + '</span>';
}
function box(title, lead, inner, tools) {
return '<section class="nb-card hd-stf-box">' +
'<header class="hd-stf-box-head"><div><h2>' + esc(title) + '</h2>' +
(lead ? '<p>' + esc(lead) + '</p>' : '') + '</div>' +
(tools ? '<div class="hd-stf-box-tools">' + tools + '</div>' : '') + '</header>' +
inner + '</section>';
}
function empty(line) {
return '<div class="hd-stf-empty">' + ic('check') + '<p>' + esc(line) + '</p></div>';
}
function loading() { return '<div class="hd-load"><span class="nb-loader"></span></div>'; }
function broke(line) {
return '<div class="nb-alert nb-alert--error hd-stf-broke">' + esc(line) + '</div>';
}
function why(err) {
var m = String((err && (err.message || err.hint)) || '');
if (/needs_superadmin/.test(m)) return 'That action is superadmin only.';
if (/needs_admin/.test(m)) return 'That action needs admin rank.';
if (/not_staff/.test(m)) return 'Your account no longer holds a staff role.';
if (/outranked/.test(m)) return 'You cannot act on an account that outranks you.';
if (/platform_account/.test(m)) return 'Only a superadmin can act on a platform account.';
if (/not_yourself/.test(m)) return 'You cannot do that to your own account.';
if (/no_such_handle/.test(m)) return 'No account holds that handle.';
if (/no_such_request/.test(m)) return 'That request is no longer there.';
if (/unknown_role/.test(m)) return 'That is not a role.';
if (/unknown_flag/.test(m)) return 'That setting does not exist.';
if (/permission denied|row-level security/i.test(m)) return 'The database refused that. You do not hold the rank for it.';
return m || 'That did not go through.';
}
async function call(fn, args, said) {
var r = await db.rpc(fn, args);
if (r.error) { U.toast(why(r.error), 'bad'); return false; }
if (said) U.toast(said);
return true;
}
function shellHTML(page) {
var nav = PAGES.filter(function (p) { return atLeast(p.min); }).map(function (p) {
var glyph = p.mark
? '<span class="hd-nvm hd-stf-nav-mark" aria-hidden="true"></span>'
: ic(p.ic);
return '<button class="hd-stf-nav-i' + (p.id === page ? ' is-on' : '') + '" type="button" data-page="' + p.id + '">' +
glyph + '<span>' + esc(p.label) + '</span></button>';
}).join('');
return '<div class="hd-stf">' +
'<header class="hd-stf-top">' +
'<div class="hd-stf-top-t">' +
'<h1>Staff console</h1>' +
'<p>Signed in as ' + H.tag((my && my.handle) || '') + ' <span class="hd-dot">&middot;</span> ' +
esc(role || 'moderator') + '</p>' +
'</div>' +
'<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" data-back-app>' + ic('back') + 'Back to Hereld</button>' +
'</header>' +
'<div class="hd-stf-body">' +
'<nav class="hd-stf-nav" aria-label="Console sections">' + nav + '</nav>' +
'<div class="hd-stf-page" id="stfPage">' + loading() + '</div>' +
'</div>' +
'</div>';
}
async function pageDash(host) {
var r = await db.rpc('staff_overview');
if (r.error) { host.innerHTML = broke(why(r.error)); return; }
over = r.data || {};
var tiles = [
['People', num(over.people), over.joined_week + ' joined this week'],
['Posts', num(over.posts), over.posts_day + ' in the last day'],
['Open reports', num(over.reports_open), over.reports_open ? 'Waiting on a decision' : 'Nothing waiting'],
['Notes proposed', num(over.notes_open), over.notes_open ? 'Waiting on a decision' : 'Nothing waiting'],
['Banned', num(over.banned), 'Accounts held off the platform'],
['Suspended', num(over.suspended), 'Accounts on a timer']
].map(function (t) {
return '<div class="nb-card hd-stf-tile"><span class="hd-stf-tile-n">' + t[1] + '</span>' +
'<span class="hd-stf-tile-l">' + esc(t[0]) + '</span>' +
'<span class="hd-stf-tile-s">' + esc(t[2]) + '</span></div>';
}).join('');
var queue = '';
if (over.reports_open) queue += queueCard('reports', over.reports_open + ' report' + (over.reports_open === 1 ? '' : 's') + ' open', 'Read them, decide, close them out.');
if (over.notes_open) queue += queueCard('notes', over.notes_open + ' community note' + (over.notes_open === 1 ? '' : 's') + ' proposed', 'A note only shows once it is published.');
host.innerHTML =
(queue ? '<div class="hd-stf-queue">' + queue + '</div>' : '') +
'<div class="hd-stf-tiles">' + tiles + '</div>' +
box('Recent staff actions', 'The last twenty entries. The full log is under Audit log.', '<div id="stfFeed">' + loading() + '</div>');
logInto(host.querySelector('#stfFeed'), 20);
}
function queueCard(page, title, line) {
return '<button class="nb-card hd-stf-qcard" type="button" data-page="' + page + '">' +
ic('flag') + '<span><b>' + esc(title) + '</b><small>' + esc(line) + '</small></span>' + ic('back') + '</button>';
}
var userQ = '';
async function pageUsers(host) {
host.innerHTML =
box('People', 'Search by handle or display name. Acting on an account writes an audit entry.',
'<form class="hd-stf-search" id="stfUserQ">' +
'<label class="nb-sr" for="stfUserI">Search people</label>' +
'<input class="nb-input" id="stfUserI" type="search" placeholder="Handle or name" value="' + esc(userQ) + '">' +
'<button class="nb-btn nb-btn--primary" type="submit">' + ic('search') + 'Search</button>' +
'</form>' +
'<div class="hd-stf-rows" id="stfUsers">' + loading() + '</div>');
host.querySelector('#stfUserQ').addEventListener('submit', function (e) {
e.preventDefault();
userQ = host.querySelector('#stfUserI').value.trim();
listUsers(host.querySelector('#stfUsers'));
});
listUsers(host.querySelector('#stfUsers'));
}
async function listUsers(node) {
node.innerHTML = loading();
var q = db.from('profiles')
.select('id,handle,name,headline,avatar_url,created_at,post_count,follower_count,banned,suspended_until,warn_count,verified,is_company,is_platform,is_bot')
.order('created_at', { ascending: false }).limit(40);
if (userQ) q = q.or('handle.ilike.%' + userQ + '%,name.ilike.%' + userQ + '%');
var r = await q;
if (r.error) { node.innerHTML = broke(why(r.error)); return; }
if (!r.data.length) { node.innerHTML = empty(userQ ? 'Nobody matches that.' : 'No accounts yet.'); return; }
node.innerHTML = r.data.map(function (p) {
return '<div class="hd-stf-row" data-uid="' + esc(p.id) + '">' +
who(p, 'joined ' + H.when(p.created_at)) +
'<span class="hd-stf-row-tags">' + flags(p) + '</span>' +
'<span class="hd-stf-row-n">' + num(p.post_count) + ' posts</span>' +
'<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" data-open-user="' + esc(p.id) + '">Open</button>' +
'</div>';
}).join('');
}
async function openUser(id) {
var s = U.sheet({ title: 'Account', wide: true, html: loading() });
var r = await db.from('profiles').select('*').eq('id', id).maybeSingle();
if (r.error || !r.data) { s.body.innerHTML = broke(r.error ? why(r.error) : 'That account is gone.'); return; }
var p = r.data;
var theirRole = null;
var sr = await db.from('staff').select('role').eq('user_id', id).maybeSingle();
if (!sr.error && sr.data) theirRole = sr.data.role;
var suspended = p.suspended_until && new Date(p.suspended_until) > new Date();
function facts() {
return [
['Handle', '@' + p.handle],
['Joined', stamp(p.created_at)],
['Posts', num(p.post_count)],
['Followers', num(p.follower_count)],
['Warnings', String(p.warn_count || 0)],
['Suspended until', suspended ? stamp(p.suspended_until) : 'Not suspended'],
['Staff role', theirRole || 'None'],
['Website', p.website || 'None']
].map(function (f) {
return '<div class="hd-stf-fact"><span>' + esc(f[0]) + '</span><b>' + esc(f[1]) + '</b></div>';
}).join('');
}
function paint() {
s.body.innerHTML =
'<div class="hd-stf-head">' + H.avatar(p, 'hd-av--lg') +
'<div><h3>' + esc(p.name || p.handle) + '</h3><p>' + H.tag(p.handle) + '</p>' +
'<div class="hd-stf-row-tags">' + flags(p) + (theirRole ? tag(theirRole, 'blue') : '') + '</div></div>' +
'<a class="nb-btn nb-btn--ghost nb-btn--sm" href="' + url('@' + p.handle) + '" data-r>View profile</a>' +
'</div>' +
(p.bio ? '<p class="hd-stf-bio">' + esc(p.bio) + '</p>' : '') +
'<div class="hd-stf-facts">' + facts() + '</div>' +
'<div class="hd-stf-acts">' +
btn('warn', 'warn', 'Warn') +
(suspended ? btn('unsuspend', 'again', 'Lift suspension', 'ok') : btn('suspend', 'clock', 'Suspend')) +
(atLeast('admin')
? (p.banned ? btn('unban', 'again', 'Unban', 'ok') : btn('ban', 'ban', 'Ban', 'bad'))
: '') +
(atLeast('superadmin')
? btn(p.is_platform ? 'platform_off' : 'platform_on', 'tick',
p.is_platform ? 'Remove platform mark' : 'Mark as platform account')
: '') +
'</div>';
s.body.querySelectorAll('[data-act]').forEach(function (b) {
b.addEventListener('click', function () { runOn(b.dataset.act); });
});
}
function btn(act, glyph, label, kind) {
return '<button class="nb-btn nb-btn--sm' + (kind === 'bad' ? ' nb-btn--red' : kind === 'ok' ? ' nb-btn--green' : ' nb-btn--ghost') +
'" type="button" data-act="' + act + '">' + ic(glyph) + esc(label) + '</button>';
}
async function runOn(act) {
var days = 0, reason = '';
if (act === 'suspend') {
var got = await askReason('Suspend ' + p.handle, 'How long, and why? The account keeps its posts and cannot write while suspended.', true);
if (!got) return;
days = got.days; reason = got.reason;
} else if (act === 'warn' || act === 'ban') {
var g2 = await askReason(act === 'ban' ? 'Ban ' + p.handle : 'Warn ' + p.handle,
act === 'ban' ? 'A ban holds the account off Hereld until it is lifted. Say why, for the log.' : 'Say what the warning is for. It goes in the log.', false);
if (!g2) return;
reason = g2.reason;
} else {
var ok = await U.ask({
title: 'Confirm',
line: 'Run ' + act.replace(/_/g, ' ') + ' on @' + p.handle + '?',
yes: 'Run it',
bad: /ban|platform_off/.test(act)
});
if (!ok) return;
}
var done = await call('staff_act', { p_kind: act, p_subject: id, p_reason: reason, p_days: days }, 'Done, and logged.');
if (!done) return;
var again = await db.from('profiles').select('*').eq('id', id).maybeSingle();
if (again.data) { p = again.data; suspended = p.suspended_until && new Date(p.suspended_until) > new Date(); }
paint();
render();
}
paint();
}
function askReason(title, line, withDays) {
return new Promise(function (done) {
var answered = false;
U.sheet({
title: title,
html:
'<p class="hd-ask-line">' + esc(line) + '</p>' +
(withDays
? '<label class="nb-label" for="stfDays">Days</label>' +
'<input class="nb-input" id="stfDays" type="number" min="1" max="365" value="7">'
: '') +
'<label class="nb-label" for="stfWhy">Reason</label>' +
'<textarea class="nb-textarea" id="stfWhy" rows="3" maxlength="400" data-focus placeholder="Kept in the audit log"></textarea>' +
'<div class="hd-ask-foot">' +
'<button class="nb-btn nb-btn--ghost" type="button" data-no>Cancel</button>' +
'<button class="nb-btn nb-btn--primary" type="button" data-yes>Confirm</button>' +
'</div>',
onClose: function () { if (!answered) done(null); },
wire: function (api) {
api.q('[data-no]').addEventListener('click', function () { answered = true; done(null); api.close(); });
api.q('[data-yes]').addEventListener('click', function () {
var why_ = api.q('#stfWhy').value.trim();
if (!why_) { U.toast('Say why first.', 'bad'); return; }
answered = true;
done({ reason: why_, days: withDays ? Math.max(1, parseInt(api.q('#stfDays').value, 10) || 7) : 0 });
api.close();
});
}
});
});
}
var postQ = '';
async function pagePosts(host) {
host.innerHTML =
box('Posts', 'Newest first. Hiding a post takes it out of every feed without deleting what people replied to.',
'<form class="hd-stf-search" id="stfPostQ">' +
'<label class="nb-sr" for="stfPostI">Search posts</label>' +
'<input class="nb-input" id="stfPostI" type="search" placeholder="Words in a post" value="' + esc(postQ) + '">' +
'<button class="nb-btn nb-btn--primary" type="submit">' + ic('search') + 'Search</button>' +
'</form>' +
'<div class="hd-stf-rows" id="stfPosts">' + loading() + '</div>');
host.querySelector('#stfPostQ').addEventListener('submit', function (e) {
e.preventDefault();
postQ = host.querySelector('#stfPostI').value.trim();
listPosts(host.querySelector('#stfPosts'));
});
listPosts(host.querySelector('#stfPosts'));
}
async function listPosts(node) {
node.innerHTML = loading();
var q = db.from('posts')
.select('id,body,created_at,hidden,reply_to,endorse_count,reply_count,author:profiles!posts_author_fkey(id,handle,name,avatar_url,banned)')
.order('created_at', { ascending: false }).limit(40);
if (postQ) q = q.ilike('body', '%' + postQ + '%');
var r = await q;
if (r.error) { node.innerHTML = broke(why(r.error)); return; }
if (!r.data.length) { node.innerHTML = empty(postQ ? 'No post matches that.' : 'Nothing posted yet.'); return; }
node.innerHTML = r.data.map(postRow).join('');
}
function postRow(p) {
return '<div class="hd-stf-post" data-pid="' + esc(p.id) + '">' +
'<div class="hd-stf-post-t">' + who(p.author, H.when(p.created_at)) +
(p.hidden ? tag('Hidden', 'bad') : '') + (p.reply_to ? tag('Reply') : '') + '</div>' +
'<p class="hd-stf-post-b">' + esc(p.body || '(no words)') + '</p>' +
'<div class="hd-stf-post-a">' +
'<a class="nb-btn nb-btn--ghost nb-btn--sm" href="' + url('post/' + p.id) + '" data-r>Open</a>' +
'<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" data-post-act="' +
(p.hidden ? 'show_post' : 'hide_post') + '" data-pid="' + esc(p.id) + '">' +
ic(p.hidden ? 'check' : 'hide') + (p.hidden ? 'Unhide' : 'Hide') + '</button>' +
(atLeast('admin')
? '<button class="nb-btn nb-btn--red nb-btn--sm" type="button" data-post-act="delete_post" data-pid="' + esc(p.id) + '">' +
ic('trash') + 'Delete</button>'
: '') +
'</div></div>';
}
async function postAct(kind, id) {
if (kind === 'delete_post') {
var ok = await U.ask({
title: 'Delete this post',
line: 'Deleting takes the post and its replies with it. Hiding is usually the better answer.',
yes: 'Delete it', bad: true
});
if (!ok) return;
}
if (await call('staff_act', { p_kind: kind, p_post: id, p_reason: '' }, 'Done, and logged.')) render();
}
var repState = 'open';
async function pageReports(host) {
var pills = ['open', 'reviewing', 'actioned', 'dismissed'].map(function (s) {
return '<button class="hd-stf-pill' + (s === repState ? ' is-on' : '') + '" type="button" data-rep="' + s + '">' +
esc(s.charAt(0).toUpperCase() + s.slice(1)) + '</button>';
}).join('');
host.innerHTML = box('Reports', 'Each one names what was reported and by whom. Closing writes the decision to the log.',
'<div class="hd-stf-pills">' + pills + '</div><div class="hd-stf-rows" id="stfReps">' + loading() + '</div>');
host.querySelectorAll('[data-rep]').forEach(function (b) {
b.addEventListener('click', function () { repState = b.dataset.rep; pageReports(host); });
});
var node = host.querySelector('#stfReps');
var r = await db.from('reports')
.select('*, reporter:profiles!reports_reporter_fkey(id,handle,name,avatar_url), subject:profiles!reports_subject_fkey(id,handle,name,avatar_url)')
.eq('status', repState).order('created_at', { ascending: false }).limit(40);
if (r.error) { node.innerHTML = broke(why(r.error)); return; }
if (!r.data.length) { node.innerHTML = empty(repState === 'open' ? 'No open reports. Good.' : 'Nothing here.'); return; }
var posts = {};
var ids = r.data.map(function (x) { return x.post_id; }).filter(Boolean);
if (ids.length) {
var pr = await db.from('posts').select('id,body,hidden,author').in('id', ids);
if (!pr.error) pr.data.forEach(function (p) { posts[p.id] = p; });
}
node.innerHTML = r.data.map(function (x) {
var p = x.post_id && posts[x.post_id];
return '<div class="hd-stf-rep">' +
'<div class="hd-stf-rep-t">' + tag(x.reason) + tag(x.kind) +
'<span class="hd-stf-rep-when">' + esc(stamp(x.created_at)) + '</span></div>' +
'<div class="hd-stf-rep-w"><span>Reported by</span>' + who(x.reporter) + '</div>' +
(x.subject ? '<div class="hd-stf-rep-w"><span>About</span>' + who(x.subject) + '</div>' : '') +
(p ? '<blockquote class="hd-stf-quote">' + esc(p.body || '(no words)') + '</blockquote>'
: x.post_id ? '<blockquote class="hd-stf-quote">That post is already gone.</blockquote>' : '') +
(x.detail ? '<p class="hd-stf-rep-d">' + esc(x.detail) + '</p>' : '') +
'<div class="hd-stf-post-a">' +
(x.post_id ? '<a class="nb-btn nb-btn--ghost nb-btn--sm" href="' + url('post/' + x.post_id) + '" data-r>Open post</a>' : '') +
(x.subject ? '<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" data-open-user="' + esc(x.subject.id) + '">Open account</button>' : '') +
(p && x.post_id ? '<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" data-post-act="' +
(p.hidden ? 'show_post' : 'hide_post') + '" data-pid="' + esc(x.post_id) + '">' +
(p.hidden ? 'Unhide post' : 'Hide post') + '</button>' : '') +
(repState === 'open' || repState === 'reviewing'
? '<button class="nb-btn nb-btn--green nb-btn--sm" type="button" data-rep-act="close_report" data-rid="' + esc(x.id) + '">Actioned</button>' +
'<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" data-rep-act="dismiss_report" data-rid="' + esc(x.id) + '">Dismiss</button>'
: '') +
'</div></div>';
}).join('');
}
async function pageNotes(host) {
host.innerHTML = box('Community notes',
'A note only appears under a post once it is published here. Requests show what people asked about.',
'<div id="stfNotes">' + loading() + '</div>');
var node = host.querySelector('#stfNotes');
var n = await db.from('community_notes')
.select('*, author:profiles!community_notes_author_fkey(id,handle,name,avatar_url)')
.order('created_at', { ascending: false }).limit(40);
if (n.error) { node.innerHTML = broke(why(n.error)); return; }
var q = await db.from('note_requests').select('post_id,reason,created_at').order('created_at', { ascending: false }).limit(20);
var asked = {};
if (!q.error) q.data.forEach(function (x) { asked[x.post_id] = (asked[x.post_id] || 0) + 1; });
var notes = n.data.length ? n.data.map(function (x) {
return '<div class="hd-stf-rep">' +
'<div class="hd-stf-rep-t">' + tag(x.status, x.status === 'published' ? 'ok' : x.status === 'rejected' ? 'bad' : 'warn') +
'<span class="hd-stf-rep-when">' + esc(stamp(x.created_at)) + '</span></div>' +
'<div class="hd-stf-rep-w"><span>Written by</span>' + who(x.author) + '</div>' +
'<blockquote class="hd-stf-quote">' + esc(x.body) + '</blockquote>' +
(x.source ? '<p class="hd-stf-rep-d">Source: ' + esc(x.source) + '</p>' : '') +
'<div class="hd-stf-post-a">' +
'<a class="nb-btn nb-btn--ghost nb-btn--sm" href="' + url('post/' + x.post_id) + '" data-r>Open post</a>' +
(x.status === 'proposed'
? '<button class="nb-btn nb-btn--green nb-btn--sm" type="button" data-note-act="publish_note" data-nid="' + esc(x.id) + '">Publish</button>' +
'<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" data-note-act="reject_note" data-nid="' + esc(x.id) + '">Reject</button>'
: '') +
'</div></div>';
}).join('') : empty('No notes written yet.');
var reqs = Object.keys(asked).length
? '<div class="hd-stf-rows">' + Object.keys(asked).map(function (pid) {
return '<div class="hd-stf-row"><span class="hd-stf-who-t"><b>' + asked[pid] +
(asked[pid] === 1 ? ' person asked' : ' people asked') + ' for a note</b></span>' +
'<a class="nb-btn nb-btn--ghost nb-btn--sm" href="' + url('post/' + pid) + '" data-r>Open post</a></div>';
}).join('') + '</div>'
: empty('Nobody has asked for a note.');
node.innerHTML = notes + '<h3 class="hd-stf-sub">Requests</h3>' + reqs;
}
async function pageCompanies(host) {
host.innerHTML = box('Company verification',
'Turning on company mode files a request. The badge is granted here and nowhere else.',
'<div id="stfVerif">' + loading() + '</div>');
var node = host.querySelector('#stfVerif');
var r = await db.from('verifications')
.select('*, subject:profiles!verifications_subject_fkey(id,handle,name,avatar_url,verified,is_company,website,headline)')
.order('created_at', { ascending: false }).limit(40);
if (r.error) { node.innerHTML = broke(why(r.error)); return; }
if (!r.data.length) { node.innerHTML = empty('No verification requests.'); return; }
node.innerHTML = r.data.map(function (v) {
var kind = v.status === 'approved' ? 'ok' : v.status === 'rejected' ? 'bad' : 'warn';
var open = v.status === 'pending' || v.status === 'more_info';
return '<div class="hd-stf-rep">' +
'<div class="hd-stf-rep-t">' + tag(v.status.replace('_', ' '), kind) +
'<span class="hd-stf-rep-when">' + esc(stamp(v.created_at)) + '</span></div>' +
'<div class="hd-stf-rep-w"><span>Account</span>' + who(v.subject) + '</div>' +
(v.subject && v.subject.website ? '<p class="hd-stf-rep-d">Website: ' + esc(v.subject.website) + '</p>' : '') +
(v.claim ? '<blockquote class="hd-stf-quote">' + esc(v.claim) + '</blockquote>' : '') +
(v.evidence ? '<p class="hd-stf-rep-d">Evidence: ' + esc(v.evidence) + '</p>' : '') +
(v.note ? '<p class="hd-stf-rep-d">Last decision note: ' + esc(v.note) + '</p>' : '') +
'<div class="hd-stf-post-a">' +
(v.subject ? '<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" data-open-user="' + esc(v.subject.id) + '">Open account</button>' : '') +
(open
? '<button class="nb-btn nb-btn--green nb-btn--sm" type="button" data-verif="approved" data-vid="' + esc(v.id) + '">Approve</button>' +
'<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" data-verif="more_info" data-vid="' + esc(v.id) + '">Ask for more</button>' +
'<button class="nb-btn nb-btn--red nb-btn--sm" type="button" data-verif="rejected" data-vid="' + esc(v.id) + '">Reject</button>'
: '<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" data-verif="pending" data-vid="' + esc(v.id) + '">Reopen</button>') +
'</div></div>';
}).join('');
}
async function ruleVerif(id, status) {
var note = '';
if (status !== 'approved') {
var got = await askReason(status === 'more_info' ? 'Ask for more' : 'Reject this request',
'What should they be told? This is kept with the request.', false);
if (!got) return;
note = got.reason;
}
if (await call('staff_rule_verification', { p_id: id, p_status: status, p_note: note }, 'Decision recorded.')) render();
}
async function pageBots(host) {
host.innerHTML = box('Seed accounts',
'Off by default. Lowering the active count deactivates accounts; it never deletes them.',
'<div id="stfBots">' + loading() + '</div>');
var node = host.querySelector('#stfBots');
var f = await db.from('platform_flags').select('*');
if (f.error) { node.innerHTML = broke(why(f.error)); return; }
var flag = {};
f.data.forEach(function (x) { flag[x.key] = x; });
var b = await db.from('bots')
.select('*, who:profiles!bots_id_fkey(id,handle,name,avatar_url)')
.order('created_at', { ascending: true }).limit(60);
var total = b.error ? 0 : b.data.length;
var live = b.error ? 0 : b.data.filter(function (x) { return x.active; }).length;
// fetch last action per bot from bot_log
var lastMap = {};
try {
  var lg = await db.from('bot_log').select('bot,kind,detail,created_at,ok').order('created_at', { ascending: false }).limit(120);
  if (!lg.error && lg.data) lg.data.forEach(function (r) { if (!lastMap[r.bot]) lastMap[r.bot] = r; });
} catch(e) {}
var rows = b.error ? broke(why(b.error))
: total ? b.data.map(function (x) {
var last = lastMap[x.id];
var lastLine = last ? esc(last.kind) + (last.detail ? ': ' + esc(String(last.detail).slice(0,60)) : '') + ' <span class="hd-stf-row-n">' + esc(H.when(last.created_at)) + '</span>' + (last.ok === false ? ' ' + tag('failed','bad') : '') : '<span class="hd-stf-row-n">no actions yet</span>';
return '<div class="hd-stf-row">' + who(x.who, x.persona || 'No persona set') +
'<span class="hd-stf-row-tags">' + (x.active ? tag('Active', 'ok') : tag('Inactive')) +
tag(x.act_count + ' actions') + '</span>' +
'<span class="hd-stf-row-n">' + (x.last_act_at ? 'last ' + H.when(x.last_act_at) : 'never run') + '</span>' +
'<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" data-bot="' + esc(x.id) + '" data-on="' +
(x.active ? '' : '1') + '">' + (x.active ? 'Deactivate' : 'Activate') + '</button>' +
'<div class="hd-stf-row-last">' + lastLine + '</div>' +
'</div>';
}).join('')
: empty('No seed accounts exist. None can run.');
node.innerHTML =
'<div class="hd-stf-tiles hd-stf-tiles--2">' +
'<div class="nb-card hd-stf-tile"><span class="hd-stf-tile-n">' + total + '</span>' +
'<span class="hd-stf-tile-l">Seed accounts</span><span class="hd-stf-tile-s">Records that exist</span></div>' +
'<div class="nb-card hd-stf-tile"><span class="hd-stf-tile-n">' + live + '</span>' +
'<span class="hd-stf-tile-l">Active now</span><span class="hd-stf-tile-s">Allowed to take part</span></div>' +
'</div>' +
'<form class="hd-stf-search" id="stfBotN">' +
'<label class="nb-label" for="stfBotNi">Seed accounts (set to 0 to stop everything)</label>' +
'<input class="nb-input" id="stfBotNi" type="number" min="0" step="1" inputmode="numeric" value="' +
((flag.bots_active && flag.bots_active.number) || 0) + '">' +
'<button class="nb-btn nb-btn--primary" type="submit">Set</button>' +
'</form>' +
'<div class="hd-stf-row">' +
'<button class="nb-btn nb-btn--ghost" type="button" id="stfSeedNow">Run bots now</button>' +
'<button class="nb-btn nb-btn--ghost" type="button" id="stfSeedAll">Run ALL bots</button>' +
'<button class="nb-btn nb-btn--ghost" type="button" id="stfMentionsNow">Run mentions now</button>' +
'</div>' +
'<div class="nb-alert nb-alert--info hd-stf-note">Set a number above 0 to enable the bot system. ' +
'Set to 0 to stop everything immediately. Supernova API key must also be set in the Supernova tab. ' +
'Use the buttons above to trigger bots manually (no cron needed).</div>' +
'<h3 class="hd-stf-sub">Accounts</h3><div class="hd-stf-rows">' + rows + '</div>';
var form = node.querySelector('#stfBotN');
form.addEventListener('submit', async function (e) {
e.preventDefault();
var n = Math.max(0, parseInt(node.querySelector('#stfBotNi').value, 10) || 0);
if (await call('staff_set_flag', { p_key: 'bots_active', p_number: n }, 'Set. Nothing was deleted.')) render();
});
var seedBtn = node.querySelector('#stfSeedNow');
if (seedBtn) seedBtn.addEventListener('click', async function () {
seedBtn.disabled = true; seedBtn.textContent = 'Running...';
try { var r = await H.fn('supernova?job=seed'); U.toast('Bots ran. ' + (r.made || 0) + ' actions taken.'); }
catch (e) { U.toast(String(e.message || 'Failed.'), 'bad'); }
seedBtn.disabled = false; seedBtn.textContent = 'Run bots now';
});
var seedAllBtn = node.querySelector('#stfSeedAll');
if (seedAllBtn) seedAllBtn.addEventListener('click', async function () {
seedAllBtn.disabled = true; seedAllBtn.textContent = 'Running ALL...';
try { var r = await H.fn('supernova?job=seed_all'); U.toast('All bots ran. ' + (r.posted || 0) + ' actions taken.'); }
catch (e) { U.toast(String(e.message || 'Failed.'), 'bad'); }
seedAllBtn.disabled = false; seedAllBtn.textContent = 'Run ALL bots';
});
var mentBtn = node.querySelector('#stfMentionsNow');
if (mentBtn) mentBtn.addEventListener('click', async function () {
mentBtn.disabled = true; mentBtn.textContent = 'Running...';
try { var r = await H.fn('supernova?job=mentions'); U.toast('Mentions answered: ' + (r.answered || 0)); }
catch (e) { U.toast(String(e.message || 'Failed.'), 'bad'); }
mentBtn.disabled = false; mentBtn.textContent = 'Run mentions now';
});
}
var PROVIDERS = [
['anthropic', 'Anthropic'],
['openai', 'OpenAI'],
['groq', 'Groq'],
['mistral', 'Mistral']
];
async function pageNova(host) {
host.innerHTML = box('Supernova',
'The model behind Ask Supernova, the community note summaries and what the seed accounts write.',
'<div id="stfNova">' + loading() + '</div>');
var node = host.querySelector('#stfNova');
var r = await db.rpc('ai_config_state');
if (r.error) { node.innerHTML = broke(why(r.error)); return; }
var c = r.data || {};
var opts = PROVIDERS.map(function (p) {
return '<option value="' + p[0] + '"' + (c.provider === p[0] ? ' selected' : '') + '>' + esc(p[1]) + '</option>';
}).join('');
var live = !!(c.has_key && c.model);
node.innerHTML =
'<div class="hd-stf-switch' + (live ? '' : ' hd-stf-switch--bad') + '">' +
'<div><b>' + (live ? 'Answering' : 'Not answering yet') + '</b>' +
'<small>' + (c.has_key
? 'A key ending ' + esc(c.key_tail) + ' is set' + (c.model ? ' and Hereld is asking ' + esc(c.model) + '.' : ', but no model is named yet.')
: 'Until a key is set, Ask Supernova says so instead of opening a box that goes nowhere.') +
'</small></div>' +
(c.updated_at ? '<span class="hd-stf-tag">Changed ' + esc(stamp(c.updated_at)) + '</span>' : '') +
'</div>' +
'<form class="hd-stf-form" id="stfNovaF">' +
'<div class="nb-field"><label class="nb-label" for="stfNovaP">Provider</label>' +
'<select class="nb-select" id="stfNovaP">' + opts + '</select></div>' +
'<div class="nb-field"><label class="nb-label" for="stfNovaM">Model</label>' +
'<input class="nb-input" id="stfNovaM" type="text" maxlength="80" placeholder="model id" value="' + esc(c.model || '') + '">' +
'<span class="nb-hint">Written exactly as the provider writes it. Hereld sends it through unchanged.</span></div>' +
'<div class="nb-field"><label class="nb-label" for="stfNovaK">Key ' +
'<span class="nb-hint">' + (c.has_key ? 'Leave blank to keep the one that is set' : 'Required') + '</span></label>' +
'<input class="nb-input" id="stfNovaK" type="password" autocomplete="off" spellcheck="false" maxlength="300" ' +
'placeholder="' + (c.has_key ? 'Ends ' + esc(c.key_tail) : 'Paste the provider key') + '">' +
'<span class="nb-hint">Kept in a row no browser can read, including this one. It is sent to the provider by the server and nowhere else.</span></div>' +
'<div class="nb-field"><label class="nb-label" for="stfNovaN">House note</label>' +
'<textarea class="nb-input" id="stfNovaN" rows="5" maxlength="1200" ' +
'placeholder="What Supernova should know about Hereld before it answers anything.">' + esc(c.system_note || '') + '</textarea>' +
'<span class="nb-hint">Goes in front of every answer, every note summary and everything a seed account writes.</span></div>' +
'<div class="hd-stf-form-acts">' +
'<button class="nb-btn nb-btn--primary" type="submit">Save</button>' +
(c.has_key ? '<button class="nb-btn nb-btn--red" type="button" id="stfNovaX">Remove the key</button>' : '') +
'</div>' +
'</form>' +
'<h3 class="hd-stf-sub">Recent calls</h3>' +
'<div id="stfNovaCalls">' + loading() + '</div>';
node.querySelector('#stfNovaF').addEventListener('submit', async function (e) {
e.preventDefault();
var key = node.querySelector('#stfNovaK').value.trim();
var model = node.querySelector('#stfNovaM').value.trim();
if (!model) { U.toast('Name a model first.', 'bad'); return; }
if (!key && !c.has_key) { U.toast('No key is set, so one has to go in.', 'bad'); return; }
var ok = await call('ai_config_set', {
p_provider: node.querySelector('#stfNovaP').value,
p_model: model,
p_key: key,
p_note: node.querySelector('#stfNovaN').value.trim()
}, key ? 'Saved. The key cannot be read back.' : 'Saved.');
if (ok) render();
});
var x = node.querySelector('#stfNovaX');
if (x) x.addEventListener('click', async function () {
var ok = await U.ask({
title: 'Remove the key',
line: 'Ask Supernova stops answering, note summaries stop being written and the seed accounts fall quiet. Nothing else changes.',
yes: 'Remove it', bad: true
});
if (!ok) return;
if (await call('ai_config_clear', {}, 'Removed.')) render();
});
novaCalls(node.querySelector('#stfNovaCalls'));
}
async function novaCalls(node) {
if (!node) return;
var r = await db.from('ai_calls').select('*').order('created_at', { ascending: false }).limit(25);
if (r.error) { node.innerHTML = broke(why(r.error)); return; }
if (!r.data.length) { node.innerHTML = empty('Nothing has been asked yet.'); return; }
var KIND = { ask: 'Asked', note_summary: 'Note summary', bot_post: 'Seed post', bot_reply: 'Seed reply' };
var ids = r.data.map(function (x) { return x.asked_by; }).filter(Boolean);
var byId = {};
if (ids.length) {
var pr = await db.from('profiles').select('id,handle,name,avatar_url').in('id', ids);
if (!pr.error) pr.data.forEach(function (p) { byId[p.id] = p; });
}
node.innerHTML = '<div class="hd-stf-log">' + r.data.map(function (x) {
var p = byId[x.asked_by];
return '<div class="hd-stf-log-i">' +
'<span class="hd-stf-log-k">' + esc(KIND[x.kind] || x.kind) + '</span>' +
'<span class="hd-stf-log-b">' +
'<b>' + esc(p ? (p.name || p.handle) : 'Hereld itself') + '</b>' +
(x.model ? ' <span class="hd-dot">&middot;</span> ' + esc(x.model) : '') +
(x.ok ? '' : ' <span class="hd-stf-log-r">' + esc(x.detail || 'failed') + '</span>') +
'</span>' +
'<span class="hd-stf-log-t">' + esc(stamp(x.created_at)) + '</span>' +
'</div>';
}).join('') + '</div>';
}
function switchRow(key, title, line, f, bad) {
var on = !!(f && f.on_off);
return '<div class="hd-stf-switch' + (bad ? ' hd-stf-switch--bad' : '') + '">' +
'<div><b>' + esc(title) + '</b><small>' + esc(line) + '</small></div>' +
'<button class="nb-btn nb-btn--sm ' + (on ? 'nb-btn--green' : 'nb-btn--ghost') +
'" type="button" data-flag="' + esc(key) + '" data-next="' + (on ? '' : '1') + '">' +
(on ? 'On' : 'Off') + '</button></div>';
}
async function pageStaff(host) {
host.innerHTML = box('Staff',
'Roles are set here and checked in the database on every action. Removing a row removes the power, not just the buttons.',
'<form class="hd-stf-search" id="stfRoleF">' +
'<label class="nb-sr" for="stfRoleH">Handle</label>' +
'<input class="nb-input" id="stfRoleH" type="text" placeholder="handle" maxlength="20">' +
'<label class="nb-sr" for="stfRoleR">Role</label>' +
'<select class="nb-select" id="stfRoleR">' +
'<option value="moderator">Moderator</option>' +
'<option value="admin">Admin</option>' +
'<option value="superadmin">Superadmin</option>' +
'<option value="none">Remove</option>' +
'</select>' +
'<button class="nb-btn nb-btn--primary" type="submit">Apply</button>' +
'</form>' +
'<div class="hd-stf-rows" id="stfStaffRows">' + loading() + '</div>');
host.querySelector('#stfRoleF').addEventListener('submit', async function (e) {
e.preventDefault();
var h = host.querySelector('#stfRoleH').value.trim().toLowerCase().replace(/^@/, '');
var r2 = host.querySelector('#stfRoleR').value;
if (!h) { U.toast('Type a handle first.', 'bad'); return; }
var ok = await U.ask({
title: r2 === 'none' ? 'Remove staff role' : 'Set role',
line: r2 === 'none' ? 'Take every staff power from @' + h + '?' : 'Make @' + h + ' ' + r2 + '?',
yes: 'Apply', bad: r2 === 'superadmin' || r2 === 'none'
});
if (!ok) return;
if (await call('staff_set_role', { p_handle: h, p_role: r2 }, 'Role set, and logged.')) render();
});
var node = host.querySelector('#stfStaffRows');
var s = await db.from('staff').select('user_id,role,added_at').order('added_at', { ascending: true });
if (s.error) { node.innerHTML = broke(why(s.error)); return; }
if (!s.data.length) { node.innerHTML = empty('No staff on record.'); return; }
var pr = await db.from('profiles').select('id,handle,name,avatar_url')
.in('id', s.data.map(function (x) { return x.user_id; }));
var byId = {};
if (!pr.error) pr.data.forEach(function (p) { byId[p.id] = p; });
node.innerHTML = s.data.map(function (x) {
return '<div class="hd-stf-row">' + who(byId[x.user_id], 'since ' + H.when(x.added_at)) +
'<span class="hd-stf-row-tags">' + tag(x.role, 'blue') + '</span>' +
'<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" data-open-user="' + esc(x.user_id) + '">Open</button>' +
'</div>';
}).join('');
}
async function pagePlatform(host) {
host.innerHTML = box('Platform account',
'Reserved handles cannot be claimed by anyone. Granting one to an email lets that address, and only that address, claim it at sign-up.',
'<form class="hd-stf-search" id="stfGrant">' +
'<label class="nb-sr" for="stfGh">Handle</label>' +
'<input class="nb-input" id="stfGh" type="text" placeholder="swiftaw" maxlength="20">' +
'<label class="nb-sr" for="stfGe">Email</label>' +
'<input class="nb-input" id="stfGe" type="email" placeholder="address that will claim it">' +
'<button class="nb-btn nb-btn--primary" type="submit">Grant</button>' +
'</form>' +
'<div class="nb-alert nb-alert--info hd-stf-note">A claimed grant marks the account as a platform account. ' +
'That mark is not shown to ordinary members; it only changes how Hereld itself treats the account.</div>' +
'<h3 class="hd-stf-sub">Grants</h3><div class="hd-stf-rows" id="stfGrants">' + loading() + '</div>' +
'<h3 class="hd-stf-sub">Platform accounts</h3><div class="hd-stf-rows" id="stfPlats">' + loading() + '</div>');
host.querySelector('#stfGrant').addEventListener('submit', async function (e) {
e.preventDefault();
var h = host.querySelector('#stfGh').value.trim().toLowerCase().replace(/^@/, '');
var m = host.querySelector('#stfGe').value.trim();
if (!h || !m) { U.toast('Both fields, please.', 'bad'); return; }
if (await call('staff_grant_handle', { p_handle: h, p_email: m }, 'Granted. That address can claim it now.')) render();
});
var g = await db.from('handle_grants').select('*').order('created_at', { ascending: false });
var gn = host.querySelector('#stfGrants');
if (g.error) gn.innerHTML = broke(why(g.error));
else if (!g.data.length) gn.innerHTML = empty('No handles granted.');
else gn.innerHTML = g.data.map(function (x) {
return '<div class="hd-stf-row"><span class="hd-stf-who-t"><b>' + H.tag(x.handle) + '</b><small>' +
esc(x.email) + '</small></span><span class="hd-stf-row-tags">' +
(x.claimed_at ? tag('Claimed ' + H.when(x.claimed_at), 'ok') : tag('Waiting', 'warn')) + '</span></div>';
}).join('');
var p = await db.from('profiles').select('id,handle,name,avatar_url,created_at').eq('is_platform', true);
var pn = host.querySelector('#stfPlats');
if (p.error) pn.innerHTML = broke(why(p.error));
else if (!p.data.length) pn.innerHTML = empty('No platform accounts yet.');
else pn.innerHTML = p.data.map(function (x) {
return '<div class="hd-stf-row">' + who(x, 'joined ' + H.when(x.created_at)) +
'<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" data-open-user="' + esc(x.id) + '">Open</button></div>';
}).join('');
}
async function pageSettings(host) {
host.innerHTML = box('Platform settings', 'These are read by Hereld itself, not by a member.',
'<div id="stfFlags">' + loading() + '</div>');
var node = host.querySelector('#stfFlags');
var f = await db.from('platform_flags').select('*').order('key');
if (f.error) { node.innerHTML = broke(why(f.error)); return; }
node.innerHTML = f.data.map(function (x) {
return switchRow(x.key, x.key.replace(/_/g, ' '), x.text_value, x, x.key === 'bots_emergency') +
'<p class="hd-stf-when">Last changed ' + esc(stamp(x.updated_at)) + '</p>';
}).join('');
}
async function pageLog(host) {
host.innerHTML = box('Audit log', 'Every staff action, including a superadmin\'s. Nothing writes here except the console.',
'<div id="stfFeed">' + loading() + '</div>');
logInto(host.querySelector('#stfFeed'), 100);
}
async function logInto(node, limit) {
if (!node) return;
var r = await db.from('mod_actions').select('*').order('created_at', { ascending: false }).limit(limit);
if (r.error) { node.innerHTML = broke(why(r.error)); return; }
if (!r.data.length) { node.innerHTML = empty('Nothing has happened yet.'); return; }
var ids = [];
r.data.forEach(function (x) {
if (x.actor) ids.push(x.actor);
if (x.subject) ids.push(x.subject);
});
var byId = {};
if (ids.length) {
var pr = await db.from('profiles').select('id,handle,name,avatar_url').in('id', ids);
if (!pr.error) pr.data.forEach(function (p) { byId[p.id] = p; });
}
node.innerHTML = '<div class="hd-stf-log">' + r.data.map(function (x) {
var a = byId[x.actor], s = byId[x.subject];
return '<div class="hd-stf-log-i">' +
'<span class="hd-stf-log-k">' + esc(x.kind.replace(/_/g, ' ')) + '</span>' +
'<span class="hd-stf-log-b">' +
'<b>' + esc((a && (a.name || a.handle)) || 'Someone') + '</b>' +
(s ? ' on <b>' + esc(s.name || s.handle) + '</b>' : '') +
(x.reason ? ' <span class="hd-stf-log-r">' + esc(x.reason) + '</span>' : '') +
'</span>' +
'<span class="hd-stf-log-t">' + esc(stamp(x.created_at)) + '</span>' +
'</div>';
}).join('') + '</div>';
}
var PAINT = {
dash: pageDash, users: pageUsers, posts: pagePosts, reports: pageReports,
notes: pageNotes, companies: pageCompanies, bots: pageBots, nova: pageNova, staff: pageStaff,
platform: pagePlatform, settings: pageSettings, log: pageLog
};
var current = 'dash';
function allowed(id) {
var p = PAGES.filter(function (x) { return x.id === id; })[0];
return p && atLeast(p.min) ? id : 'dash';
}
function render() {
current = allowed(current);
col.innerHTML = shellHTML(current);
var host = col.querySelector('#stfPage');
var token = ++painting;
Promise.resolve()
.then(function () { return PAINT[current](host); })
.catch(function (e) { if (token === painting) host.innerHTML = broke(why(e)); });
}
function wire() {
if (col.dataset.stfWired) return;
col.dataset.stfWired = '1';
col.addEventListener('click', function (e) {
var t = e.target;
var nav = t.closest('[data-page]');
if (nav) { current = nav.dataset.page; render(); return; }
if (t.closest('[data-back-app]')) { go('home'); return; }
var u = t.closest('[data-open-user]');
if (u) { openUser(u.dataset.openUser); return; }
var pa = t.closest('[data-post-act]');
if (pa) { postAct(pa.dataset.postAct, pa.dataset.pid); return; }
var ra = t.closest('[data-rep-act]');
if (ra) {
call('staff_act', { p_kind: ra.dataset.repAct, p_post: ra.dataset.rid }, 'Report closed.')
.then(function (ok) { if (ok) render(); });
return;
}
var na = t.closest('[data-note-act]');
if (na) {
call('staff_act', { p_kind: na.dataset.noteAct, p_post: na.dataset.nid }, 'Decision recorded.')
.then(function (ok) { if (ok) render(); });
return;
}
var v = t.closest('[data-verif]');
if (v) { ruleVerif(v.dataset.vid, v.dataset.verif); return; }
var fl = t.closest('[data-flag]');
if (fl) {
var on = fl.dataset.next === '1';
var key = fl.dataset.flag;
call('staff_set_flag', { p_key: key, p_on: on }, 'Saved.').then(function (done) { if (done) render(); });
return;
}
var b = t.closest('[data-bot]');
if (b) {
call('staff_bot_state', { p_id: b.dataset.bot, p_active: b.dataset.on === '1' }, 'Saved. The account still exists.')
.then(function (ok) { if (ok) render(); });
}
});
}
window.HStaff = {
render: function (host, o) {
db = o.db; my = o.my; role = o.role; go = o.go; url = o.url; col = host;
if (!role) { col.innerHTML = broke('This console is for staff accounts.'); return; }
wire();
render();
}
};
})();
