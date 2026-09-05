(function () {
'use strict';
var H = window.Hereld, U = window.HU;
var db = null, me = null, my = null;
var el = function (id) { return document.getElementById(id); };
var esc = U.esc, ic = U.icon;
var MAX = 600;
var ATT_ACCEPT = [
'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif',
'video/mp4', 'video/webm', 'video/quicktime',
'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/aac',
'application/pdf', 'text/plain', 'text/csv', 'text/markdown',
'application/json', 'application/zip',
'application/msword',
'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
'application/vnd.ms-excel',
'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
'application/vnd.ms-powerpoint',
'application/vnd.openxmlformats-officedocument.presentationml.presentation',
'application/vnd.oasis.opendocument.text',
'application/vnd.oasis.opendocument.spreadsheet',
'.md', '.csv', '.txt'
].join(',');
var ATT_MAX = 4;
var ATT_BYTES = 64 * 1024 * 1024;
function kindOf(f) {
var t = String((f && f.type) || '').toLowerCase();
if (t.indexOf('image/') === 0) return 'image';
if (t.indexOf('video/') === 0) return 'video';
if (t.indexOf('audio/') === 0) return 'audio';
return 'file';
}
var TWEMOJI = 'https://cdn.jsdelivr.net/npm/@twemoji/api@15.1.0/dist/twemoji.min.js';
var TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/';
var WITH_AUTHOR = '*, author:profiles!posts_author_fkey(id,handle,name,headline,avatar_url,verified,is_company,is_platform,is_bot,banned,parent_id,assoc_of,assoc_kind,assoc_role,follower_count)' +
', poll:polls(post_id)' +
', media:post_media(url,alt_text,spoiler,position,kind,mime,name,size_bytes)';
var mine = { liked: {}, relayed: {}, saved: {}, following: {} };
var staffRole = null;
var twemojiAsked = false;
function twem(node) {
if (!node) return;
if (typeof paintPolls === 'function') paintPolls(node);
if (typeof paintRepliers === 'function') paintRepliers(node);
if (window.twemoji) {
try {
window.twemoji.parse(node, { folder: 'svg', ext: '.svg', className: 'hd-emo', base: TWEMOJI_BASE });
} catch (e) {}
return;
}
if (twemojiAsked) return;
twemojiAsked = true;
var s = document.createElement('script');
s.src = TWEMOJI; s.async = true; s.crossOrigin = 'anonymous';
s.onload = function () { twem(document.body); };
document.head.appendChild(s);
}
function base() {
var b = '/';
if (/\.github\.io$/i.test(location.hostname)) {
var s = location.pathname.split('/');
if (s[1]) b = '/' + s[1] + '/';
}
return b;
}
function here() {
var p = location.pathname.slice(base().length).replace(/^\/+|\/+$/g, '');
return p.replace(/\.html$/, '');
}
function url(path) { return base() + String(path || '').replace(/^\/+/, ''); }
function who(handle) { return url('@' + String(handle || '').toLowerCase()); }
var MARK_W = 256, MARK_H = 336;
function novaMark(cls) {
return '<span class="hd-nvm' + (cls ? ' ' + cls : '') + '" aria-hidden="true"></span>';
}
function novaArt(cls, h) {
return '<img class="hd-nva' + (cls ? ' ' + cls : '') + '" src="' + url('Supernova%20mark.png') +
'" alt="" height="' + h + '" width="' + Math.round(h * MARK_W / MARK_H) + '">';
}
function novaAv(cls, h) {
return '<span class="hd-nova-av-wrap' + (cls ? ' ' + cls : '') + '" style="width:' + h + 'px;height:' + h + 'px">' +
novaArt('hd-nva--grad', h) + '</span>';
}
function go(path, replace) {
var to = url(path);
if (replace) history.replaceState({}, '', to);
else history.pushState({}, '', to);
render();
window.scrollTo(0, 0);
}
function link(path, text, cls, extra) {
return '<a href="' + url(path) + '" data-r' + (cls ? ' class="' + cls + '"' : '') +
(extra || '') + '>' + text + '</a>';
}
var PIC_RE = /https?:\/\/[^\s<]+?\.(?:png|jpe?g|webp|gif|avif)(?:\?[^\s<]*)?/gi;
var VID_RE = /https?:\/\/[^\s<]+?\.(?:mp4|webm|mov)(?:\?[^\s<]*)?/gi;
function mediaOf(text) {
var out = [], seen = {}, s = String(text || '');
s.replace(PIC_RE, function (u) { if (!seen[u]) { seen[u] = 1; out.push({ kind: 'image', url: u }); } return u; });
s.replace(VID_RE, function (u) { if (!seen[u]) { seen[u] = 1; out.push({ kind: 'video', url: u }); } return u; });
return out;
}
function attOf(p) {
var rows = p && p.media;
if (rows && rows.length) {
return rows.slice().sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
}
return mediaOf(p && p.body);
}
var WEIGHTS = ['B', 'KB', 'MB', 'GB'];
function weigh(n) {
n = Number(n) || 0;
var i = 0;
while (n >= 1024 && i < WEIGHTS.length - 1) { n /= 1024; i++; }
return (i === 0 ? Math.round(n) : n.toFixed(n < 10 ? 1 : 0)) + ' ' + WEIGHTS[i];
}
var KINDS = { pic: 'image', vid: 'video', image: 'image', video: 'video', audio: 'audio', file: 'file' };
function mediaHTML(list) {
if (!list || !list.length) return '';
var few = list.slice(0, 4);
var shots = [], rest = [], nth = 0;
few.forEach(function (m) {
var k = KINDS[m.kind] || 'file';
if (k === 'image') shots.push({ m: m, k: k, i: nth++ });
else if (k === 'video') shots.push({ m: m, k: k, i: -1 });
else rest.push({ m: m, k: k });
});
var out = '';
if (shots.length) {
out += '<div class="hd-shots hd-shots--' + shots.length + '">' + shots.map(function (s) {
var m = s.m, inner;
if (s.k === 'video') {
inner = '<video class="hd-shot hd-shot--vid" src="' + esc(m.url) +
'" controls playsinline preload="metadata"></video>';
} else {
inner = '<button class="hd-shot-btn" type="button" data-shot="' + esc(m.url) +
'" data-shot-i="' + s.i + '" aria-label="' +
esc(m.alt_text ? 'Open picture: ' + m.alt_text : 'Open picture') + '">' +
'<img class="hd-shot" src="' + esc(m.url) + '" alt="' + esc(m.alt_text || '') +
'" loading="lazy" decoding="async"></button>';
}
return m.spoiler
? '<div class="hd-spoiler"><div class="hd-spoiler-in">' + inner + '</div>' +
'<button class="hd-spoiler-bar" type="button" data-reveal>Sensitive. Tap to see it.</button></div>'
: inner;
}).join('') + '</div>';
}
if (rest.length) {
out += '<div class="hd-files">' + rest.map(function (f) {
var m = f.m;
var name = m.name || decodeURIComponent(String(m.url).split('?')[0].split('/').pop() || 'Attachment');
var size = m.size_bytes ? weigh(m.size_bytes) : '';
if (f.k === 'audio') {
return '<div class="hd-file hd-file--sound">' +
'<div class="hd-file-line">' + ic('file', 'hd-file-ico') +
'<span class="hd-file-name">' + esc(name) + '</span>' +
(size ? '<span class="hd-file-size">' + esc(size) + '</span>' : '') + '</div>' +
'<audio class="hd-file-play" src="' + esc(m.url) + '" controls preload="metadata"></audio></div>';
}
return '<a class="hd-file hd-file--doc" href="' + esc(m.url) +
'" target="_blank" rel="noopener" download>' + ic('file', 'hd-file-ico') +
'<span class="hd-file-name">' + esc(name) +
(m.alt_text ? '<i>' + esc(m.alt_text) + '</i>' : '') + '</span>' +
'<span class="hd-file-size">' + esc(size || 'Open') + '</span>' +
ic('out', 'hd-file-go') + '</a>';
}).join('') + '</div>';
}
return out;
}
function body(text, o) {
o = o || {};
var out = esc(String(text == null ? '' : text).replace(/[\u0000-\u0002]/g, ''));
var kept = [];
function park(html) { kept.push(html); return '\u0001' + (kept.length - 1) + '\u0001'; }
if (!o.keepMedia) {
out = out.replace(PIC_RE, '').replace(VID_RE, '');
}
out = out.replace(/`([^`\n]+)`/g, function (m, c) { return park('<code class="hd-code">' + c + '</code>'); });
out = out.replace(/\bhttps?:\/\/[^\s<]+/g, function (u) {
var trim = u.replace(/[.,;:!?)\]]+$/, '');
var tail = u.slice(trim.length);
return park('<a href="' + trim + '" target="_blank" rel="noopener nofollow">' +
esc(trim.replace(/^https?:\/\/(www\.)?/, '')) + '</a>') + tail;
});
out = out.replace(/(^|[\s(])@([a-z0-9_]{3,20})\b/gi, function (m, pre, h) {
return pre + park('<a href="' + who(h) + '" data-r data-card="' + esc(h.toLowerCase()) +
'" class="hd-mention">' + H.tag(h) + '</a>');
});
out = out.replace(/(^|[\s(])#([a-z0-9_]{2,30})\b/gi, function (m, pre, t) {
return pre + park('<a href="' + url('search?q=' + encodeURIComponent('#' + t)) +
'" data-r class="hd-tag-link">#' + esc(t) + '</a>');
});
out = out.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<i>$2</i>');
out = out.replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, '$1<i>$2</i>');
out = out.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
out = out.replace(/(^|<br>)&gt;\s?([^\n]*)/g, function (m, pre, line) {
return pre + '<span class="hd-said">' + line + '</span>';
});
out = out.replace(/\n/g, '<br>');
out = out.replace(/\u0001(\d+)\u0001/g, function (m, i) { return kept[+i]; });
return out.replace(/(<br>\s*){3,}/g, '<br><br>').replace(/^(<br>)+|(<br>)+$/g, '');
}
function num(n) {
n = Number(n || 0);
if (n < 1000) return String(n);
if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'K';
return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
}
function badges(p) {
var out = '';
if (p.verified) {
out += p.is_company
? '<span class="hd-badge hd-badge--co" title="Verified company">' + ic('verified') +
'<span class="nb-sr">Verified company</span></span>'
: '<span class="hd-badge hd-badge--ver" title="Verified account">' + ic('verified') +
'<span class="nb-sr">Verified account</span></span>';
}
if (p.parent) {
out += '<a class="hd-badge hd-badge--par" href="' + url(p.parent.handle) + '" data-r ' +
'title="' + esc(assocWord(p)) + '">' +
H.avatar(p.parent, 'hd-av--pin') +
'<span class="nb-sr">' + esc(assocWord(p)) + '</span></a>';
}
return out;
}
function assocWord(p) {
var co = (p.parent && (p.parent.name || p.parent.handle)) || 'a company';
var held = p.assoc_kind ? p.assoc_kind === 'account' : !!p.parent_id;
var what = held ? 'Account held by ' + co : 'Associated with ' + co;
return p.assoc_role ? p.assoc_role + ' - ' + what : what;
}
function nameMark(p, txt) {
return '<span class="hd-nm"><b>' + esc(txt || p.name || p.handle) + '</b>' + badges(p) + '</span>';
}
function avatarOf(p, cls) {
return H.avatar(p, cls || '');
}
function nameLine(p, stamp, extra) {
var count = p.follower_count == null ? '' :
'<span class="hd-who-fol">' + num(p.follower_count) + ' follower' + (p.follower_count === 1 ? '' : 's') + '</span>';
return '<span class="hd-who">' +
link('@' + p.handle, '<b>' + esc(p.name || p.handle) + '</b>', 'hd-who-name', ' data-card="' + esc(p.handle || '') + '"') +
badges(p) +
link('@' + p.handle, H.tag(p.handle), 'hd-who-at', ' data-card="' + esc(p.handle || '') + '"') + count +
(stamp ? '<span class="hd-dot">&middot;</span><span class="hd-when">' + esc(stamp) + '</span>' : '') +
(extra || '') + '</span>';
}
function act(kind, ico, label, count, on, extra) {
return '<button class="hd-act hd-act--' + kind + (on ? ' is-on' : '') + '" type="button" ' +
(extra || '') + ' aria-label="' + esc(label) + '" data-tip="' + esc(label) + '">' +
ic(ico) + '<span class="hd-act-n">' + (count == null ? '' : num(count)) + '</span></button>';
}
function acts(p) {
var owned = !!(my && p.author && p.author.id === my.id);
return '<div class="hd-acts" data-id="' + p.id + '">' +
act('reply',  'comment',  'Reply',   p.reply_count,   false, 'data-do="reply"') +
act('relay',  'relay',    'Relay',   p.relay_count,   mine.relayed[p.id],  'data-do="relay"') +
act('like',   'heart',    'Like',    p.endorse_count, mine.liked[p.id],    'data-do="like"') +
act('views',  'chart',    'Views',   p.view_count,    false, 'data-do="views"') +
act('save',   'bookmark', mine.saved[p.id] ? 'Saved' : 'Save', null, mine.saved[p.id], 'data-do="save"') +
act('share',  'share',    'Share',   null, false, 'data-do="share"') +
'<button class="hd-act hd-act--nova" type="button" data-do="nova" ' +
'aria-label="Ask Supernova about this" data-tip="Ask Supernova">' +
novaMark('hd-act-nvm') + '</button>' +
'<button class="hd-act hd-act--more" type="button" data-do="more" data-own="' + (owned ? '1' : '') + '" ' +
'aria-haspopup="menu" aria-expanded="false" aria-label="More" data-tip="More">' + ic('more') + '</button>' +
'</div>';
}
function card(p, o) {
o = o || {};
var a = p.author || {};
var lead = '';
var note = p.note ? '<div class="hd-cnote">' +
'<b>' + ic('info') + ' Community note</b><p>' + body(p.note.body) + '</p>' +
(p.note.source ? '<a href="' + esc(p.note.source) + '" target="_blank" rel="noopener nofollow">Source</a>' : '') +
(p.note.wrapped
? '<span class="hd-cnote-from">Written up by Supernova from ' +
(p.note.from === 1 ? 'one contribution' : num(p.note.from) + ' contributions') + '. ' +
'<button class="hd-cnote-add" type="button" data-note="' + p.id + '">Add context</button></span>'
: '') +
'</div>' : '';
if (p.relayed_by) {
lead = '<div class="hd-lead">' + ic('relay') +
link(p.relayed_by.handle, esc(p.relayed_by.name || p.relayed_by.handle)) + ' relayed this</div>';
} else if (p.reply_at) {
lead = '<div class="hd-lead">' + ic('comment') + ' Replying to ' +
link(p.reply_at.handle, H.tag(p.reply_at.handle), 'hd-lead-at') + '</div>';
}
var quoted = p.quote ? '<div class="hd-quote" data-open="' + p.quote.id + '">' +
'<div class="hd-quote-top">' + avatarOf(p.quote.author, 'hd-av--xs') +
nameLine(p.quote.author, H.when(p.quote.created_at)) + '</div>' +
'<p>' + body(p.quote.body) + '</p>' + mediaHTML(attOf(p.quote).slice(0, 1)) + '</div>' : '';
var shots = mediaHTML(attOf(p));
var said = body(p.body);
return '<article class="nb-card hd-post' + (o.lead ? ' hd-post--lead' : '') + '" data-post="' + p.id +
'" data-author="' + esc(a.handle || '') + '"' + (o.lead ? '' : ' data-open="' + p.id + '" tabindex="0" role="link"') + '>' +
lead +
'<div class="hd-post-top">' +
'<a class="hd-av-btn" href="' + who(a.handle) + '" data-r data-card="' + esc(a.handle || '') + '" ' +
'aria-label="' + esc(a.name || a.handle || '') + '">' + avatarOf(a) + '</a>' +
'<div class="hd-post-who">' + nameLine(a, H.when(p.created_at)) +
(a.headline ? '<i class="hd-head">' + esc(a.headline) + '</i>' : '') +
'</div>' +
'</div>' +
discHTML(p.disclosure) +
(p.scheduled_for
? '<p class="hd-planned">' + ic('clock') + ' Going out ' +
esc(new Date(p.scheduled_for).toLocaleString(undefined,
{ weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })) +
'. Only you can see it until then.</p>'
: '') +
(said ? '<p class="hd-post-body">' + said + (p.edited_at ? ' <span class="hd-edited">· edited</span>' : '') + '</p>' : '') +
shots + pollHTML(p) + quoted + note +
scopeNote(p) + '<div class="hd-repliers" data-repliers="' + p.id + '"></div>' +
acts(p) +
'</article>';
}
function discHTML(list) {
if (!list || !list.length) return '';
return '<p class="hd-disc">' + list.map(function (k) {
var d = DISCLOSE.filter(function (x) { return x.k === k; })[0];
return d ? '<span>' + ic('info') + esc(d.t) + '</span>' : '';
}).join('') + '</p>';
}
function scopeNote(p) {
if (!p.reply_scope || p.reply_scope === 'all') return '';
var s = scopeOf(p.reply_scope);
return '<p class="hd-scope-note">' + ic(s.i) + ' ' + esc(s.t) + ' can reply</p>';
}
function pollHTML(p) {
if (!p.poll && !p.has_poll) return '';
return '<div class="hd-poll" data-pollof="' + p.id + '"><div class="hd-poll-wait">' +
'<span class="nb-skel nb-skel--line"></span><span class="nb-skel nb-skel--line"></span></div></div>';
}
function pollBars(st, id) {
var opts = st.options || [];
var counts = st.counts || [];
var total = Number(st.total || 0);
var done = st.closed || st.mine != null;
var out = opts.map(function (t, i) {
var n = Number(counts[i] || 0);
var pc = total ? Math.round(n / total * 100) : 0;
if (!done) {
return '<button class="hd-poll-one" type="button" data-answer="' + i + '">' + esc(t) + '</button>';
}
return '<div class="hd-poll-done' + (st.mine === i ? ' is-mine' : '') + '">' +
'<span class="hd-poll-fill" style="width:' + pc + '%"></span>' +
'<span class="hd-poll-t">' + esc(t) + (st.mine === i ? ' ' + ic('tick') : '') + '</span>' +
'<span class="hd-poll-pc">' + pc + '%</span></div>';
}).join('');
var left = '';
if (st.closed) left = 'Closed';
else {
var ms = new Date(st.closes_at).getTime() - Date.now();
var hrs = Math.max(0, Math.round(ms / 3600000));
left = hrs >= 24 ? Math.round(hrs / 24) + (hrs < 48 ? ' day left' : ' days left')
: hrs >= 1 ? hrs + (hrs === 1 ? ' hour left' : ' hours left')
: 'Less than an hour left';
}
return out + '<p class="hd-poll-sum">' +
(total === 1 ? '1 answer' : num(total) + ' answers') + ' · ' + esc(left) + '</p>';
}
async function loadProfileSummary(handle, container, btn) {
btn.disabled = true;
btn.innerHTML = '<span class="nb-loader nb-loader--sm"></span> Summarising';
try {
var got = await H.fn('supernova?job=profile_summary', { handle: handle });
var text = (got && got.text || '').trim();
if (!text) throw new Error('empty');
var existing = container.querySelector('.hd-pcard-summary-out');
if (existing) existing.remove();
var div = document.createElement('div');
div.className = 'hd-pcard-summary-out';
div.innerHTML = '<p class="hd-pcard-summary-label">' + novaAv('hd-nva--grad', 20) + ' Summary</p>' +
'<p class="hd-pcard-summary-text">' + esc(text) + '</p>';
container.appendChild(div);
btn.remove();
} catch (e) {
btn.innerHTML = ic('sparkle') + ' Try again';
btn.disabled = false;
}
}
function openProfileSummary(p) {
var handle = p.handle || '';
var who = p.name || handle;
var avatar = H.avatar(p, 'hd-av--md');
U.sheet({
wide: true,
title: '',
html:
'<div class="hd-look-card">' +
'<div class="hd-look-head">' +
'<span class="hd-look-title">' + novaAv('hd-nva--grad', 20) + ' Supernova on this profile</span>' +
'<div class="hd-look-actions">' +
'<button class="nb-icon-btn" type="button" data-look-close title="Close">' + ic('x') + '</button>' +
'</div>' +
'</div>' +
'<div class="hd-look-post">' +
'<div class="hd-look-post-inner">' +
'<a href="' + url('profile/' + handle) + '" data-r class="hd-look-post-av">' + avatar + '</a>' +
'<div class="hd-look-post-who">' +
'<a href="' + url('profile/' + handle) + '" data-r class="hd-look-post-name">' + esc(who) + badges(p) + '</a>' +
'<span class="hd-look-post-handle">' + H.tag(handle) + '</span>' +
'</div>' +
'</div>' +
(p.headline ? '<p class="hd-look-post-head">' + esc(p.headline) + '</p>' : '') +
(p.bio ? '<p class="hd-look-post-body">' + body(p.bio) + '</p>' : '') +
'</div>' +
'<div class="hd-look-loading" id="lookLoad">' +
'<span class="hd-nova-dots"><i></i><i></i><i></i></span> Reading it' +
'</div>' +
'<div class="hd-look-answer" id="lookAns" hidden></div>' +
'</div>',
wire: function (api) {
api.q('[data-look-close]').addEventListener('click', api.close);
twem(api.body);
H.fn('supernova?job=profile_summary', { handle: handle }).then(function (got) {
var text = (got && got.text || '').trim();
var load = api.q('#lookLoad');
var ans = api.q('#lookAns');
if (!text) { if (load) load.innerHTML = 'Nothing came back.'; return; }
if (load) load.hidden = true;
if (ans) { ans.hidden = false; ans.innerHTML = '<p>' + esc(text) + '</p>'; twem(ans); }
}).catch(function (e) {
var load = api.q('#lookLoad');
if (load) load.innerHTML = '<span class="hd-nova-bad">' + esc(e.message || 'Could not generate summary.') + '</span>';
});
}
});
}
var newPostsScroll = null;
function wireNewPosts(rpcName) {
if (newPostsScroll) { col.removeEventListener('scroll', newPostsScroll); newPostsScroll = null; }
var capsule = col.querySelector('[data-new-posts]');
var avsEl = col.querySelector('[data-new-avs]');
var tEl = col.querySelector('[data-new-t]');
if (!capsule) return;
var firstId = null;
var feed = el('feed');
if (feed) {
var firstPost = feed.querySelector('[data-post]');
if (firstPost) firstId = firstPost.getAttribute('data-post');
}
var queue = [];
var isExplore = parts()[0] === 'explore';
function renderQueue() {
if (!queue.length) return;
if (!col.querySelector('[data-new-posts]')) return;
capsule.hidden = false;
var shown = queue.slice(0, 5);
avsEl.innerHTML = shown.map(function (p) {
var u = p.profiles;
return '<span class="hd-new-posts-av">' +
(u && u.avatar_url
? '<img alt="" src="' + esc(u.avatar_url) + '">'
: '<span class="hd-av-n">' + esc((u && (u.name || u.handle) || '?')[0]).toUpperCase() + '</span>') +
'</span>';
}).join('');
var count = queue.length;
var who = shown.length === 1 && shown[0].profiles
? (shown[0].profiles.name || shown[0].profiles.handle) + ' posted'
: count + ' new post' + (count === 1 ? '' : 's');
tEl.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg> ' + esc(who);
}
var lastScroll = 0;
newPostsScroll = function () {
var st = col.scrollTop;
var scrollingUp = st < lastScroll - 30;
lastScroll = st;
if (scrollingUp && !capsule.hidden) capsule.hidden = true;
};
col.addEventListener('scroll', newPostsScroll);
capsule.onclick = function () {
capsule.hidden = true;
queue = [];
col.scrollTop = 0;
if (chan) try { db.removeChannel(chan); } catch (e) {}
if (isExplore) viewExplore(); else viewHome();
};
var chan = null;
try {
chan = db.channel('hd-new-posts-' + Date.now())
.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, async function (payload) {
if (!col.querySelector('[data-new-posts]')) { try { db.removeChannel(chan); } catch (e) {} return; }
var nid = payload.new && payload.new.id;
var authorId = payload.new && payload.new.author;
if (!nid) return;
if (nid === firstId) return;
if (queue.some(function (x) { return x.id === nid; })) return;
if (authorId && my && authorId === my.id) return;
if (!firstId) {
var f2 = el('feed');
if (f2) { var fp2 = f2.querySelector('[data-post]'); if (fp2) firstId = fp2.getAttribute('data-post'); }
}
var prof = null;
if (authorId) {
try { var pr = await db.from('profiles').select('handle,name,avatar_url').eq('id', authorId).maybeSingle(); prof = pr.data; } catch (e) {}
}
queue.unshift({ id: nid, profiles: prof });
if (queue.length > 25) queue.length = 25;
renderQueue();
}).subscribe();
} catch (e) {}
var poller = setInterval(async function () {
if (!col.querySelector('[data-new-posts]')) { clearInterval(poller); if (chan) try { db.removeChannel(chan); } catch (e2) {} return; }
if (!firstId) {
var f = el('feed');
if (f) { var fp = f.querySelector('[data-post]'); if (fp) firstId = fp.getAttribute('data-post'); }
}
if (!firstId) return;
var r = await db.rpc(rpcName, { p_limit: 25 });
if (r.error || !r.data || !r.data.length) return;
var newer = [];
for (var i = 0; i < r.data.length; i++) {
if (r.data[i].id === firstId) break;
if (queue.some(function (x) { return x.id === r.data[i].id; })) continue;
newer.push(r.data[i]);
}
if (!newer.length) return;
for (var j = newer.length - 1; j >= 0; j--) {
var row = newer[j];
var u2 = null;
try {
var rr = await db.from('profiles').select('handle,name,avatar_url').eq('id', row.author).maybeSingle();
u2 = rr.data;
} catch (e3) {}
queue.unshift({ id: row.id, profiles: u2 || row.profiles || null });
}
if (queue.length > 25) queue.length = 25;
renderQueue();
}, 15000);
}
async function paintPolls(root) {
var boxes = [].slice.call((root || document).querySelectorAll('[data-pollof]:not([data-done])'));
for (var i = 0; i < boxes.length; i++) {
var box = boxes[i];
box.setAttribute('data-done', '1');
var id = box.getAttribute('data-pollof');
var r = await db.rpc('poll_state', { p_post: id });
if (r.error || !r.data) { box.remove(); continue; }
box.innerHTML = pollBars(r.data, id);
}
}
async function paintRepliers(root) {
var boxes = [].slice.call((root || document).querySelectorAll('[data-repliers]:not([data-done])'));
for (var i = 0; i < boxes.length; i++) {
var box = boxes[i];
var id = box.getAttribute('data-repliers');
var r = await db.rpc('post_repliers', { p_post_id: id, p_limit: 3 });
if (r.error || !r.data || !r.data.length) { box.remove(); continue; }
box.setAttribute('data-done', '1');
var avs = r.data.map(function (u) {
return '<a class="hd-av-btn" href="#/' + esc(u.handle) + '" data-r>' +
'<span class="hd-av hd-av--sm">' +
(u.avatar_url
? '<img alt="" loading="lazy" src="' + esc(u.avatar_url) + '">'
: '<span class="hd-av-n">' + esc((u.name || u.handle || '?')[0]).toUpperCase() + '</span>') +
'</span></a>';
}).join('');
var count = r.data.length;
box.innerHTML = '<div class="hd-repliers-av">' + avs + '</div>' +
'<span class="hd-repliers-t">' + count + (count === 1 ? ' person' : ' people') + ' replied</span>';
}
}
async function answerPoll(box, id, choice) {
box.classList.add('is-busy');
var r = await db.rpc('poll_vote', { p_post: id, p_choice: choice });
box.classList.remove('is-busy');
if (r.error) return U.toast(H.trouble(r.error, 'That answer did not go through.'));
box.innerHTML = pollBars(r.data, id);
}
function feedHTML(rows, o) {
if (!rows.length) return '';
return rows.map(function (p) { return card(p, o); }).join('');
}
function skeletons(n) {
var one = '<article class="nb-card hd-post hd-skel" aria-hidden="true">' +
'<div class="hd-post-top"><span class="nb-skel nb-skel--av"></span>' +
'<div class="hd-post-who"><span class="nb-skel nb-skel--line" style="width:44%"></span></div></div>' +
'<p class="hd-post-body"><span class="nb-skel nb-skel--line"></span>' +
'<span class="nb-skel nb-skel--line" style="width:72%"></span></p></article>';
return new Array(n + 1).join(one);
}
function empty(title, line, cta) {
return '<div class="nb-card nb-card--lg hd-empty">' +
'<span class="hd-empty-mark">' + ic('quill') + '</span>' +
'<h3 class="nb-h3">' + esc(title) + '</h3>' +
'<p>' + esc(line) + '</p>' + (cta || '') + '</div>';
}
function broke(what, retry) {
return '<div class="nb-card nb-card--lg hd-empty hd-empty--bad">' +
'<span class="hd-empty-mark">' + ic('warn') + '</span>' +
'<h3 class="nb-h3">That did not load</h3>' +
'<p>' + esc(what || 'Something went wrong reaching Hereld.') + '</p>' +
'<button class="nb-btn nb-btn--primary nb-btn--sm" type="button" data-retry>' + ic('again') + ' Try again</button></div>';
}
async function markMine(rows) {
if (!my || !rows.length) return;
var ids = rows.map(function (p) { return p.id; });
var got = await Promise.all([
db.from('endorsements').select('post_id').eq('user_id', my.id).in('post_id', ids),
db.from('posts').select('relay_of').eq('author', my.id).in('relay_of', ids),
db.from('bookmarks').select('post_id').eq('user_id', my.id).in('post_id', ids)
]);
(got[0].data || []).forEach(function (r) { mine.liked[r.post_id] = true; });
(got[1].data || []).forEach(function (r) { mine.relayed[r.relay_of] = true; });
(got[2].data || []).forEach(function (r) { mine.saved[r.post_id] = true; });
}
async function attachRelays(rows) {
var need = rows.filter(function (p) { return p.relay_of; }).map(function (p) { return p.relay_of; });
if (!need.length) return rows;
var r = await db.from('posts').select(WITH_AUTHOR).in('id', need);
var by = {};
(r.data || []).forEach(function (p) { by[p.id] = p; });
return rows.map(function (p) {
if (!p.relay_of || !by[p.relay_of]) return p;
var orig = by[p.relay_of];
if (!p.body) {
var copy = Object.assign({}, orig);
copy.relayed_by = p.author;
copy.relay_row = p.id;
return copy;
}
p.quote = orig;
return p;
});
}
async function attachNotes(rows) {
if (!rows.length) return rows;
var ids = rows.map(function (p) { return p.id; });
var s = await db.from('note_summaries').select('post_id,body,from_count').in('post_id', ids);
(s.data || []).forEach(function (n) {
var p = rows.filter(function (x) { return x.id === n.post_id; })[0];
if (p) p.note = { body: n.body, from: n.from_count, wrapped: true };
});
var left = rows.filter(function (p) { return !p.note; }).map(function (p) { return p.id; });
if (!left.length) return rows;
var r = await db.from('community_notes').select('post_id,body,source')
.in('post_id', left).eq('status', 'published');
var by = {};
(r.data || []).forEach(function (n) { if (!by[n.post_id]) by[n.post_id] = n; });
rows.forEach(function (p) { if (!p.note && by[p.id]) p.note = by[p.id]; });
return rows;
}
async function attachReplies(rows) {
var need = rows.filter(function (p) { return p.reply_to && !p.reply_at; })
.map(function (p) { return p.reply_to; });
if (!need.length) return rows;
var r = await db.from('posts')
.select('id, author:profiles!posts_author_fkey(id,handle,name)').in('id', need);
var by = {};
(r.data || []).forEach(function (x) { if (x.author) by[x.id] = x.author; });
rows.forEach(function (p) { if (by[p.reply_to]) p.reply_at = by[p.reply_to]; });
return rows;
}
async function attachParents(rows) {
var need = [], seen = {};
rows.forEach(function (p) {
var a = p.author, k = a && (a.assoc_of || a.parent_id);
if (k && !seen[k]) { seen[k] = 1; need.push(k); }
});
if (!need.length) return rows;
var r = await db.from('profiles').select('id,handle,name,avatar_url,is_company').in('id', need);
var by = {};
(r.data || []).forEach(function (x) { by[x.id] = x; });
rows.forEach(function (p) {
var a = p.author, k = a && (a.assoc_of || a.parent_id);
if (k && by[k]) a.parent = by[k];
});
return rows;
}
async function attachAssoc(people) {
var need = [], seen = {};
(people || []).forEach(function (p) {
var k = p && (p.assoc_of || p.parent_id);
if (k && !seen[k]) { seen[k] = 1; need.push(k); }
});
if (!need.length) return people;
var r = await db.from('profiles').select('id,handle,name,avatar_url,is_company').in('id', need);
var by = {};
(r.data || []).forEach(function (x) { by[x.id] = x; });
people.forEach(function (p) {
var k = p && (p.assoc_of || p.parent_id);
if (k && by[k]) p.parent = by[k];
});
return people;
}
async function hydrate(rows) {
rows = rows || [];
rows = await attachRelays(rows);
await Promise.all([attachNotes(rows), attachReplies(rows), attachParents(rows), markMine(rows)]);
return rows;
}
var seen = {}, pending = [], seenT = null, watcher = null;
function watchViews(scope) {
if (!my || !('IntersectionObserver' in window)) return;
if (!watcher) {
watcher = new IntersectionObserver(function (list) {
list.forEach(function (e) {
if (!e.isIntersecting) return;
var id = e.target.getAttribute('data-post');
watcher.unobserve(e.target);
if (!id || seen[id]) return;
seen[id] = true;
pending.push(id);
clearTimeout(seenT);
seenT = setTimeout(flushViews, 1200);
});
}, { threshold: 0.5 });
}
(scope || document).querySelectorAll('[data-post]').forEach(function (n) { watcher.observe(n); });
}
function flushViews() {
var batch = pending.splice(0, 40);
if (!batch.length) return;
db.rpc('post_seen', { p_ids: batch }).then(function () {}, function () {});
}
var NAV = [
{ path: 'home', label: 'Home', ic: 'home' },
{ path: 'explore', label: 'Explore', ic: 'compass' },
{ path: 'notifications', label: 'Notifications', ic: 'bell', badge: 'notes' },
{ path: 'supernova', label: 'Ask Supernova', nova: true },
{ path: 'bookmarks', label: 'Bookmarks', ic: 'bookmark' },
{ path: 'profile', label: 'Profile', ic: 'user' },
{ path: 'settings', label: 'Settings', ic: 'gear' }
];
var unread = 0;
function railHTML(active) {
var items = NAV.map(function (n) {
var on = active === n.path || (n.path === 'profile' && active === 'me');
var glyph = n.nova
? novaMark('hd-nav-nvm')
: ic(n.ic);
var dot = (n.badge === 'notes' && unread)
? '<span class="hd-nav-dot">' + (unread > 9 ? '9+' : unread) + '</span>' : '';
return link(n.path, glyph + '<span>' + esc(n.label) + '</span>' + dot,
'hd-nav-item' + (on ? ' is-on' : ''), on ? ' aria-current="page"' : '');
}).join('');
var staff = staffRole
? link('staff', ic('shield') + '<span>Staff console</span>', 'hd-nav-item hd-nav-item--staff' + (active === 'staff' ? ' is-on' : ''))
: '';
var chip = my ? '<button class="hd-me" type="button" id="meChip">' +
avatarOf(my, 'hd-av--sm') +
'<span class="hd-me-txt"><b>' + esc(my.name || my.handle) + '</b><i>' + H.tag(my.handle) + '</i></span>' +
ic('more') + '</button>'
: '<div class="hd-me-out">' +
link('join?mode=in', 'Sign in', 'nb-btn nb-btn--ghost nb-btn--sm nb-btn--block') +
link('join', 'Join Hereld', 'nb-btn nb-btn--primary nb-btn--sm nb-btn--block') + '</div>';
return '<div class="hd-rail-in">' +
link('home', '<img src="' + url('Hereld%20logomark.png') + '" alt="Hereld">', 'hd-brand hd-rail-brand') +
'<nav class="hd-nav" aria-label="Hereld">' + items + staff + '</nav>' +
(my ? '<button class="nb-btn nb-btn--primary nb-btn--block hd-write" type="button" id="writeBtn">' +
ic('quill') + ' Post</button>' : '') +
chip + '</div>';
}
function barHTML(active) {
var picks = ['home', 'explore', 'notifications', 'bookmarks', 'profile'];
return picks.map(function (p) {
var n = NAV.filter(function (x) { return x.path === p; })[0];
var on = active === p;
var dot = (p === 'notifications' && unread) ? '<span class="hd-nav-dot"></span>' : '';
return link(n.path, ic(n.ic) + dot + '<span class="nb-sr">' + esc(n.label) + '</span>',
'hd-bar-item' + (on ? ' is-on' : ''));
}).join('') +
(my ? '<button class="hd-bar-write" type="button" id="writeFab" aria-label="Write a post">' + ic('quill') + '</button>' : '');
}
function head(title, sub, o) {
o = o || {};
return '<header class="hd-col-head">' +
(o.back ? '<button class="nb-icon-btn nb-icon-btn--round hd-back" type="button" data-back aria-label="Back">' + ic('back') + '</button>' : '') +
'<div class="hd-col-head-txt"><h1>' + title + '</h1>' +
(sub ? '<p>' + sub + '</p>' : '') + '</div>' +
(o.tools || '') + '</header>';
}
function tabs(list, active) {
return '<nav class="hd-tabs" aria-label="Sections">' + list.map(function (t) {
return link(t.path, esc(t.label), 'hd-tab' + (t.key === active ? ' is-on' : ''),
t.key === active ? ' aria-current="page"' : '');
}).join('') + '</nav>';
}
var composeSeq = 0;
var held = [];
async function loadHeld() {
if (!my || !my.is_company) { held = []; return; }
var r = await db.from('profiles').select('id,handle,name').eq('parent_id', my.id).limit(50);
held = (r.data || []);
}
var NOVA_WAYS = [
{ k: 'tidy',   t: 'Tidy it up' },
{ k: 'short',  t: 'Make it shorter' },
{ k: 'plain',  t: 'Say it plainly' },
{ k: 'warm',   t: 'Warmer' },
{ k: 'sharp',  t: 'Sharper' },
{ k: 'more',   t: 'Say more of it' }
];
function askKeep() {
return new Promise(function (done) {
var said = null;
var s = U.sheet({
title: 'Save this post?',
html: '<p class="hd-ask-line">You can finish it later from your drafts.</p>' +
'<div class="hd-ask-foot hd-ask-foot--stack">' +
'<button class="nb-btn nb-btn--primary nb-btn--block" type="button" data-save data-focus>Save</button>' +
'<button class="nb-btn nb-btn--ghost nb-btn--block" type="button" data-drop>Discard</button>' +
'</div>',
onClose: function () { done(said || 'stay'); },
wire: function (api) {
api.q('[data-save]').addEventListener('click', function () { said = 'save'; api.close(); });
api.q('[data-drop]').addEventListener('click', function () { said = 'drop'; api.close(); });
}
});
return s;
});
}
function draftKey() { return 'hereld.drafts.' + ((my && my.id) || 'anon'); }
function drafts() {
try { return JSON.parse(localStorage.getItem(draftKey()) || '[]'); }
catch (e) { return []; }
}
function draftsPut(list) {
try { localStorage.setItem(draftKey(), JSON.stringify(list.slice(0, 30))); }
catch (e) {  }
}
function draftSave(d) {
var list = drafts();
d.id = d.id || String(Date.now()) + Math.random().toString(36).slice(2, 6);
d.at = Date.now();
list = list.filter(function (x) { return x.id !== d.id; });
list.unshift(d);
draftsPut(list);
return d.id;
}
function draftDrop(id) {
draftsPut(drafts().filter(function (x) { return x.id !== id; }));
}
function novaTrouble(err) {
var m = String((err && err.message) || err || '');
if (/nothing was asked/i.test(m)) {
return 'Supernova on the server is older than this control. Deploy the function again and rewriting works.';
}
if (/no key set/i.test(m)) return 'Supernova has no key set yet.';
if (/asked supernova a lot/i.test(m)) return m;
return H.trouble(err, 'Supernova could not work on that just now.');
}
var EMOJI = [
{ t: 'Faces', e: ['\u{1F600}', '\u{1F602}', '\u{1F923}', '\u{1F60D}', '\u{1F970}', '\u{1F60E}',
'\u{1F929}', '\u{1F973}', '\u{1F60F}', '\u{1F622}', '\u{1F62D}', '\u{1F624}', '\u{1F92F}',
'\u{1F97A}', '\u{1FAE1}', '\u{1F914}', '\u{1F9D0}', '\u{1F62C}', '\u{1FAE0}', '\u{1F644}',
'\u{1F634}', '\u{1F621}', '\u{1F925}', '\u{1F92B}'] },
{ t: 'People', e: ['\u{1F44B}', '\u{1F44D}', '\u{1F44E}', '\u{1F44F}', '\u{1F64F}', '\u{1F4AA}',
'\u{1F91D}', '\u{1FAF6}', '\u{1F440}', '\u{1F9E0}', '\u{1F480}', '\u{1F921}', '\u{1F47B}',
'\u{1F916}', '\u{1F984}'] },
{ t: 'Things', e: ['\u{2764}\u{FE0F}', '\u{1F494}', '\u{1F525}', '\u{1F4AF}', '\u{2705}',
'\u{274C}', '\u{2B50}', '\u{1F389}', '\u{1F680}', '\u{1F4AC}', '\u{1F4F0}', '\u{1F6E0}\u{FE0F}',
'\u{1F4A1}', '\u{26A1}', '\u{1F3C6}', '\u{1F511}', '\u{1F4CA}', '\u{1F4F8}', '\u{1F3AE}',
'\u{1F3AC}', '\u{1F4DA}', '\u{1F52C}'] },
{ t: 'Out there', e: ['\u{2615}', '\u{1F319}', '\u{2600}\u{FE0F}', '\u{1F308}', '\u{1F3B5}',
'\u{1F338}', '\u{1F340}', '\u{1F30A}', '\u{1F355}', '\u{1F37A}', '\u{1F419}', '\u{1F98B}',
'\u{1F6F8}'] }
];
var SCOPES = [
{ k: 'all',       t: 'Everyone',                   i: 'users' },
{ k: 'following', t: 'Accounts you follow',        i: 'follow' },
{ k: 'mentioned', t: 'Only accounts you mention',  i: 'at' },
{ k: 'verified',  t: 'Verified accounts',          i: 'verified' }
];
function scopeOf(k) {
for (var i = 0; i < SCOPES.length; i++) if (SCOPES[i].k === k) return SCOPES[i];
return SCOPES[0];
}
var DISCLOSE = [
{ k: 'paid', t: 'Paid partnership', s: 'Someone paid for this, or gave you what it is about.' },
{ k: 'ai',   t: 'Made with AI',     s: 'The words or the picture were made by a machine.' }
];
function composerHTML(o) {
o = o || {};
var id = 'c' + (++composeSeq);
return '<form class="hd-compose" data-c="' + id + '">' +
(o.replyTo ? '<p class="hd-compose-to">Replying to ' + H.tag(esc(o.toHandle || '')) + '</p>' : '') +
'<div class="hd-compose-row">' + avatarOf(my) +
'<textarea class="hd-compose-in" rows="' + (o.rows || 2) + '" maxlength="' + MAX + '" ' +
'placeholder="' + esc(o.placeholder || 'hear me out...') + '"></textarea>' +
'</div>' +
'<div class="hd-compose-see" data-see>' +
'<div class="hd-post-body" data-seen></div>' +
'</div>' +
'<div class="hd-compose-media" hidden></div>' +
'<div class="hd-compose-poll" data-poll hidden></div>' +
'<div class="hd-compose-flags" data-flags hidden></div>' +
'<div class="hd-cpanel" data-panel hidden></div>' +
(o.replyTo ? '' :
'<button class="hd-scope" type="button" data-scope>' + ic('users') +
'<span data-scope-t>Everyone can reply</span></button>') +
(held.length
? '<label class="hd-compose-as"><span>Post as</span><select class="nb-select" data-as>' +
'<option value="' + my.id + '">' + esc(my.name || my.handle) + '</option>' +
held.map(function (h) {
return '<option value="' + h.id + '">' + esc(h.name || h.handle) + '</option>';
}).join('') + '</select></label>'
: '') +
'<div class="hd-compose-foot">' +
'<div class="hd-compose-tools">' +
'<label class="nb-icon-btn hd-compose-tool" data-tip="Attach something">' + ic('image') +
'<input type="file" multiple accept="' + ATT_ACCEPT + '" hidden data-pic>' +
'<span class="nb-sr">Attach something</span></label>' +
'<button class="nb-icon-btn hd-compose-tool" type="button" data-tag data-tip="Add a topic">' + ic('hash') + '</button>' +
'<button class="nb-icon-btn hd-compose-tool" type="button" data-emoji data-tip="Add an emoji">' + ic('smile') + '</button>' +
(o.replyTo ? '' :
'<button class="nb-icon-btn hd-compose-tool" type="button" data-pollbtn data-tip="Ask a question">' + ic('chart') + '</button>' +
'<button class="nb-icon-btn hd-compose-tool" type="button" data-when data-tip="Send it later">' + ic('clock') + '</button>') +
'<button class="nb-icon-btn hd-compose-tool" type="button" data-disc data-tip="Say what this is">' + ic('info') + '</button>' +
'<button class="nb-icon-btn hd-compose-tool hd-compose-nv" type="button" data-nova data-tip="Ask Supernova to work on it">' +
novaMark('hd-compose-nvm') + '</button>' +
'</div>' +
'<span class="hd-count" data-count>' + MAX + '</span>' +
'<button class="nb-btn nb-btn--primary nb-btn--sm" type="submit" disabled data-go>' +
esc(o.label || 'Post') + '</button>' +
'</div>' +
'<p class="hd-compose-say" data-say hidden></p>' +
'</form>';
}
function wireComposer(form, o) {
o = o || {};
var ta = form.querySelector('.hd-compose-in');
var go = form.querySelector('[data-go]');
var count = form.querySelector('[data-count]');
var say = form.querySelector('[data-say]');
var tray = form.querySelector('.hd-compose-media');
var pic = form.querySelector('[data-pic]');
var see = form.querySelector('[data-see]');
var seen = form.querySelector('[data-seen]');
var pollBox = form.querySelector('[data-poll]');
var flagBox = form.querySelector('[data-flags]');
var panelBox = form.querySelector('[data-panel]');
var atts = [];
var busy = false;
var openPanel = null;
var scope = 'all';
var when = null;
var flags = [];
var poll = null;
function grow() {
ta.style.height = 'auto';
ta.style.height = Math.min(ta.scrollHeight, 320) + 'px';
}
function preview() {
var t = ta.value;
if (!t.trim()) { seen.innerHTML = ''; return; }
var out = body(t, { keepMedia: true });
if (out.replace(/<br\s*\/?>/gi, '').indexOf('<') < 0) { seen.innerHTML = ''; return; }
seen.innerHTML = out;
twem(seen);
}
function tick() {
var left = MAX - ta.value.length;
count.textContent = left;
count.classList.toggle('is-low', left <= 60);
count.classList.toggle('is-over', left < 0);
go.disabled = busy || left < 0 || (!ta.value.trim() && !atts.length && !poll);
go.textContent = when ? 'Schedule' : (o.label || 'Post');
grow();
preview();
}
function paintScope() {
var pill = form.querySelector('[data-scope]');
if (!pill) return;
var s = scopeOf(scope);
pill.innerHTML = ic(s.i) + '<span data-scope-t>' +
(s.k === 'all' ? 'Everyone can reply' : s.t + ' can reply') + '</span>';
pill.classList.toggle('is-set', s.k !== 'all');
}
paintScope();
function shutPanel() {
openPanel = null;
panelBox.hidden = true;
panelBox.innerHTML = '';
[].forEach.call(form.querySelectorAll('.hd-compose-tool.is-on, [data-scope].is-open'), function (b) {
b.classList.remove('is-on'); b.classList.remove('is-open');
});
grow();
}
function showPanel(name, title, html, wire) {
if (openPanel === name) { shutPanel(); return; }
shutPanel();
openPanel = name;
panelBox.hidden = false;
panelBox.innerHTML =
'<div class="hd-cpanel-head"><b>' + esc(title) + '</b>' +
'<button class="nb-icon-btn nb-icon-btn--round hd-cpanel-x" type="button" data-shut aria-label="Close">' +
ic('x') + '</button></div>' +
'<div class="hd-cpanel-body">' + html + '</div>';
panelBox.querySelector('[data-shut]').addEventListener('click', shutPanel);
var lit = name === 'scope' ? form.querySelector('[data-scope]')
: form.querySelector('[data-' + name + ']');
if (lit) lit.classList.add(name === 'scope' ? 'is-open' : 'is-on');
if (wire) wire(panelBox.querySelector('.hd-cpanel-body'));
var first = panelBox.querySelector('[data-focus]');
if (first) setTimeout(function () { first.focus(); }, 30);
}
var scopeBtn = form.querySelector('[data-scope]');
if (scopeBtn) scopeBtn.addEventListener('click', function () {
showPanel('scope', 'Who can reply',
'<p class="hd-cpanel-line">Anyone can see this post and pass it on. Only the accounts you pick can answer it.</p>' +
'<div class="hd-pick">' + SCOPES.map(function (x) {
return '<button class="hd-pick-one' + (x.k === scope ? ' is-on' : '') + '" type="button" data-k="' + x.k + '">' +
ic(x.i) + '<span>' + esc(x.t) + '</span>' + ic('tick') + '</button>';
}).join('') + '</div>',
function (box) {
box.addEventListener('click', function (e) {
var b = e.target.closest('[data-k]');
if (!b) return;
scope = b.getAttribute('data-k');
paintScope(); shutPanel();
});
});
});
function paintFlags() {
var bits = [];
if (when) {
bits.push('<span class="hd-fchip">' + ic('clock') + 'Going out ' + esc(whenWord(when)) +
'<button type="button" data-off="when" aria-label="Send it now instead">' + ic('x') + '</button></span>');
}
flags.forEach(function (k) {
var d = DISCLOSE.filter(function (x) { return x.k === k; })[0];
if (!d) return;
bits.push('<span class="hd-fchip">' + ic('info') + esc(d.t) +
'<button type="button" data-off="' + k + '" aria-label="Take that off">' + ic('x') + '</button></span>');
});
flagBox.innerHTML = bits.join('');
flagBox.hidden = !bits.length;
}
flagBox.addEventListener('click', function (e) {
var b = e.target.closest('[data-off]');
if (!b) return;
var k = b.getAttribute('data-off');
if (k === 'when') when = null;
else flags = flags.filter(function (x) { return x !== k; });
paintFlags(); tick();
});
function whenWord(d) {
var day = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
var at = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
var today = new Date();
var same = d.toDateString() === today.toDateString();
return (same ? 'today' : day) + ' at ' + at;
}
var whenBtn = form.querySelector('[data-when]');
if (whenBtn) whenBtn.addEventListener('click', function () {
var start = when || new Date(Date.now() + 60 * 60 * 1000);
start.setSeconds(0, 0);
var val = new Date(start.getTime() - start.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
showPanel('when', 'Send it later',
'<p class="hd-cpanel-line">It stays out of sight until then, and nobody but you can see it in the meantime.</p>' +
'<div class="nb-field"><label class="nb-label" for="wIn">Date and time</label>' +
'<input class="nb-input" id="wIn" type="datetime-local" data-focus value="' + esc(val) + '"></div>' +
'<p class="nb-note" data-wsay hidden></p>' +
'<div class="hd-cpanel-do"><button class="nb-btn nb-btn--primary nb-btn--sm" type="button" data-ok>Schedule it</button>' +
'<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" data-now>Send it now instead</button></div>',
function (box) {
box.querySelector('[data-now]').addEventListener('click', function () {
when = null; paintFlags(); tick(); shutPanel();
});
box.querySelector('[data-ok]').addEventListener('click', function () {
var d = new Date(box.querySelector('#wIn').value);
var bad = box.querySelector('[data-wsay]');
if (isNaN(d.getTime()) || d.getTime() <= Date.now() + 60000) {
bad.hidden = false; bad.className = 'nb-note is-bad';
bad.textContent = 'Pick a time at least a minute from now.'; return;
}
when = d; paintFlags(); tick(); shutPanel();
});
});
});
form.querySelector('[data-disc]').addEventListener('click', function () {
showPanel('disc', 'Say what this is',
'<p class="hd-cpanel-line">Both of these show on the post itself. Use them when they are true.</p>' +
DISCLOSE.map(function (d) {
return '<label class="nb-check hd-disc-one"><input type="checkbox" data-d="' + d.k + '"' +
(flags.indexOf(d.k) > -1 ? ' checked' : '') + '><span class="nb-box"></span>' +
'<span><b>' + esc(d.t) + '</b><i>' + esc(d.s) + '</i></span></label>';
}).join(''),
function (box) {
box.addEventListener('change', function () {
flags = [];
[].forEach.call(box.querySelectorAll('[data-d]'), function (c) {
if (c.checked) flags.push(c.getAttribute('data-d'));
});
paintFlags();
});
});
});
function paintPoll() {
if (!poll) { pollBox.hidden = true; pollBox.innerHTML = ''; return; }
pollBox.hidden = false;
pollBox.innerHTML = poll.options.map(function (v, i) {
return '<div class="hd-pollrow"><input class="nb-input" maxlength="40" data-o="' + i + '" ' +
'placeholder="Answer ' + (i + 1) + '" value="' + esc(v) + '">' +
(poll.options.length > 2
? '<button class="nb-icon-btn" type="button" data-drop-o="' + i + '" aria-label="Remove this answer">' + ic('x') + '</button>'
: '') + '</div>';
}).join('') +
'<div class="hd-poll-foot">' +
(poll.options.length < 4
? '<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" data-add-o>Add an answer</button>' : '') +
'<label class="hd-poll-len"><span>Open for</span><select class="nb-select" data-len>' +
[[6, '6 hours'], [24, 'a day'], [72, 'three days'], [168, 'a week']].map(function (x) {
return '<option value="' + x[0] + '"' + (poll.hours === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
}).join('') + '</select></label>' +
'<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" data-drop-poll>Remove poll</button>' +
'</div>';
}
pollBox.addEventListener('input', function (e) {
var o1 = e.target.getAttribute('data-o');
if (o1 != null && poll) poll.options[+o1] = e.target.value;
if (e.target.hasAttribute('data-len') && poll) poll.hours = +e.target.value;
tick();
});
pollBox.addEventListener('click', function (e) {
var b = e.target.closest('button');
if (!b || !poll) return;
if (b.hasAttribute('data-add-o') && poll.options.length < 4) poll.options.push('');
else if (b.hasAttribute('data-drop-poll')) poll = null;
else if (b.hasAttribute('data-drop-o')) poll.options.splice(+b.getAttribute('data-drop-o'), 1);
else return;
paintPoll(); tick();
var first = pollBox.querySelector('input');
if (first) first.focus();
});
var pollBtn = form.querySelector('[data-pollbtn]');
if (pollBtn) pollBtn.addEventListener('click', function () {
poll = poll ? null : { options: ['', ''], hours: 24 };
paintPoll(); tick();
var first = pollBox.querySelector('input');
if (first) first.focus();
});
var novaWay = 'tidy';
form.querySelector('[data-nova]').addEventListener('click', function () {
if (!ta.value.trim()) { warn('Write something first and Supernova will work on that.'); return; }
showPanel('nova', 'Work on this',
'<p class="hd-cpanel-line">Supernova rewrites what you have written. Nothing goes out until you post it yourself.</p>' +
'<div class="hd-nova-ways">' + NOVA_WAYS.map(function (w) {
return '<button class="hd-nova-way' + (w.k === novaWay ? ' is-on' : '') + '" type="button" data-w="' + w.k + '">' +
esc(w.t) + '</button>';
}).join('') + '</div>' +
'<div class="nb-field"><label class="nb-label" for="nvAs">Or say how <span class="nb-hint">optional</span></label>' +
'<input class="nb-input" id="nvAs" maxlength="120" placeholder="As a shipping note. As if I were annoyed."></div>' +
'<div class="hd-cpanel-do"><button class="nb-btn nb-btn--primary nb-btn--sm" type="button" data-run>Rewrite it</button></div>' +
'<div class="hd-nova-out" data-out hidden></div>',
function (box) {
box.addEventListener('click', function (e) {
var w = e.target.closest('[data-w]');
if (!w) return;
novaWay = w.getAttribute('data-w');
[].forEach.call(box.querySelectorAll('[data-w]'), function (b) {
b.classList.toggle('is-on', b === w);
});
});
var run = box.querySelector('[data-run]');
run.addEventListener('click', async function () {
var out = box.querySelector('[data-out]');
var start = ta.value.trim();
if (!start) { shutPanel(); return; }
run.disabled = true;
run.innerHTML = '<span class="nb-loader nb-loader--sm"></span> Working';
out.hidden = false;
out.innerHTML = '<div class="hd-nova-line"></div><div class="hd-nova-line"></div>';
try {
var got = await H.fn('supernova?job=write', {
text: start, way: novaWay, how: (box.querySelector('#nvAs').value || '').trim(), limit: MAX
});
var made = String((got && got.text) || '').trim();
if (!made) throw new Error('nothing came back');
out.innerHTML = '<p class="hd-nova-lb">' + ic('icon') + ' Supernova wrote this</p>' +
'<div class="hd-nova-new" data-new></div>' +
'<div class="hd-cpanel-do"><button class="nb-btn nb-btn--primary nb-btn--sm" type="button" data-use>Use this</button>' +
'<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" data-again>Try again</button></div>';
out.querySelector('[data-new]').textContent = made;
out.querySelector('[data-use]').addEventListener('click', function () {
ta.value = made; tick(); shutPanel(); ta.focus();
});
out.querySelector('[data-again]').addEventListener('click', function () {
out.hidden = true; out.innerHTML = '';
});
} catch (err) {
out.innerHTML = '<p class="nb-note is-bad">' + esc(novaTrouble(err)) + '</p>';
}
run.disabled = false;
run.textContent = 'Rewrite it';
grow();
});
});
});
ta.addEventListener('input', tick);
ta.addEventListener('keydown', function (e) {
if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') form.requestSubmit();
});
form.querySelector('[data-tag]').addEventListener('click', function () {
var at = ta.selectionStart;
ta.setRangeText('#', at, at, 'end');
ta.focus(); tick();
});
form.querySelector('[data-emoji]').addEventListener('click', function () {
showPanel('emoji', 'Add an emoji',
EMOJI.map(function (g) {
return '<p class="hd-emoji-lb">' + esc(g.t) + '</p>' +
'<div class="hd-emoji-grid">' + g.e.map(function (ch) {
return '<button class="hd-emoji-btn" type="button" data-em="' + ch + '">' + ch + '</button>';
}).join('') + '</div>';
}).join(''),
function (box) {
twem(box);
box.addEventListener('click', function (ev) {
var btn = ev.target.closest('[data-em]');
if (!btn) return;
var ch = btn.getAttribute('data-em');
var at = ta.selectionStart;
ta.setRangeText(ch, at, ta.selectionEnd, 'end');
ta.focus(); tick();
});
});
});
function paintTray() {
if (!atts.length) { tray.hidden = true; tray.innerHTML = ''; return; }
tray.hidden = false;
tray.innerHTML = '<div class="hd-atts">' + atts.map(function (a, i) {
var face;
if (a.kind === 'image') {
face = '<img src="' + esc(a.peek) + '" alt="">';
} else if (a.kind === 'video') {
face = '<video src="' + esc(a.peek) + '" preload="metadata" muted playsinline></video>';
} else {
face = '<span class="hd-att-glyph">' + ic('file') + '</span>';
}
return '<figure class="hd-att hd-att--' + a.kind + '" data-att="' + i + '">' +
'<div class="hd-att-face">' + face +
'<button class="nb-icon-btn nb-icon-btn--round hd-att-x" type="button" data-drop="' + i +
'" aria-label="Remove ' + esc(a.file.name) + '">' + ic('x') + '</button>' +
'<span class="hd-compose-bar" data-bar="' + i + '" hidden><i></i></span></div>' +
'<figcaption class="hd-att-meta">' +
'<span class="hd-att-name">' + esc(a.file.name) +
'<i>' + esc(weigh(a.file.size)) + '</i></span>' +
'<input class="nb-input hd-compose-alt" type="text" maxlength="500" data-alt="' + i +
'" placeholder="' + (a.kind === 'image' ? 'Describe it, for anyone who cannot see it'
: 'Say what this is') +
'" value="' + esc(a.alt) + '">' +
'<label class="hd-compose-spoiler"><input type="checkbox" data-cover="' + i + '"' +
(a.cover ? ' checked' : '') + '> <span>Cover it as sensitive</span></label>' +
'</figcaption></figure>';
}).join('') + '</div>' +
(atts.length >= ATT_MAX
? '<p class="nb-hint hd-att-hint">That is the four a post can carry.</p>'
: '');
}
tray.addEventListener('input', trayEdit);
tray.addEventListener('change', trayEdit);
function trayEdit(e) {
var t = e.target;
var ai = t.getAttribute('data-alt');
if (ai !== null && atts[+ai]) { atts[+ai].alt = t.value; return; }
var ci = t.getAttribute('data-cover');
if (ci !== null && atts[+ci]) { atts[+ci].cover = t.checked; }
}
tray.addEventListener('click', function (e) {
var b = e.target.closest && e.target.closest('[data-drop]');
if (!b) return;
var i = +b.getAttribute('data-drop');
if (!atts[i]) return;
try { URL.revokeObjectURL(atts[i].peek); } catch (err) {  }
atts.splice(i, 1);
paintTray(); tick();
});
pic.addEventListener('change', function () {
var picked = [].slice.call(pic.files || []);
pic.value = '';
if (!picked.length) return;
var room = ATT_MAX - atts.length;
if (room <= 0) return warn('A post carries four attachments at most.');
var over = picked.length > room;
picked.slice(0, room).forEach(function (f) {
if (f.size > ATT_BYTES) { warn('"' + f.name + '" is over 64 MB. That is too big to post.'); return; }
atts.push({
file: f,
kind: kindOf(f),
peek: URL.createObjectURL(f),
alt: '',
cover: false
});
});
if (over) warn('Only the first ' + room + ' were added. A post carries four at most.');
paintTray(); tick();
});
function warn(m) { say.hidden = false; say.textContent = m; say.className = 'hd-compose-say is-bad'; }
form.addEventListener('submit', async function (e) {
e.preventDefault();
if (busy) return;
var text = ta.value.trim();
if (!text && !atts.length && !poll) return;
var answers = null;
if (poll) {
answers = poll.options.map(function (v) { return v.trim(); }).filter(Boolean);
if (answers.length < 2) return warn('A poll needs at least two answers.');
var seenAns = {};
for (var ai = 0; ai < answers.length; ai++) {
var lower = answers[ai].toLowerCase();
if (seenAns[lower]) return warn('Two of those answers are the same.');
seenAns[lower] = 1;
}
if (!text) return warn('A poll needs a question. Write it above the answers.');
}
busy = true; go.disabled = true; say.hidden = true;
go.innerHTML = '<span class="nb-loader nb-loader--sm"></span> ' + (when ? 'Scheduling' : 'Posting');
try {
var carried = [];
for (var ui = 0; ui < atts.length; ui++) {
var a = atts[ui];
var bar = tray.querySelector('[data-bar="' + ui + '"]');
if (bar) bar.hidden = false;
var clean = a.file.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-80) || 'file';
var path = my.id + '/' + Date.now() + '-' + ui + '-' + clean;
var up = await db.storage.from('attachments')
.upload(path, a.file, { upsert: true, contentType: a.file.type || undefined });
if (up.error) throw up.error;
carried.push({
url: db.storage.from('attachments').getPublicUrl(path).data.publicUrl,
alt_text: a.alt.trim().slice(0, 500),
spoiler: !!a.cover,
kind: a.kind,
mime: a.file.type || '',
name: a.file.name.slice(0, 200),
size_bytes: a.file.size
});
if (bar) bar.hidden = true;
}
var asSel = form.querySelector('[data-as]');
var asId = asSel ? asSel.value : my.id;
var r;
if (asId && asId !== my.id) {
var made = await db.rpc('post_as', {
p_as: asId, p_body: text,
p_reply_to: o.replyTo || null, p_relay_of: o.quoteOf || null,
p_scope: scope, p_disclosure: flags,
p_has_media: carried.length > 0
});
if (made.error) throw made.error;
r = await db.from('posts').select(WITH_AUTHOR).eq('id', made.data).single();
} else {
var row = {
author: my.id, body: text, reply_scope: scope, disclosure: flags,
has_media: carried.length > 0
};
if (o.replyTo) row.reply_to = o.replyTo;
if (o.quoteOf) row.relay_of = o.quoteOf;
if (when) row.scheduled_for = when.toISOString();
r = await db.from('posts').insert(row).select(WITH_AUTHOR).single();
}
if (r.error) throw r.error;
if (answers) {
var pr = await db.from('polls').insert({
post_id: r.data.id, options: answers,
closes_at: new Date(Date.now() + poll.hours * 3600 * 1000).toISOString()
});
if (pr.error) {
await db.from('posts').delete().eq('id', r.data.id);
throw pr.error;
}
}
if (carried.length && r.data) {
var sm = await db.rpc('set_post_media', {
p_post: r.data.id, p_media: JSON.stringify(carried)
});
if (sm.error) {
await db.from('posts').delete().eq('id', r.data.id);
throw sm.error;
}
r.data.media = carried.map(function (m, i) {
return Object.assign({ position: i }, m);
});
}
atts.forEach(function (a) { try { URL.revokeObjectURL(a.peek); } catch (err) {  } });
atts = [];
ta.value = ''; tray.hidden = true; tray.innerHTML = '';
poll = null; when = null; flags = []; scope = 'all';
paintPoll(); paintFlags(); paintScope();
tick();
U.toast(o.replyTo ? 'Reply posted.'
: (r.data.scheduled_for ? 'Scheduled. It goes out on its own.' : 'Posted.'));
if (o.after && !r.data.scheduled_for) o.after(r.data);
} catch (err) {
var m = String((err && err.message) || '');
if (/may_post|row-level security/i.test(m)) warn('Your account cannot post right now.');
else warn(H.trouble(err, 'That did not post.'));
}
busy = false;
go.textContent = o.label || 'Post';
tick();
});
function snapshot() {
if (!ta.value.trim() && !poll && !when && !flags.length && !atts.length) return null;
return {
text: ta.value, scope: scope, flags: flags.slice(),
when: when ? when.toISOString() : null,
poll: poll ? { options: poll.options.slice(), hours: poll.hours } : null,
had: atts.map(function (a) { return a.file.name; })
};
}
function restore(d) {
if (!d) return;
ta.value = d.text || '';
scope = d.scope || 'all';
flags = (d.flags || []).slice();
poll = d.poll ? { options: (d.poll.options || ['', '']).slice(), hours: d.poll.hours || 24 } : null;
var w = d.when ? new Date(d.when) : null;
when = (w && !isNaN(w.getTime()) && w.getTime() > Date.now()) ? w : null;
shutPanel(); paintScope(); paintFlags(); paintPoll(); tick();
var had = d.had || (d.hadPic ? ['a picture'] : []);
if (had.length) {
warn(had.length === 1
? 'The words came back. ' + had[0] + ' did not - attach it again.'
: 'The words came back. The ' + had.length + ' attachments did not - attach them again.');
}
}
tick();
return {
focus: function () { ta.focus(); },
snapshot: snapshot, restore: restore,
clear: function () { ta.value = ''; poll = null; when = null; flags = []; scope = 'all';
atts.forEach(function (a) { try { URL.revokeObjectURL(a.peek); } catch (err) {  } });
atts = []; tray.hidden = true; tray.innerHTML = '';
shutPanel(); paintScope(); paintFlags(); paintPoll(); tick(); }
};
}
function openComposer(o) {
o = o || {};
var c = null, posted = false, from = o.draft || null;
var keeps = !o.replyTo && !o.quoteOf;
var s = U.sheet({
title: o.title || 'New post',
tools: keeps ? '<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" data-drafts>Drafts</button>' : '',
html: composerHTML(Object.assign({ rows: 4, placeholder: 'What is worth saying?' }, o)),
guard: keeps ? function () {
if (posted) return true;
var d = c && c.snapshot();
if (!d) { if (from) draftDrop(from.id); return true; }
return askKeep().then(function (said) {
if (said === 'stay') return false;
if (said === 'save') { if (from) d.id = from.id; draftSave(d); U.toast('Saved to your drafts.'); }
else if (from) draftDrop(from.id);
return true;
});
} : null,
wire: function (api) {
c = wireComposer(api.q('.hd-compose'), Object.assign({}, o, {
after: function (row) { posted = true; if (from) draftDrop(from.id); api.close(); if (o.after) o.after(row); }
}));
if (from) c.restore(from);
var db2 = api.q('[data-drafts]');
if (db2) db2.addEventListener('click', function () {
pickDraft(function (d) {
var now = c.snapshot();
if (now) { if (from) now.id = from.id; draftSave(now); }
from = d; c.restore(d);
});
});
setTimeout(c.focus, 60);
}
});
return s;
}
function pickDraft(take) {
var list = drafts();
var s = U.sheet({
title: 'Drafts',
html: list.length
? '<div class="hd-drafts">' + list.map(function (d) {
var bits = [];
if (d.poll) bits.push('a question');
if (d.when) bits.push('going out ' + esc(new Date(d.when).toLocaleString()));
(d.flags || []).forEach(function (k) {
var f = DISCLOSE.filter(function (x) { return x.k === k; })[0];
if (f) bits.push(f.t.toLowerCase());
});
var had = (d.had || []).length || (d.hadPic ? 1 : 0);
if (had) bits.push(had === 1 ? 'had an attachment' : 'had ' + had + ' attachments');
var ago = H.when(new Date(d.at).toISOString());
ago = ago === 'now' ? 'just now' : (/^\d+[mhd]$/.test(ago) ? ago + ' ago' : 'saved ' + ago);
return '<div class="nb-card nb-card--tight hd-draft" data-d="' + esc(d.id) + '">' +
'<button class="hd-draft-open" type="button" data-open="' + esc(d.id) + '">' +
'<b>' + esc((d.text || '').slice(0, 140) || 'Nothing written yet') + '</b>' +
'<i>' + esc(ago) +
(bits.length ? ' \u00b7 ' + esc(bits.join(' \u00b7 ')) : '') + '</i></button>' +
'<button class="nb-icon-btn" type="button" data-drop="' + esc(d.id) + '" aria-label="Throw this away">' +
ic('trash') + '</button></div>';
}).join('') + '</div>'
: empty('No drafts', 'A post you close before sending can be kept here.')
});
s.body.addEventListener('click', function (e) {
var b = e.target.closest('button');
if (!b) return;
var drop = b.getAttribute('data-drop');
if (drop) {
draftDrop(drop);
var row = b.closest('.hd-draft');
if (row) row.remove();
if (!s.body.querySelector('.hd-draft')) s.close();
return;
}
var open = b.getAttribute('data-open');
if (!open) return;
var d = drafts().filter(function (x) { return x.id === open; })[0];
s.close();
if (d) take(d);
});
}
function needAccount() {
if (my) return false;
go('join?next=' + encodeURIComponent(here()));
return true;
}
function bump(btn, by) {
var n = btn.querySelector('.hd-act-n');
if (!n) return;
var was = Number(String(n.textContent).replace(/[^\d]/g, '')) || 0;
n.textContent = num(Math.max(0, was + by));
}
async function like(btn) {
if (needAccount()) return;
var id = btn.closest('[data-post]').getAttribute('data-post');
var on = btn.classList.toggle('is-on');
bump(btn, on ? 1 : -1);
mine.liked[id] = on;
var r = on
? await db.from('endorsements').insert({ user_id: my.id, post_id: id })
: await db.from('endorsements').delete().eq('user_id', my.id).eq('post_id', id);
if (r.error) {
btn.classList.toggle('is-on', !on);
bump(btn, on ? -1 : 1);
mine.liked[id] = !on;
U.toast('That did not save.', 'bad');
}
}
async function relay(btn) {
if (needAccount()) return;
var id = btn.closest('[data-post]').getAttribute('data-post');
if (mine.relayed[id]) {
var d = await db.from('posts').delete().eq('author', my.id).eq('relay_of', id).eq('body', '');
if (d.error) return U.toast('That did not undo.', 'bad');
mine.relayed[id] = false;
btn.classList.remove('is-on'); bump(btn, -1);
return U.toast('Relay removed.');
}
U.menu(btn, [
{ label: 'Relay', ic: 'relay', run: async function () {
var r = await db.from('posts').insert({ author: my.id, relay_of: id, body: '' });
if (r.error) return U.toast(H.trouble(r.error, 'That did not relay.'), 'bad');
mine.relayed[id] = true;
btn.classList.add('is-on'); bump(btn, 1);
U.toast('Relayed.');
} },
{ label: 'Relay with your own words', ic: 'quill', run: function () {
openComposer({ title: 'Relay with your words', quoteOf: id, label: 'Relay', after: function () { render(); } });
} }
]);
}
async function save(btn) {
if (needAccount()) return;
var id = btn.closest('[data-post]').getAttribute('data-post');
var on = !mine.saved[id];
mine.saved[id] = on;
btn.classList.toggle('is-on', on);
btn.setAttribute('data-tip', on ? 'Saved' : 'Save');
var r = on
? await db.from('bookmarks').insert({ user_id: my.id, post_id: id })
: await db.from('bookmarks').delete().eq('user_id', my.id).eq('post_id', id);
if (r.error) {
mine.saved[id] = !on;
btn.classList.toggle('is-on', !on);
return U.toast('That did not save.', 'bad');
}
U.toast(on ? 'Saved to your bookmarks.' : 'Removed from bookmarks.');
}
function postLink(id) { return location.origin + url('post/' + id); }
function share(btn) {
var box = btn.closest('[data-post]');
var id = box.getAttribute('data-post');
var href = postLink(id);
var items = [
{ label: 'Copy link', ic: 'link', run: function () { U.copy(href, 'Link copied.'); } },
{ label: 'Bookmark', ic: 'bookmark', run: function () { save(box.querySelector('[data-do=save]')); } },
{ label: 'Embed this post', ic: 'code', run: function () { embed(id); } }
];
if (navigator.share) {
items.unshift({ label: 'Share', ic: 'share', run: function () {
navigator.share({ url: href, text: 'A post on Hereld' }).catch(function () {});
} });
}
U.menu(btn, items);
}
function embed(id) {
var href = postLink(id);
var code = '<iframe src="' + href + '?embed=1" width="550" height="320" ' +
'style="border:3px solid #000;border-radius:18px" title="A post on Hereld" loading="lazy"></iframe>';
U.sheet({
title: 'Embed this post',
html: '<p class="hd-ask-line">Drop this into a page. It shows the post as it stands, and it updates itself if the post is edited or taken down.</p>' +
'<textarea class="nb-input hd-embed-code" rows="4" readonly data-focus>' + esc(code) + '</textarea>' +
'<div class="hd-ask-foot"><span class="nb-hint">The link on its own: ' + esc(href) + '</span>' +
'<button class="nb-btn nb-btn--primary" type="button" data-copy>' + ic('link') + ' Copy the code</button></div>',
wire: function (api) {
api.q('[data-copy]').addEventListener('click', function () { U.copy(code, 'Embed code copied.'); });
api.q('.hd-embed-code').addEventListener('focus', function (e) { e.target.select(); });
}
});
}
var REASONS = [
['spam', 'Spam or a scam'],
['abuse', 'Harassment or abuse'],
['hate', 'Hate speech'],
['violence', 'Violence or threats'],
['sexual', 'Sexual content'],
['impersonation', 'Pretending to be someone else'],
['false', 'Misleading or false'],
['other', 'Something else']
];
function report(o) {
if (needAccount()) return;
U.sheet({
title: o.kind === 'post' ? 'Report this post' : 'Report this account',
html:
'<p class="hd-ask-line">Pick the closest reason. A person on the Hereld team reads every report, and you can see what happened to yours.</p>' +
'<div class="hd-reasons">' + REASONS.map(function (r, i) {
return '<label class="hd-reason"><input type="radio" name="rr" value="' + r[0] + '"' + (i === 0 ? ' data-focus' : '') + '>' +
'<span>' + esc(r[1]) + '</span></label>';
}).join('') + '</div>' +
'<div class="nb-field"><label class="nb-label" for="rdet">Anything that helps <span class="nb-hint">Optional</span></label>' +
'<textarea class="nb-input" id="rdet" rows="3" maxlength="600" placeholder="What should we look at?"></textarea></div>' +
'<div class="hd-ask-foot"><button class="nb-btn nb-btn--ghost" type="button" data-no>Cancel</button>' +
'<button class="nb-btn nb-btn--red" type="button" data-yes>Send the report</button></div>',
wire: function (api) {
api.q('[data-no]').addEventListener('click', api.close);
api.q('[data-yes]').addEventListener('click', async function (e) {
var pick = api.q('input[name=rr]:checked');
if (!pick) return U.toast('Pick a reason first.', 'bad');
e.target.disabled = true;
e.target.innerHTML = '<span class="nb-loader nb-loader--sm"></span> Sending';
var row = {
reporter: my.id, kind: o.kind, reason: pick.value,
detail: api.q('#rdet').value.trim()
};
if (o.post) row.post_id = o.post;
if (o.subject) row.subject = o.subject;
var r = await db.from('reports').insert(row);
api.close();
if (r.error && /duplicate|unique/i.test(r.error.message || '')) {
return U.toast('You have already reported this. It is in the queue.');
}
if (r.error) return U.toast(H.trouble(r.error, 'The report did not send.'), 'bad');
U.toast('Report sent. Thank you.');
});
}
});
}
async function askNote(id) {
if (needAccount()) return;
var st = await db.rpc('note_state', { p_post: id });
var s = st.data || { contributions: 0, needed: 3, mine: false, asked: false, summary: null };
var short = Math.max(0, (s.needed || 3) - (s.contributions || 0));
var where = s.summary
? 'There is already a summary under this post. Adding more context has Supernova write it again.'
: s.contributions
? (s.contributions === 1 ? 'One person has' : num(s.contributions) + ' people have') +
' added context so far. ' +
(short ? 'Another ' + (short === 1 ? 'one' : short) + ' and a summary goes under the post.'
: 'A summary will go under the post shortly.')
: 'Nobody has added context to this post yet. It takes ' + (s.needed || 3) + ' before a summary appears.';
U.sheet({
title: 'Add context',
html:
'<p class="hd-ask-line">Say what a reader is missing, and where you got it. ' +
'What goes under the post is not your paragraph on its own: Supernova reads everything people added and writes one summary of it.</p>' +
'<p class="hd-ask-state">' + esc(where) + '</p>' +
(s.mine ? '<p class="hd-ask-state">You have already added context here. Anything you add now sits alongside it.</p>' : '') +
'<div class="nb-field"><label class="nb-label" for="nq">What is missing?</label>' +
'<textarea class="nb-input" id="nq" rows="4" maxlength="500" data-focus ' +
'placeholder="Say what a reader would need to know."></textarea>' +
'<span class="nb-hint" id="nqn">20 characters at least.</span></div>' +
'<div class="nb-field"><label class="nb-label" for="ns">Where it comes from</label>' +
'<input class="nb-input" id="ns" type="url" maxlength="300" placeholder="https://"></div>' +
'<div class="hd-ask-foot"><button class="nb-btn nb-btn--ghost" type="button" data-no>Cancel</button>' +
(s.asked ? '' : '<button class="nb-btn nb-btn--paper" type="button" data-ask>Just ask for one</button>') +
'<button class="nb-btn nb-btn--primary" type="button" data-yes>Add context</button></div>',
wire: function (api) {
var txt = api.q('#nq'), count = api.q('#nqn');
txt.addEventListener('input', function () {
var n = txt.value.trim().length;
count.textContent = n < 20 ? (20 - n) + ' more character' + (20 - n === 1 ? '' : 's') + ' needed.'
: n + ' of 500.';
});
api.q('[data-no]').addEventListener('click', api.close);
var justAsk = api.q('[data-ask]');
if (justAsk) justAsk.addEventListener('click', async function () {
var r = await db.from('note_requests').insert({
post_id: id, user_id: my.id, reason: txt.value.trim().slice(0, 300)
});
api.close();
if (r.error && /duplicate|unique/i.test(r.error.message || '')) {
return U.toast('You have already asked for a note on this post.');
}
if (r.error) return U.toast(H.trouble(r.error, 'That did not send.'), 'bad');
U.toast('Asked. A summary appears once enough people have added context.');
});
api.q('[data-yes]').addEventListener('click', async function () {
var said = txt.value.trim();
if (said.length < 20) return U.toast('Say a little more than that.', 'bad');
var src = api.q('#ns').value.trim();
var r = await db.from('community_notes').insert({
post_id: id, author: my.id, body: said, source: src
});
api.close();
if (r.error) return U.toast(H.trouble(r.error, 'That did not send.'), 'bad');
U.toast(short > 1
? 'Added. ' + (short - 1) + ' more and a summary goes under the post.'
: 'Added. A summary will go under the post shortly.');
});
}
});
}
async function notInterested(id, node) {
if (needAccount()) return;
var r = await db.from('hidden_posts').insert({ user_id: my.id, post_id: id });
if (r.error && !/duplicate|unique/i.test(r.error.message || '')) {
return U.toast('That did not save.', 'bad');
}
if (node) {
node.classList.add('is-gone');
setTimeout(function () {
node.outerHTML = '<div class="nb-card hd-post hd-gone">' +
'<p>Put away. You will see less like this.</p>' +
'<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" data-undo="' + id + '">Undo</button></div>';
}, 180);
}
U.toast('Put away.');
}
async function blockPerson(p) {
if (needAccount()) return;
var yes = await U.ask({
title: 'Block ' + (p.name || p.handle) + '?',
bad: true,
yes: 'Block',
html: '<b>' + esc(p.name || p.handle) + '</b> will not be able to see your posts or reply to you, and you will not see theirs. ' +
'Any follow between you is removed. They are not told.',
note: 'You can undo this from their profile at any time.'
});
if (!yes) return;
var r = await db.from('blocks').insert({ blocker: my.id, blocked: p.id });
if (r.error && !/duplicate|unique/i.test(r.error.message || '')) {
return U.toast(H.trouble(r.error, 'That did not work.'), 'bad');
}
U.toast('Blocked.');
render();
}
async function mutePerson(p) {
if (needAccount()) return;
var yes = await U.ask({
title: 'Mute ' + (p.name || p.handle) + '?',
yes: 'Mute',
html: 'Their posts stop appearing in your feed. They are not told, and nothing changes for them.'
});
if (!yes) return;
var r = await db.from('blocks').insert({ blocker: my.id, blocked: p.id });
if (r.error && !/duplicate|unique/i.test(r.error.message || '')) {
return U.toast('That did not work.', 'bad');
}
U.toast('Muted.');
render();
}
async function follow(id, on) {
if (needAccount()) return false;
var r = on
? await db.from('follows').insert({ follower: my.id, following: id })
: await db.from('follows').delete().eq('follower', my.id).eq('following', id);
if (r.error && !/duplicate|unique/i.test(r.error.message || '')) {
U.toast('That did not work.', 'bad');
return false;
}
mine.following[id] = on;
return true;
}
async function editPost(id, node) {
var cur = null;
try {
var r = await db.from('posts').select('body').eq('id', id).maybeSingle();
cur = r.data ? r.data.body : '';
} catch (e) { cur = ''; }
if (cur == null) cur = '';
var existing = node.querySelector('.hd-post-body');
if (!cur && existing) cur = existing.textContent.replace(/\s*·\s*edited\s*$/, '').trim();
U.sheet({
title: 'Edit post',
wide: true,
html: '<div class="nb-card hd-compose-card">' + composerHTML({ placeholder: 'Edit your post...', label: 'Save' }) + '</div>',
wire: function (api) {
var form = api.q('.hd-compose');
var ta = api.q('.hd-compose-in');
var btn = api.q('[data-go]');
ta.value = cur;
btn.disabled = false;
btn.textContent = 'Save';
ta.focus(); try { ta.selectionStart = ta.value.length; ta.selectionEnd = ta.value.length; } catch (e) {}
form.addEventListener('submit', async function (e) {
e.preventDefault();
var txt = ta.value.trim();
if (!txt) return U.toast('Post cannot be empty.', 'bad');
if (txt.length > 600) return U.toast('Too long. 600 is the limit.', 'bad');
btn.disabled = true; btn.textContent = 'Saving…';
var res = await db.from('posts').update({ body: txt, edited_at: new Date().toISOString() }).eq('id', id);
if (res.error) { U.toast(H.trouble(res.error, 'Could not save.'), 'bad'); btn.disabled = false; btn.textContent = 'Save'; return; }
var bodyEl = node.querySelector('.hd-post-body');
if (bodyEl) { bodyEl.innerHTML = body(txt) + ' <span class="hd-edited">· edited</span>'; twem(bodyEl); }
api.close(); U.toast('Post updated.');
});
}
});
}
async function binPost(id, node) {
var yes = await U.ask({
title: 'Delete this post?',
bad: true, yes: 'Delete',
html: 'It goes for everyone, along with its replies and relays. This cannot be undone.'
});
if (!yes) return;
var r = await db.from('posts').delete().eq('id', id);
if (r.error) return U.toast(H.trouble(r.error, 'That did not delete.'), 'bad');
if (node) { node.classList.add('is-gone'); setTimeout(function () { node.remove(); }, 200); }
U.toast('Deleted.');
}
function moreMenu(btn) {
var node = btn.closest('[data-post]');
var id = node.getAttribute('data-post');
var handle = node.getAttribute('data-author');
var owned = btn.getAttribute('data-own') === '1';
var who = null;
var items = [];
if (owned) {
items.push({ label: 'Edit post', ic: 'edit', run: function () { editPost(id, node); } });
items.push({ label: 'Copy link', ic: 'link', run: function () { U.copy(postLink(id), 'Link copied.'); } });
items.push({ label: 'Embed post', ic: 'code', run: function () { embed(id); } });
items.push({ label: mine.saved[id] ? 'Remove bookmark' : 'Bookmark', ic: 'bookmark',
run: function () { save(node.querySelector('[data-do=save]')); } });
items.push('rule');
items.push({ label: 'Delete post', ic: 'trash', kind: 'bad', run: function () { binPost(id, node); } });
return U.menu(btn, items);
}
items.push({ label: 'Not interested', ic: 'hide', run: function () { notInterested(id, node); } });
items.push({ label: (mine.following[handle] ? 'Unfollow ' : 'Follow ') + '@' + handle,
ic: mine.following[handle] ? 'unfollow' : 'follow',
run: async function () {
if (!who) who = await person(handle);
if (!who) return;
var on = !mine.following[handle];
if (await follow(who.id, on)) {
mine.following[handle] = on;
U.toast(on ? 'Following ' + (who.name || handle) + '.' : 'Unfollowed.');
}
} });
items.push({ label: 'Mute @' + handle, ic: 'mute', run: async function () {
who = who || await person(handle); if (who) mutePerson(who);
} });
items.push({ label: 'Block @' + handle, ic: 'ban', kind: 'bad', run: async function () {
who = who || await person(handle); if (who) blockPerson(who);
} });
items.push('rule');
items.push({ label: 'Copy link', ic: 'link', run: function () { U.copy(postLink(id), 'Link copied.'); } });
items.push({ label: 'Embed post', ic: 'code', run: function () { embed(id); } });
items.push({ label: 'Add context', ic: 'info', run: function () { askNote(id); } });
items.push({ label: 'Report post', ic: 'flag', kind: 'bad', run: function () { report({ kind: 'post', post: id }); } });
if (staffRole) {
items.push('rule');
items.push({ label: 'Hide (staff)', ic: 'shield', run: async function () {
var r = await db.rpc('staff_act', { p_kind: 'hide_post', p_post: id, p_reason: 'From the feed' });
U.toast(r.error ? 'Not allowed.' : 'Hidden.', r.error ? 'bad' : '');
if (!r.error) node.remove();
} });
}
U.menu(btn, items);
}
var peopleCache = {};
async function person(handle, quiet) {
var key = String(handle || '').toLowerCase();
if (peopleCache[key]) return peopleCache[key];
var r = await db.from('profiles').select('*').eq('handle', key).maybeSingle();
if (r.error || !r.data) {
if (!quiet) U.toast('That account could not be found.', 'bad');
return null;
}
await attachAssoc([r.data]);
peopleCache[key] = r.data;
return r.data;
}
var cardBox = null, cardFor = null, cardIn = null, cardOut = null;
function cardNode() {
if (cardBox) return cardBox;
cardBox = document.createElement('div');
cardBox.className = 'nb-card hd-pcard';
cardBox.hidden = true;
cardBox.addEventListener('mouseenter', function () { clearTimeout(cardOut); });
cardBox.addEventListener('mouseleave', hideCard);
document.body.appendChild(cardBox);
return cardBox;
}
function hideCard() {
clearTimeout(cardIn); clearTimeout(cardOut);
cardOut = setTimeout(function () {
if (!cardBox) return;
cardBox.hidden = true;
cardBox.classList.remove('is-in');
cardFor = null;
}, 180);
}
function placeCard(anchor) {
var box = cardNode(), r = anchor.getBoundingClientRect();
box.hidden = false;
var w = box.offsetWidth || 300, h = box.offsetHeight || 180;
var left = Math.min(Math.max(10, r.left), window.innerWidth - w - 10);
var top = r.bottom + 10;
if (top + h > window.innerHeight - 10 && r.top - h - 10 > 10) top = r.top - h - 10;
box.style.left = Math.round(left + window.scrollX) + 'px';
box.style.top = Math.round(top + window.scrollY) + 'px';
}
async function showCard(anchor, handle) {
var key = String(handle || '').toLowerCase();
if (!key || key === cardFor) { clearTimeout(cardOut); return; }
var box = cardNode();
cardFor = key;
var p = peopleCache[key] || await person(key, true);
if (!p || cardFor !== key) return;
var isMe = my && my.id === p.id;
box.innerHTML =
'<div class="hd-pcard-top">' +
link('@' + p.handle, avatarOf(p, 'hd-av--lg'), 'hd-pcard-face') +
(isMe ? '<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" data-settings>Edit profile</button>'
: (my ? '<button class="nb-btn nb-btn--sm ' + (mine.following[p.id] ? 'nb-btn--ghost' : 'nb-btn--primary') +
'" type="button" data-follow="' + p.id + '">' + (mine.following[p.id] ? 'Following' : 'Follow') + '</button>'
: link('join', 'Follow', 'nb-btn nb-btn--primary nb-btn--sm'))) +
'</div>' +
'<p class="hd-pcard-name">' + link('@' + p.handle, nameMark(p)) + '</p>' +
'<p class="hd-pcard-at">' + H.tag(p.handle) + '</p>' +
(p.headline ? '<p class="hd-pcard-head">' + esc(p.headline) + '</p>' : '') +
(p.bio ? '<p class="hd-pcard-bio">' + body(p.bio) + '</p>' : '') +
'<p class="hd-pcard-counts">' +
'<span><b>' + num(p.following_count) + '</b> Following</span>' +
'<span><b>' + num(p.follower_count) + '</b> Followers</span>' +
'</p>' +
(my && !isMe ? '<button class="nb-btn nb-btn--ghost nb-btn--sm hd-pcard-summary" type="button" data-summary="' + esc(p.handle) + '">' + ic('sparkle') + ' Profile Summary</button>' : '');
twem(box);
var sumBtn = box.querySelector('[data-summary]');
if (sumBtn) sumBtn.addEventListener('click', function (e) {
e.stopPropagation();
loadProfileSummary(p.handle, box, sumBtn);
});
placeCard(anchor);
requestAnimationFrame(function () { box.classList.add('is-in'); });
}
function wireCards() {
document.addEventListener('mouseover', function (e) {
var a = e.target.closest && e.target.closest('[data-card]');
if (!a) return;
clearTimeout(cardIn); clearTimeout(cardOut);
cardIn = setTimeout(function () { showCard(a, a.getAttribute('data-card')); }, 420);
});
document.addEventListener('mouseout', function (e) {
var a = e.target.closest && e.target.closest('[data-card]');
if (!a) return;
clearTimeout(cardIn);
hideCard();
});
window.addEventListener('scroll', function () { if (cardBox && !cardBox.hidden) hideCard(); }, true);
}
var col, aside, rail, bar;
var painting = 0;
var HOME_SORT_KEY = 'hereld-home-sort';
function homeSort() {
try { return localStorage.getItem(HOME_SORT_KEY) === 'latest' ? 'latest' : 'foryou'; }
catch (e) { return 'foryou'; }
}
function setHomeSort(v) {
try { localStorage.setItem(HOME_SORT_KEY, v); } catch (e) {}
}
async function viewHome() {
var sort = homeSort();
col.innerHTML = head('Home', '') +
'<nav class="hd-tabs" aria-label="How the feed is ordered">' +
'<button class="hd-tab' + (sort === 'foryou' ? ' is-on' : '') + '" type="button" data-sort="foryou"' +
(sort === 'foryou' ? ' aria-current="true"' : '') + '>For you</button>' +
'<button class="hd-tab' + (sort === 'latest' ? ' is-on' : '') + '" type="button" data-sort="latest"' +
(sort === 'latest' ? ' aria-current="true"' : '') + '>Latest</button>' +
'</nav>' +
(my ? '<div class="nb-card hd-compose-card">' + composerHTML({}) + '</div>' : '') +
'<div class="hd-new-posts" data-new-posts hidden><div class="hd-new-posts-inner">' +
'<span class="hd-new-posts-avs" data-new-avs></span>' +
'<span class="hd-new-posts-t" data-new-t></span>' +
'</div></div>' +
'<div class="hd-feed" id="feed">' + skeletons(4) + '</div>';
if (my) {
wireComposer(col.querySelector('.hd-compose'), {
after: function () { viewHome(); }
});
}
col.querySelectorAll('[data-sort]').forEach(function (b) {
b.addEventListener('click', function () {
var to = b.getAttribute('data-sort');
if (to === homeSort()) return;
setHomeSort(to);
viewHome();
});
});
var token = painting;
var r = await db.rpc(sort === 'latest' ? 'feed_latest' : 'feed', { p_limit: 25 }).select(WITH_AUTHOR);
if (r.error && /feed_latest|does not exist|schema cache/i.test(String(r.error.message || ''))) {
r = await db.rpc('feed', { p_limit: 25 }).select(WITH_AUTHOR);
}
if (token !== painting) return;
var feed = el('feed');
if (!feed) return;
if (r.error) { feed.innerHTML = broke(H.trouble(r.error, '')); return; }
var rows = await hydrate(r.data || []);
if (token !== painting) return;
feed.innerHTML = rows.length ? await feedWithModules(rows)
: empty('Quiet so far', my ? 'Follow a few people, or say the first thing.' : 'Nothing has been posted yet.',
my ? '<button class="nb-btn nb-btn--primary nb-btn--sm" type="button" id="firstPost">' + ic('quill') + ' Write a post</button>' : '');
if (token !== painting) return;
twem(feed);
watchViews(feed);
wireNewPosts(sort === 'latest' ? 'feed_latest' : 'feed');
}
function narrow() {
try { return window.matchMedia('(max-width: 940px)').matches; }
catch (e) { return false; }
}
function inlineModule(title, icon, body) {
return '<section class="nb-card hd-inline-mod">' +
'<h2 class="hd-block-h">' + ic(icon) + ' ' + title + '</h2>' + body + '</section>';
}
async function feedWithModules(rows) {
var html = rows.map(function (p) { return card(p); });
if (!narrow() || rows.length < 5) return html.join('');
var got = await Promise.all([
db.rpc('who_to_follow', { p_limit: 6 }),
db.rpc('the_cry', { p_limit: 5 })
]);
var people = await attachAssoc(got[0].data || []);
var topics = (got[1].data && got[1].data.topics) || [];
var at = [];
if (people.length) at.push([3, inlineModule('Worth following', 'users', peopleStrip(people))]);
if (topics.length && rows.length > 9) at.push([9, inlineModule('Vibes', 'fire', trendRows(topics, 1))]);
for (var i = at.length - 1; i >= 0; i--) {
if (at[i][0] < html.length) html.splice(at[i][0], 0, at[i][1]);
}
return html.join('');
}
var EX_TABS = [
{ key: 'foryou', label: 'For you' },
{ key: 'vibes', label: 'Vibes' },
{ key: 'people', label: 'People' },
{ key: 'latest', label: 'Latest' }
];
var exTab = 'foryou';
function topicLine(t) {
var posts = t.post_count + ' post' + (t.post_count === 1 ? '' : 's');
if (t.author_count == null) return posts;
return posts + ' · ' + t.author_count + ' ' + (t.author_count === 1 ? 'person' : 'people');
}
function topicHref(t) { return 'search?q=' + encodeURIComponent('#' + t.tag); }
function topTopic(t) {
return link(topicHref(t),
'<span class="hd-top-n">1</span>' +
'<span class="hd-top-t"><b>#' + esc(t.tag) + '</b><i>' + topicLine(t) + '</i></span>',
'hd-top');
}
function trendRows(list, from) {
return '<div class="hd-trends">' + list.map(function (t, i) {
return link(topicHref(t),
'<span class="hd-trend-n">' + (from + i) + '</span>' +
'<span class="hd-trend-t"><b>#' + esc(t.tag) + '</b><i>' + topicLine(t) + '</i></span>',
'hd-trend');
}).join('') + '</div>';
}
function peopleStrip(people) {
return '<div class="hd-strip-track">' + people.map(function (p) {
var on = mine.following[p.handle];
return '<div class="hd-strip-card" data-person="' + p.id + '" data-handle="' + esc(p.handle) + '">' +
link('@' + p.handle, avatarOf(p, ''), 'hd-av-btn', ' data-card="' + esc(p.handle) + '" aria-hidden="true" tabindex="-1"') +
link('@' + p.handle, '<b>' + nameMark(p) + '</b><i>' + H.tag(p.handle) + '</i>', '', ' data-card="' + esc(p.handle) + '"') +
(my && p.id !== my.id
? '<button class="nb-btn nb-btn--sm ' + (on ? 'nb-btn--ghost' : 'nb-btn--primary') + '" type="button" data-follow="' + p.id + '">' +
(on ? 'Following' : 'Follow') + '</button>'
: '') + '</div>';
}).join('') + '</div>';
}
function exTabsHTML() {
return '<nav class="hd-tabs" aria-label="What Explore is showing">' + EX_TABS.map(function (t) {
return '<button class="hd-tab' + (t.key === exTab ? ' is-on' : '') + '" type="button" data-ex="' + t.key + '"' +
(t.key === exTab ? ' aria-current="true"' : '') + '>' + t.label + '</button>';
}).join('') + '</nav>';
}
async function viewExplore() {
var split = exTab === 'foryou';
col.innerHTML = head('Explore', 'What Hereld is talking about.') +
'<form class="hd-searchbar" id="exSearch">' +
'<span class="hd-searchbar-ic">' + ic('search') + '</span>' +
'<input class="nb-input" type="search" name="q" placeholder="Search posts, people and topics" aria-label="Search">' +
'</form>' +
exTabsHTML() +
'<div class="hd-ex-grid' + (split ? ' hd-ex-grid--split' : '') + '">' +
'<div class="hd-ex-main" id="exMain">' +
(exTab === 'vibes' || exTab === 'people' ? '' :
'<div class="hd-new-posts" data-new-posts hidden><div class="hd-new-posts-inner">' +
'<span class="hd-new-posts-avs" data-new-avs></span>' +
'<span class="hd-new-posts-t" data-new-t></span></div></div>') +
'<div class="hd-feed" id="feed">' + skeletons(3) + '</div>' +
'</div>' +
(split ? '<aside class="hd-ex-side">' +
'<section class="hd-block"><h2 class="hd-block-h">' + ic('fire') + ' Vibes</h2>' +
'<div id="exTags"><p class="nb-muted">Reading the room…</p></div></section>' +
'<section class="hd-block"><h2 class="hd-block-h">' + ic('users') + ' Worth following</h2>' +
'<div id="exWho"><p class="nb-muted">Looking…</p></div></section>' +
'</aside>' : '') +
'</div>';
col.querySelectorAll('[data-ex]').forEach(function (b) {
b.addEventListener('click', function () {
var to = b.getAttribute('data-ex');
if (to === exTab) return;
exTab = to;
viewExplore();
});
});
var token = painting;
var wantTopics = exTab === 'foryou' || exTab === 'vibes';
var wantPeople = exTab === 'foryou' || exTab === 'people';
var wantFeed = exTab === 'foryou' || exTab === 'latest';
var got = await Promise.all([
wantTopics ? db.rpc('the_cry', { p_limit: exTab === 'vibes' ? 30 : 8 }) : null,
wantPeople ? db.rpc('who_to_follow', { p_limit: exTab === 'people' ? 18 : 6 }) : null,
wantFeed ? db.from('posts').select(WITH_AUTHOR).is('reply_to', null)
.order('created_at', { ascending: false }).limit(exTab === 'latest' ? 25 : 12) : null
]);
if (token !== painting) return;
var topics = (got[0] && got[0].data && got[0].data.topics) || [];
var people = got[1] ? await attachAssoc(got[1].data || []) : [];
if (token !== painting) return;
var main = el('exMain');
if (exTab === 'vibes') {
main.innerHTML = topics.length
? topTopic(topics[0]) + (topics.length > 1 ? trendRows(topics.slice(1), 2) : '')
: empty('No topics yet', 'Put a # in a post and it starts one.');
} else if (exTab === 'people') {
main.innerHTML = people.length
? '<div class="hd-people-grid">' + people.map(personRow).join('') + '</div>'
: empty('Nobody to suggest yet', 'Once there are more accounts here this fills up.');
} else {
var feed = el('feed');
if (got[2].error) { feed.innerHTML = broke(); }
else {
var rows = await hydrate(got[2].data || []);
if (token !== painting) return;
feed.innerHTML = rows.length ? feedHTML(rows) : empty('Nothing yet', 'The first post has not been written.');
watchViews(feed);
wireNewPosts('feed_latest');
}
}
if (el('exTags')) {
el('exTags').innerHTML = topics.length
? trendRows(topics.slice(0, 6), 1)
: '<p class="nb-muted">No topics yet. Put a # in a post and it starts one.</p>';
}
if (el('exWho')) {
el('exWho').innerHTML = people.length
? '<div class="hd-list">' + people.map(personRow).join('') + '</div>'
: '<p class="nb-muted">Nobody to suggest yet.</p>';
}
twem(col);
}
function personRow(p) {
var on = mine.following[p.handle];
return '<div class="nb-card nb-card--tight hd-person" data-person="' + p.id + '" data-handle="' + esc(p.handle) + '">' +
'<a class="hd-av-btn" href="' + who(p.handle) + '" data-r data-card="' + esc(p.handle) + '" aria-hidden="true" tabindex="-1">' +
avatarOf(p, 'hd-av--sm') + '</a>' +
'<div class="hd-person-txt">' + link('@' + p.handle, nameMark(p), '', ' data-card="' + esc(p.handle) + '"') +
'<i>' + link('@' + p.handle, H.tag(p.handle)) + '</i>' +
(p.headline ? '<p>' + esc(p.headline) + '</p>' : '') + '</div>' +
(my && p.id !== my.id
? '<button class="nb-btn nb-btn--sm ' + (on ? 'nb-btn--ghost' : 'nb-btn--primary') + '" type="button" data-follow="' + p.id + '">' +
(on ? 'Following' : 'Follow') + '</button>'
: '') + '</div>';
}
async function viewSearch() {
var q = new URLSearchParams(location.search).get('q') || '';
col.innerHTML = head('Search', '') +
'<form class="hd-searchbar" id="exSearch">' +
'<span class="hd-searchbar-ic">' + ic('search') + '</span>' +
'<input class="nb-input" type="search" name="q" value="' + esc(q) + '" placeholder="Search posts, people and topics" aria-label="Search" data-focus>' +
'</form>' +
'<div id="sres">' + (q ? skeletons(3) : empty('Search Hereld', 'Look for a person, a post or a topic.')) + '</div>';
if (!q) return;
var token = painting;
var term = q.replace(/^#/, '');
var got = await Promise.all([
db.from('profiles').select('*').or('handle.ilike.%' + term + '%,name.ilike.%' + term + '%').limit(6),
db.rpc('search_posts', { p_q: term, p_limit: 25 }).select(WITH_AUTHOR)
]);
if (token !== painting) return;
var people = await attachAssoc(got[0].data || []);
var rows = await hydrate(got[1].data || []);
if (token !== painting) return;
var out = '';
if (people.length) {
out += '<section class="hd-block"><h2 class="hd-block-h">' + ic('users') + ' People</h2>' +
'<div class="hd-list">' + people.map(personRow).join('') + '</div></section>';
}
out += '<section class="hd-block"><h2 class="hd-block-h">' + ic('quill') + ' Posts</h2>' +
'<div class="hd-feed">' + (rows.length ? feedHTML(rows)
: empty('No results', 'Nothing on Hereld matches "' + q + '" yet.')) + '</div></section>';
el('sres').innerHTML = out;
twem(col);
watchViews(col);
}
var NOTE_WORDS = {
endorse: 'liked your post',
relay: 'relayed your post',
reply: 'replied to you',
follow: 'started following you',
mention: 'mentioned you',
verify: 'ruled on your verification request',
staff: 'sent you a message from the Hereld team',
note: 'published a community note',
quote: 'quoted your post',
affiliate: 'sent you an invitation'
};
var NOTE_ICONS = {
endorse: 'heart', relay: 'relay', reply: 'comment', follow: 'follow',
mention: 'quill', verify: 'tick', staff: 'shield', note: 'file',
quote: 'quote', affiliate: 'users'
};
var NOTE_FILTERS = [
{ key: 'all', label: 'All' },
{ key: 'endorse', label: 'Likes' },
{ key: 'reply', label: 'Replies' },
{ key: 'relay', label: 'Relays' },
{ key: 'follow', label: 'Follows' },
{ key: 'mention', label: 'Mentions' }
];
var noteFilter = 'all';
async function viewNotifications() {
if (!my) return needAccount();
col.innerHTML = head('Notifications', '', {
tools: '<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" id="readAll">' + ic('check') + ' Mark all read</button>'
}) +
'<div class="hd-note-filters" id="noteFilters">' +
NOTE_FILTERS.map(function (f) {
return '<button class="hd-note-filter' + (f.key === noteFilter ? ' is-on' : '') +
'" type="button" data-nf="' + f.key + '">' + esc(f.label) + '</button>';
}).join('') +
'</div>' +
'<div class="hd-list" id="notes">' + skeletons(4) + '</div>';
var token = painting;
var r = await db.rpc('notifications_grouped', { p_limit: 60 });
if (token !== painting) return;
var host = el('notes');
if (r.error) {
r = await db.from('notifications')
.select('*, actor:profiles!notifications_actor_fkey(id,handle,name,avatar_url,verified,is_company,is_platform,is_bot)')
.eq('user_id', my.id).order('created_at', { ascending: false }).limit(60);
if (token !== painting) return;
if (r.error) { host.innerHTML = broke(H.trouble(r.error, '')); return; }
renderFlatNotifications(host, r.data || []);
twem(host);
if (unread) { await db.rpc('notes_read_all'); unread = 0; paintRail(); }
return;
}
var data = r.data || {};
var rows = data.notifications || [];
if (noteFilter !== 'all') {
rows = rows.filter(function (n) {
return n.kinds && n.kinds.indexOf(noteFilter) !== -1;
});
}
renderGroupedNotifications(host, rows);
twem(host);
el('noteFilters').addEventListener('click', function (e) {
var btn = e.target.closest('[data-nf]');
if (!btn) return;
noteFilter = btn.dataset.nf;
viewNotifications();
});
if (unread) {
await db.rpc('notes_read_all');
unread = 0;
paintRail();
}
}
function renderGroupedNotifications(host, rows) {
host.innerHTML = rows.length ? rows.map(function (n) {
var name = n.actor_name || n.actor_handle || 'Someone';
var kinds = n.kinds || [n.kind];
var primary = kinds[0];
var to = n.post_id ? 'post/' + n.post_id : (n.actor_handle || 'home');
var countBadge = n.total > 1
? '<span class="hd-note-group-count">' + n.total + '</span>' : '';
var pills = kinds.length > 1
? '<span class="hd-note-kinds">' + kinds.map(function (k) {
return '<span class="hd-note-kind-pill">' + ic(NOTE_ICONS[k] || 'info') + ' ' + esc(NOTE_WORDS[k] || k) + '</span>';
}).join('') + '</span>' : '';
var text = kinds.length === 1 ? esc(NOTE_WORDS[primary] || 'did something') : '';
return '<a class="nb-card nb-card--tight hd-note hd-note-group' + (n.unread ? ' is-new' : '') +
'" href="' + url(to) + '" data-r>' +
'<span class="hd-note-ic" data-k="' + esc(primary) + '">' +
countBadge +
ic(NOTE_ICONS[primary] || 'info') + '</span>' +
'<span class="hd-note-txt"><p><b>' + esc(name) + '</b> ' + text + '</p>' +
pills +
(n.post_body ? '<p class="hd-note-quote">' + esc(String(n.post_body).slice(0, 160)) + '</p>' : '') +
'<span class="hd-note-when">' + esc(H.when(n.first_at || n.last_at)) + '</span></span></a>';
}).join('') : empty('Nothing yet', 'Likes, relays, replies and follows land here.');
}
function renderFlatNotifications(host, rows) {
host.innerHTML = rows.length ? rows.map(function (n) {
var a = n.actor || {};
var text = NOTE_WORDS[n.kind] || 'did something';
var to = n.post_id ? 'post/' + n.post_id : (a.handle || 'home');
return '<a class="nb-card nb-card--tight hd-note' + (n.read_at ? '' : ' is-new') + '" href="' + url(to) + '" data-r>' +
'<span class="hd-note-ic" data-k="' + esc(n.kind) + '">' +
ic(NOTE_ICONS[n.kind] || 'info') + '</span>' +
'<span class="hd-note-txt"><p><b>' + esc(a.name || a.handle || 'Someone') + '</b> ' + esc(text) + '</p>' +
(n.meta?.post_body ? '<p class="hd-note-quote">' + esc(String(n.meta.post_body).slice(0, 160)) + '</p>' : '') +
'<span class="hd-note-when">' + esc(H.when(n.created_at)) + '</span></span></a>';
}).join('') : empty('Nothing yet', 'Likes, relays, replies and follows land here.');
}
async function viewBookmarks() {
if (!my) return needAccount();
col.innerHTML = head('Bookmarks', 'Only you can see this list.') +
'<div class="hd-feed" id="feed">' + skeletons(3) + '</div>';
var token = painting;
var r = await db.from('bookmarks').select('post_id, created_at')
.eq('user_id', my.id).order('created_at', { ascending: false }).limit(50);
if (token !== painting) return;
var feed = el('feed');
if (r.error) { feed.innerHTML = broke(H.trouble(r.error, '')); return; }
var ids = (r.data || []).map(function (b) { return b.post_id; });
if (!ids.length) {
feed.innerHTML = empty('No bookmarks yet', 'Save a post and it waits for you here.');
return;
}
var p = await db.from('posts').select(WITH_AUTHOR).in('id', ids);
if (token !== painting) return;
var order = {};
ids.forEach(function (id, i) { order[id] = i; });
var rows = await hydrate((p.data || []).sort(function (a, b) { return order[a.id] - order[b.id]; }));
if (token !== painting) return;
feed.innerHTML = rows.length ? feedHTML(rows) : empty('No bookmarks yet', 'Save a post and it waits for you here.');
twem(feed);
watchViews(feed);
}
var PROF_TABS = [
{ key: 'posts', label: 'Posts' },
{ key: 'replies', label: 'Replies' },
{ key: 'media', label: 'Media' },
{ key: 'articles', label: 'Articles' }
];
async function viewProfile(handle, tab) {
tab = tab || 'posts';
col.innerHTML = head('&nbsp;', '', { back: true }) +
'<div class="nb-card hd-prof"><span class="nb-skel" style="height:170px;display:block"></span>' +
'<div class="hd-prof-in"><div class="hd-prof-face"><span class="nb-skel nb-skel--av"></span></div>' +
'<span class="nb-skel nb-skel--line" style="width:40%;margin-top:16px"></span></div></div>' +
'<div class="hd-feed" id="feed">' + skeletons(3) + '</div>';
var token = painting;
var p = await person(handle);
if (token !== painting) return;
if (!p) { col.innerHTML = notFoundHTML('No account with that handle.'); return; }
var counts = await Promise.all([
my ? db.from('follows').select('follower').eq('follower', my.id).eq('following', p.id).maybeSingle() : Promise.resolve({}),
my ? db.from('blocks').select('blocked').eq('blocker', my.id).eq('blocked', p.id).maybeSingle() : Promise.resolve({}),
db.rpc('affiliates_of', { p_id: p.id }),
my ? db.rpc('relation_with', { p_id: p.id }) : Promise.resolve({})
]);
if (token !== painting) return;
var assoc = (counts[2] && counts[2].data) || [];
var following = !!(counts[0] && counts[0].data);
var blocked = !!(counts[1] && counts[1].data);
mine.following[p.handle] = following;
var isMe = my && my.id === p.id;
var tabsHTML = tabs(PROF_TABS.filter(function (t) {
return t.key !== 'articles' || p.is_company;
}).map(function (t) {
return { key: t.key, label: t.label, path: '@' + p.handle + (t.key === 'posts' ? '' : '/' + t.key) };
}), tab);
var joined = new Date(p.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
col.innerHTML = head(esc(p.name || p.handle),
'<span class="hd-sub-n">' + num(p.post_count) + ' posts</span>', { back: true }) +
'<div class="nb-card hd-prof">' +
'<button class="hd-cover' + (p.banner_url ? ' hd-cover--live' : ' hd-cover--empty') + '" type="button" ' +
(p.banner_url ? 'style="background-image:url(' + esc(p.banner_url) + ')" data-cover="' + esc(p.banner_url) + '"' : 'disabled') +
' aria-label="Banner"></button>' +
'<div class="hd-prof-in">' +
'<div class="hd-prof-face">' +
'<button class="hd-av-btn" type="button" data-face="' + esc(p.avatar_url || '') + '" aria-label="Profile picture">' +
avatarOf(p, 'hd-av--xl') + '</button>' +
'<div class="hd-prof-acts">' + profileActs(p, isMe, following, blocked) + '</div>' +
'</div>' +
'<h2 class="hd-prof-name">' + nameMark(p) + '</h2>' +
'<p class="hd-prof-at">' + H.tag(p.handle, 'hd-at--lg') + '</p>' +
(p.headline ? '<p class="hd-prof-head">' + esc(p.headline) + '</p>' : '') +
(p.bio ? '<p class="hd-prof-bio">' + body(p.bio) + '</p>' : '') +
'<p class="hd-prof-meta">' +
(p.location ? '<span>' + ic('mapmarker') + esc(p.location) + '</span>' : '') +
(p.website ? '<span>' + ic('link') + '<a href="' + esc(p.website) + '" target="_blank" rel="noopener nofollow">' +
esc(p.website.replace(/^https?:\/\/(www\.)?/, '')) + '</a></span>' : '') +
'<span>' + ic('clock') + 'Joined ' + esc(joined) + '</span>' +
(p.industry ? '<span>' + ic('building') + esc(p.industry) + '</span>' : '') +
'</p>' +
'<p class="hd-count-row">' +
countBtn(p, 'following', p.following_count, 'Following') +
countBtn(p, 'followers', p.follower_count, 'Follower' + (p.follower_count === 1 ? '' : 's')) +
(assoc.length ? countBtn(p, 'affiliated', assoc.length, 'Associated') : '') +
'</p>' +
standingHTML(counts[3] && counts[3].data) +
(assoc.length ? assocHTML(assoc) : '') +
'</div>' +
'</div>' + tabsHTML +
'<div class="hd-feed" id="feed">' + skeletons(3) + '</div>';
twem(col);
if (blocked) {
el('feed').innerHTML = empty('You blocked this account', 'Unblock them to see their posts again.');
return;
}
var feed = el('feed');
var r;
if (tab === 'articles') {
var q = db.from('articles').select('*').eq('author', p.id);
if (!isMe) q = q.eq('published', true);
r = await q.order('created_at', { ascending: false }).limit(30);
if (token !== painting) return;
var arts = r.data || [];
feed.innerHTML =
(isMe && p.is_company
? '<div class="hd-art-new"><button class="nb-btn nb-btn--primary nb-btn--sm" type="button" id="artNew">' +
ic('edit') + ' Write an article</button></div>'
: '') +
(arts.length ? arts.map(function (a) { return articleCard(a, p, isMe); }).join('')
: empty('No articles yet', p.is_company
? 'Articles this company publishes will appear here.'
: 'Only company accounts publish articles.'));
twem(feed);
if (isMe && p.is_company) {
el('artNew').addEventListener('click', function () { articleComposer(); });
feed.addEventListener('click', async function (e) {
var b = e.target.closest && e.target.closest('[data-art-drop]');
if (!b) return;
var sure = await U.ask({
title: 'Delete this article',
line: 'It comes off your profile for good.',
yes: 'Delete it', bad: true
});
if (!sure) return;
var d = await db.from('articles').delete().eq('id', b.getAttribute('data-art-drop'));
if (d.error) return U.toast(H.trouble(d.error, 'That did not delete.'), 'bad');
render();
});
}
return;
}
if (tab === 'replies') {
r = await db.from('posts').select(WITH_AUTHOR).eq('author', p.id).not('reply_to', 'is', null)
.order('created_at', { ascending: false }).limit(30);
} else {
r = await db.from('posts').select(WITH_AUTHOR).eq('author', p.id).is('reply_to', null)
.order('created_at', { ascending: false }).limit(30);
}
if (token !== painting) return;
if (r.error) { feed.innerHTML = broke(H.trouble(r.error, '')); return; }
var rows = await hydrate(r.data || []);
if (tab === 'media') {
rows = rows.filter(function (x) { return /https?:\/\/\S+\.(png|jpe?g|webp|gif)/i.test(x.body || ''); });
}
if (token !== painting) return;
feed.innerHTML = rows.length ? feedHTML(rows) : empty(
tab === 'media' ? 'No pictures yet' : tab === 'replies' ? 'No replies yet' : 'No posts yet',
isMe ? 'Whatever you post shows up here.' : 'Nothing here so far.');
twem(feed);
watchViews(feed);
}
function assocHTML(list) {
return '<div class="hd-assoc"><h3>' + ic('users') + ' Associated accounts</h3><div class="hd-assoc-row">' +
list.slice(0, 12).map(function (m) {
return link('@' + m.handle, avatarOf(m, 'hd-av--sm') +
'<span>' + esc(m.name || m.handle) + (m.role ? '<i>' + esc(m.role) + '</i>' : '') + '</span>', 'hd-assoc-one');
}).join('') + '</div></div>';
}
function countBtn(p, kind, n, label) {
return '<button class="hd-count-btn" type="button" data-list="' + kind + '" data-list-of="' + p.id +
'" data-list-who="' + esc(p.handle) + '"><b>' + num(n || 0) + '</b> ' + label + '</button>';
}
function standingHTML(r) {
if (!r) return '';
var bits = [];
if (r.follows_me) bits.push(r.i_follow ? 'Follows you back' : 'Follows you');
if (r.common) bits.push(num(r.common) + ' associated account' + (r.common === 1 ? '' : 's') + ' in common');
if (!bits.length) return '';
return '<p class="hd-standing">' + bits.map(function (b) {
return '<span class="hd-chip">' + esc(b) + '</span>';
}).join('') + '</p>';
}
var LIST_TITLE = { followers: 'Followers', following: 'Following', affiliated: 'Associated accounts' };
function listCard(kind, id, handle) {
var s = U.sheet({
title: LIST_TITLE[kind] || 'Accounts',
html: '<p class="hd-modal-line">' + H.tag(handle) + '</p><div class="hd-list" id="lsBody">' + skeletons(3) + '</div>'
});
var call = kind === 'affiliated'
? db.rpc('affiliates_of', { p_id: id })
: db.rpc('follows_of', { p_id: id, p_side: kind === 'following' ? 'following' : 'followers' });
call.then(function (r) {
var box = s.q('#lsBody');
if (!box) return;
if (r.error) { box.innerHTML = broke('That list could not be opened.'); return; }
var rows = r.data || [];
if (!rows.length) {
box.innerHTML = empty('Nothing here yet', kind === 'affiliated'
? 'No accounts are associated with this one.'
: kind === 'following' ? 'This account follows nobody yet.' : 'Nobody follows this account yet.');
return;
}
attachAssoc(rows).then(function () {
if (!s.q('#lsBody')) return;
box.innerHTML = rows.map(personRow).join('');
twem(box);
});
});
}
function profileActs(p, isMe, following, blocked) {
if (isMe) {
return '<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" data-settings>' + ic('edit') + ' Edit profile</button>';
}
var f = my
? '<button class="nb-btn nb-btn--sm ' + (following ? 'nb-btn--ghost' : 'nb-btn--primary') + '" type="button" data-follow="' + p.id + '">' +
(following ? 'Following' : 'Follow') + '</button>'
: link('join', 'Follow', 'nb-btn nb-btn--primary nb-btn--sm');
if (blocked) {
f = '<button class="nb-btn nb-btn--red nb-btn--sm" type="button" data-unblock="' + p.id + '">Blocked</button>';
}
return f + '<button class="nb-icon-btn nb-icon-btn--round" type="button" data-pmore="' + esc(p.handle) + '" ' +
'aria-haspopup="menu" aria-expanded="false" aria-label="More">' + ic('more') + '</button>';
}
function articleCard(a, who, mineToo) {
return '<article class="nb-card hd-art">' +
(a.cover_url ? '<img class="hd-art-cover" src="' + esc(a.cover_url) + '" alt="">' : '') +
'<div class="hd-art-in">' +
'<span class="hd-art-kind">' + ic(a.kind === 'link' ? 'link' : 'file') + (a.kind === 'link' ? 'Linked article' : 'Article') + '</span>' +
'<h3>' + (a.kind === 'link'
? '<a href="' + esc(a.url) + '" target="_blank" rel="noopener nofollow">' + esc(a.title) + '</a>'
: '<a href="' + url('article/' + a.id) + '" data-r>' + esc(a.title) + '</a>') + '</h3>' +
(a.summary ? '<p>' + esc(a.summary) + '</p>' : '') +
'<span class="hd-art-by">' + esc(who.name || who.handle) + ' · ' + esc(H.when(a.created_at)) +
(a.published ? '' : ' · Draft') + '</span>' +
(mineToo
? '<div class="hd-art-do"><button class="nb-btn nb-btn--red nb-btn--sm" type="button" ' +
'data-art-drop="' + a.id + '">Delete</button></div>'
: '') +
'</div></article>';
}
function articleComposer() {
U.sheet({
title: 'Write an article',
wide: true,
html:
'<form class="hd-artform" id="artForm">' +
'<div class="nb-field"><label class="nb-label" for="arKind">Kind</label>' +
'<select class="nb-select" id="arKind">' +
'<option value="native">Written here</option>' +
'<option value="link">A link to where it lives</option>' +
'</select></div>' +
'<div class="nb-field"><label class="nb-label" for="arTitle">Title</label>' +
'<input class="nb-input" id="arTitle" maxlength="140" data-focus></div>' +
'<div class="nb-field"><label class="nb-label" for="arSum">Summary ' +
'<span class="nb-hint">shown on your profile</span></label>' +
'<textarea class="nb-textarea" id="arSum" rows="2" maxlength="300"></textarea></div>' +
'<div class="nb-field" id="arBodyF"><label class="nb-label" for="arBody">The article</label>' +
'<textarea class="nb-textarea" id="arBody" rows="12" maxlength="40000"></textarea></div>' +
'<div class="nb-field" id="arUrlF" hidden><label class="nb-label" for="arUrl">Address</label>' +
'<input class="nb-input" id="arUrl" type="url" placeholder="https://"></div>' +
'<div class="nb-field"><label class="nb-label" for="arCover">Cover picture ' +
'<span class="nb-hint">optional</span></label>' +
'<input class="nb-input" id="arCover" type="url" placeholder="https://"></div>' +
'<label class="nb-check"><input type="checkbox" id="arPub" checked>' +
'<span class="nb-box"></span><span>Publish it now</span></label>' +
'<p class="nb-alert nb-alert--error hd-say" id="arSay" hidden></p>' +
'<div class="hd-set-foot">' +
'<button class="nb-btn nb-btn--primary nb-btn--sm" type="submit">Save the article</button>' +
'</div>' +
'</form>',
wire: function (api) {
var kind = api.q('#arKind');
var say = api.q('#arSay');
kind.addEventListener('change', function () {
var linked = kind.value === 'link';
api.q('#arBodyF').hidden = linked;
api.q('#arUrlF').hidden = !linked;
});
api.q('#artForm').addEventListener('submit', async function (e) {
e.preventDefault();
var btn = api.q('button[type="submit"]');
var linked = kind.value === 'link';
var row = {
author: my.id, kind: kind.value,
title: api.q('#arTitle').value.trim(),
summary: api.q('#arSum').value.trim(),
body: linked ? '' : api.q('#arBody').value.trim(),
url: linked ? api.q('#arUrl').value.trim() : '',
cover_url: api.q('#arCover').value.trim() || null,
published: api.q('#arPub').checked
};
if (row.title.length < 3) { say.textContent = 'Give it a title first.'; say.hidden = false; return; }
if (linked ? !row.url : !row.body) {
say.textContent = linked ? 'Say where it lives.' : 'There is nothing written yet.';
say.hidden = false; return;
}
btn.disabled = true;
var r = await db.from('articles').insert(row);
btn.disabled = false;
if (r.error) { say.textContent = H.trouble(r.error, 'That did not save.'); say.hidden = false; return; }
say.hidden = true;
api.close();
U.toast(row.published ? 'Article published.' : 'Saved as a draft.');
render();
});
}
});
}
async function viewArticle(id) {
col.innerHTML = head('Article', '', { back: true }) + '<div class="nb-card nb-card--lg">' + skeletons(1) + '</div>';
var token = painting;
var r = await db.from('articles')
.select('*, author:profiles!articles_author_fkey(id,handle,name,avatar_url,verified,is_company)')
.eq('id', id).maybeSingle();
if (token !== painting) return;
if (r.error || !r.data) { col.innerHTML = notFoundHTML('That article is not here.'); return; }
var a = r.data, who = a.author || {};
col.innerHTML = head('Article', '', { back: true }) +
'<article class="nb-card nb-card--lg hd-art-full">' +
(a.cover_url ? '<img class="hd-art-cover" src="' + esc(a.cover_url) + '" alt="">' : '') +
'<h1 class="nb-h2">' + esc(a.title) + '</h1>' +
'<div class="hd-art-head">' + avatarOf(who, 'hd-av--sm') +
nameLine(who, new Date(a.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })) + '</div>' +
(a.summary ? '<p class="hd-art-lede">' + esc(a.summary) + '</p>' : '') +
'<div class="hd-art-body">' + body(a.body) + '</div>' +
'</article>';
twem(col);
}
async function viewThread(id) {
col.innerHTML = head('Post', '', { back: true }) + '<div class="hd-feed" id="feed">' + skeletons(2) + '</div>';
var token = painting;
var r = await db.from('posts').select(WITH_AUTHOR).eq('id', id).maybeSingle();
if (token !== painting) return;
if (r.error || !r.data) { col.innerHTML = notFoundHTML('That post is not here. It may have been deleted.'); return; }
var main = (await hydrate([r.data]))[0];
var parent = null;
if (main.reply_to) {
var pr = await db.from('posts').select(WITH_AUTHOR).eq('id', main.reply_to).maybeSingle();
if (pr.data) parent = (await hydrate([pr.data]))[0];
}
var kids = await db.from('posts').select(WITH_AUTHOR).eq('reply_to', id)
.order('created_at', { ascending: true }).limit(50);
var replies = await hydrate(kids.data || []);
var mayReply = !my;
if (my) {
var ok = await db.rpc('can_reply', { p_parent: id });
mayReply = ok.error ? true : ok.data !== false;
}
if (token !== painting) return;
el('feed').innerHTML =
(parent ? card(parent) + '<div class="hd-thread-line"></div>' : '') +
card(main, { lead: true }) +
(my && mayReply ? '<div class="nb-card hd-compose-card">' + composerHTML({
replyTo: id, toHandle: (main.author || {}).handle, label: 'Reply', placeholder: 'Write a reply'
}) + '</div>' : '') +
(my && !mayReply
? '<div class="nb-card hd-shut">' + ic(scopeOf(main.reply_scope).i) +
'<p>' + esc(scopeOf(main.reply_scope).t) + ' can reply to this. You can still pass it on.</p></div>'
: '') +
(replies.length ? feedHTML(replies)
: '<div class="hd-sep-say">' + (my && mayReply ? 'No replies yet. Yours would be the first.' : 'No replies yet.') + '</div>');
if (my && mayReply) {
wireComposer(col.querySelector('.hd-compose'), { replyTo: id, label: 'Reply', after: function () { viewThread(id); } });
}
twem(col);
watchViews(col);
}
var novaTalk = [];
function novaTurn(t) {
return '<div class="hd-look-chat-turn hd-look-chat-turn--' + (t.role === 'you' ? 'me' : 'nova') + '">' +
(t.role === 'you'
? H.avatar(my, 'hd-av--sm')
: novaAv('hd-nova-av-grad', 26)) +
'<div class="hd-look-chat-said">' + body(t.text) + '</div></div>';
}
async function novaOnPost(btn) {
if (needAccount()) return;
var box = btn.closest('[data-post]');
var id = box && box.getAttribute('data-post');
if (!id) return;
var r = await db.from('posts').select('body, created_at, endorse_count, reply_count, relay_count, author:profiles!posts_author_fkey(id,handle,name,avatar_url,follower_count,verified,is_company)')
.eq('id', id).maybeSingle();
if (r.error || !r.data) return U.toast('That post could not be read.', 'bad');
var p = r.data, a = p.author || {};
var who = a.name || a.handle || 'Someone';
var avatar = H.avatar(a, 'hd-av--md');
var verified = a.verified ? ' <span class="hd-badge hd-badge--ver">' + ic('verified') + '</span>' : '';
var company = a.is_company ? ' <span class="hd-badge hd-badge--co">' + ic('verified') + '</span>' : '';
var mediaR = await db.from('post_media')
.select('url, alt_text, spoiler, kind, mime, name, size_bytes')
.eq('post_id', id).order('position');
var mediaList = mediaR.data || [];
var NOUN = { image: 'picture', video: 'video', audio: 'sound file', file: 'file' };
var mediaText = mediaList.length
? '\n\nAttached (' + mediaList.length + '), none of which can be opened or seen:\n' +
mediaList.map(function (m) {
return '- ' + (NOUN[m.kind] || 'file') +
(m.name ? ' "' + m.name + '"' : '') +
(m.size_bytes ? ', ' + weigh(m.size_bytes) : '') + ': ' +
(m.alt_text ? 'described as "' + m.alt_text + '"' : 'nothing was written about it') +
(m.spoiler ? ', covered as sensitive' : '');
}).join('\n')
: '';
var [repliesR, repostsR] = await Promise.all([
db.from('posts').select('id,body,author,created_at,endorse_count,author:profiles!posts_author_fkey(handle,name)')
.eq('reply_to', id).order('created_at').limit(5),
db.from('posts').select('id,body,author,created_at,author:profiles!posts_author_fkey(handle,name)')
.eq('relay_of', id).order('created_at').limit(5)
]);
var replies = repliesR.data || [];
var reposts = repostsR.data || [];
var repliesText = replies.length
? '\n\nReplies (' + (p.reply_count || 0) + ' total, showing ' + replies.length + '):\n' +
replies.map(function (r) {
var ra = r.author || {};
return '- @' + (ra.handle || '?') + ': ' + String(r.body || '').replace(/\s+/g, ' ').slice(0, 200);
}).join('\n')
: '';
var repostsText = reposts.length
? '\n\nRelays (' + (p.relay_count || 0) + ' total, showing ' + reposts.length + '):\n' +
reposts.map(function (r) {
var ra = r.author || {};
return '- @' + (ra.handle || '?') + (r.body ? ': ' + String(r.body).replace(/\s+/g, ' ').slice(0, 200) : ' (plain repost)');
}).join('\n')
: '';
var turns = [{ role: 'them', text:
'Explain this post from Hereld in plain language, in under 120 words. ' +
'Say what it is about and anything a reader would need to know to follow it. ' +
'Include context from replies and relays if they help explain the discussion. ' +
'If it is too short or too vague to explain, say that instead of guessing.\n\n' +
who + ' posted:\n' + String(p.body || '') + mediaText + repliesText + repostsText }];
U.sheet({
wide: true,
title: '',
html:
'<div class="hd-look-card">' +
'<div class="hd-look-head">' +
'<span class="hd-look-title">' + novaAv('hd-nva--grad', 20) + ' Supernova on this post</span>' +
'<div class="hd-look-actions">' +
'<button class="nb-icon-btn" type="button" data-look-close title="Close">' + ic('x') + '</button>' +
'</div>' +
'</div>' +
'<div class="hd-look-post">' +
'<div class="hd-look-post-inner">' +
'<a href="' + url('profile/' + (a.handle || '')) + '" data-r class="hd-look-post-av">' + avatar + '</a>' +
'<div class="hd-look-post-who">' +
'<a href="' + url('profile/' + (a.handle || '')) + '" data-r class="hd-look-post-name">' + esc(who) + verified + company + '</a>' +
'<span class="hd-look-post-handle">' + H.tag(a.handle || '') + '</span>' +
'</div>' +
'</div>' +
'<p class="hd-look-post-body">' + body(p.body) + '</p>' +
(mediaList.length ? '<div class="hd-look-post-media">' + mediaList.map(function (m) {
return '<img src="' + esc(m.url) + '" alt="' + esc(m.alt_text || '') + '" loading="lazy">';
}).join('') + '</div>' : '') +
'<div class="hd-look-post-meta">' +
'<span>' + esc(H.when(p.created_at)) + '</span>' +
'<span class="hd-dot">&middot;</span>' +
'<span>' + num(p.endorse_count || 0) + ' likes</span>' +
'<span class="hd-dot">&middot;</span>' +
'<span>' + num(p.reply_count || 0) + ' replies</span>' +
'<span class="hd-dot">&middot;</span>' +
'<span>' + num(p.relay_count || 0) + ' relays</span>' +
'</div>' +
(replies.length ? '<div class="hd-look-replies">' +
'<p class="hd-look-replies-title">Recent replies</p>' +
replies.map(function (r) {
var ra = r.author || {};
return '<div class="hd-look-reply">' +
'<span class="hd-look-reply-handle">@' + esc(ra.handle || '?') + '</span> ' +
'<span class="hd-look-reply-body">' + esc(String(r.body || '').replace(/\s+/g, ' ').slice(0, 160)) + '</span>' +
'</div>';
}).join('') +
'</div>' : '') +
(reposts.length ? '<div class="hd-look-relays">' +
'<p class="hd-look-replies-title">Relays</p>' +
reposts.map(function (r) {
var ra = r.author || {};
return '<div class="hd-look-reply">' +
'<span class="hd-look-reply-handle">@' + esc(ra.handle || '?') + '</span> ' +
(r.body ? '<span class="hd-look-reply-body">' + esc(String(r.body).replace(/\s+/g, ' ').slice(0, 160)) + '</span>' : '<span class="hd-look-reply-body hd-muted">relayed</span>') +
'</div>';
}).join('') +
'</div>' : '') +
'</div>' +
'<div class="hd-look-loading" id="lookLoad">' +
'<span class="hd-nova-dots"><i></i><i></i><i></i></span> Reading it' +
'</div>' +
'<div class="hd-look-answer" id="lookAns" hidden></div>' +
'<div class="hd-look-follow" id="lookFollow" hidden>' +
'<textarea class="nb-input" rows="1" placeholder="Ask something else" id="novaExplainInput"></textarea>' +
'<button class="nb-btn nb-btn--primary" type="button" id="novaExplainSend" disabled>' + ic('send') + '</button>' +
'</div>' +
'</div>',
wire: function (api) {
api.q('[data-look-close]').addEventListener('click', api.close);
twem(api.body);
var load = api.q('#lookLoad');
var ans = api.q('#lookAns');
var follow = api.q('#lookFollow');
var input = api.q('#novaExplainInput');
var sendBtn = api.q('#novaExplainSend');
var busy = false;
input.addEventListener('input', function () {
sendBtn.disabled = !input.value.trim() || busy;
input.style.height = 'auto';
input.style.height = Math.min(input.scrollHeight, 120) + 'px';
});
input.addEventListener('keydown', function (e) {
if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
});
function addChatTurn(role, text) {
var chat = ans.querySelector('.hd-look-chat');
if (!chat) { chat = document.createElement('div'); chat.className = 'hd-look-chat'; ans.appendChild(chat); }
var div = document.createElement('div');
div.className = 'hd-look-chat-turn hd-look-chat-turn--' + (role === 'you' ? 'me' : 'nova');
div.innerHTML = (role === 'you' ? H.avatar(my, 'hd-av--sm') : novaAv('hd-nova-av-grad', 26)) +
'<div class="hd-look-chat-said">' + body(text) + '</div>';
chat.appendChild(div);
twem(div);
ans.scrollTop = ans.scrollHeight;
}
sendBtn.addEventListener('click', async function () {
var txt = input.value.trim();
if (!txt || busy) return;
busy = true; sendBtn.disabled = true; input.value = ''; input.style.height = 'auto';
addChatTurn('you', txt);
turns.push({ role: 'them', text: txt });
try {
var out = await H.fn('supernova?job=ask', { post: id, turns: turns });
addChatTurn('me', out.text || 'Nothing came back.');
turns.push({ role: 'you', text: out.text || '' });
} catch (e) {
addChatTurn('me', 'Supernova could not answer that.');
}
busy = false; sendBtn.disabled = !input.value.trim();
});
H.fn('supernova?job=ask', { post: id, turns: turns }).then(function (out) {
var text = out.text || 'Nothing came back.';
if (load) load.hidden = true;
if (ans) { ans.hidden = false; ans.innerHTML = '<p class="hd-look-answer-text">' + body(text) + '</p>'; }
if (follow) follow.hidden = false;
turns.push({ role: 'you', text: text });
twem(ans);
}).catch(function (e) {
if (load) load.innerHTML = '<span class="hd-nova-bad">' + esc(e.message || 'Could not answer.') + '</span>';
});
}
});
}
async function viewSupernova() {
col.innerHTML = head('Ask Supernova', 'Swiftaw&rsquo;s assistant, built into Hereld.') +
'<div class="hd-loading" role="status">Opening Supernova&hellip;</div>';
var ready = await db.rpc('supernova_ready');
if (ready.error || !ready.data) {
col.innerHTML = head('Ask Supernova', 'Swiftaw&rsquo;s assistant, built into Hereld.') +
'<div class="nb-card nb-card--lg hd-nova-off">' +
novaAv('hd-nova-mark-grad', 62) +
'<h2 class="nb-h3">Supernova is not answering yet</h2>' +
'<p>Hereld reaches Supernova through Swiftaw, and Swiftaw has not pointed it at a model yet. ' +
'Nothing you type would go anywhere, so there is nothing to type into.</p>' +
'<div class="hd-nova-acts">' + link('explore', 'Back to Explore', 'nb-btn nb-btn--ghost') + '</div>' +
'</div>';
return;
}
col.innerHTML = head('Ask Supernova', 'Swiftaw&rsquo;s assistant, built into Hereld.') +
'<div class="hd-nova">' +
'<div class="hd-look-card hd-nova-card">' +
'<div class="hd-look-head">' +
'<span class="hd-look-title">' + novaAv('hd-nva--grad', 20) + ' Ask Supernova</span>' +
'</div>' +
'<div class="hd-look-chat hd-nova-talk" id="novaTalk" aria-live="polite">' +
(novaTalk.length ? novaTalk.map(novaTurn).join('') :
'<div class="nb-card hd-nova-hello">' +
novaAv('hd-nova-hello-av', 48) +
'<p>Ask about a post, a word you have not met, or anything else. ' +
'Supernova cannot post, follow or moderate for you, and it will say so rather than pretend.</p>' +
'</div>') +
'</div>' +
'<div class="hd-look-follow hd-nova-ask" id="novaForm">' +
'<label class="nb-sr" for="novaIn">Ask Supernova</label>' +
'<textarea class="nb-input" id="novaIn" rows="1" maxlength="1200" ' +
'placeholder="Ask Supernova..."></textarea>' +
'<button class="nb-btn nb-btn--primary" type="submit" id="novaGo">' + ic('send') + '</button>' +
'</div>' +
'<p class="hd-nova-fine">Answers are generated and can be wrong. Check anything that matters.</p>' +
'</div>' +
'</div>';
twem(col);
var form = col.querySelector('#novaForm');
var box = col.querySelector('#novaIn');
var go = col.querySelector('#novaGo');
var talk = col.querySelector('#novaTalk');
var busy = false;
function grow() { box.style.height = 'auto'; box.style.height = Math.min(box.scrollHeight, 200) + 'px'; }
box.addEventListener('input', grow);
box.addEventListener('keydown', function (e) {
if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go.click(); }
});
function paint() {
talk.innerHTML = novaTalk.map(novaTurn).join('') +
(busy ? '<div class="hd-look-chat-turn hd-look-chat-turn--nova">' +
novaAv('hd-nova-av-grad', 26) +
'<div class="hd-look-chat-said"><span class="hd-nova-dots"><i></i><i></i><i></i></span></div></div>' : '');
twem(talk);
talk.scrollTop = talk.scrollHeight;
}
go.addEventListener('click', async function (e) {
e.preventDefault();
if (busy) return;
if (needAccount()) return;
var said = box.value.trim();
if (!said) return;
novaTalk.push({ role: 'them', text: said });
box.value = ''; grow();
busy = true; go.disabled = true;
paint();
try {
var out = await H.fn('supernova?job=ask', { turns: novaTalk });
novaTalk.push({ role: 'you', text: out.text || 'Nothing came back.' });
} catch (err) {
novaTalk.pop();
box.value = said; grow();
U.toast(String(err.message || 'Supernova could not answer that.'), 'bad');
}
busy = false; go.disabled = false;
paint();
box.focus();
});
}
function notFoundHTML(line) {
return '<div class="nb-card nb-card--lg hd-404">' +
'<div class="hd-404-num">404</div>' +
'<h1 class="nb-h2">Nobody answered that horn<span class="dot">.</span></h1>' +
'<p>' + esc(line || 'The page is not here. It may have been a handle that changed, a post that was taken down, or a link that was never right.') + '</p>' +
'<div class="hd-404-acts">' + link('home', 'Back to the feed', 'nb-btn nb-btn--primary') +
link('explore', 'Explore', 'nb-btn nb-btn--ghost') + '</div></div>';
}
async function paintAside() {
if (!aside) return;
aside.innerHTML =
'<form class="hd-searchbar hd-searchbar--aside" id="asideSearch">' +
'<span class="hd-searchbar-ic">' + ic('search') + '</span>' +
'<input class="nb-input" type="search" name="q" placeholder="Search Hereld" aria-label="Search Hereld">' +
'</form>' +
'<section class="nb-card hd-aside-card" id="asideTags"><h2>' + ic('fire') + ' Vibes</h2>' +
'<p class="nb-muted">Reading the room…</p></section>' +
'<section class="nb-card hd-aside-card" id="asideWho"><h2>' + ic('users') + ' Worth following</h2>' +
'<p class="nb-muted">Looking…</p></section>' +
'<nav class="hd-aside-legal">' +
'<a href="https://swiftaw.com/legal/terms-of-service">Terms</a>' +
'<a href="https://swiftaw.com/legal/privacy-policy">Privacy</a>' +
'<a href="https://swiftaw.com/">Swiftaw</a>' +
'<span>© 2026 Swiftaw</span></nav>';
var got = await Promise.all([
db.rpc('the_cry', { p_limit: 6 }),
db.rpc('who_to_follow', { p_limit: 3 })
]);
var tags = (got[0].data && got[0].data.topics) || [];
var tagBox = el('asideTags');
if (tagBox) {
tagBox.innerHTML = '<h2>' + ic('fire') + ' Vibes</h2>' + (tags.length
? tags.map(function (t) {
return link('search?q=' + encodeURIComponent('#' + t.tag),
'<b>#' + esc(t.tag) + '</b><i>' + t.post_count + ' post' + (t.post_count === 1 ? '' : 's') + '</i>', 'hd-aside-row');
}).join('')
: '<p class="nb-muted">Nothing trending yet. Start something with a #.</p>');
}
var who = got[1].data || [];
var whoBox = el('asideWho');
if (whoBox) {
whoBox.innerHTML = '<h2>' + ic('users') + ' Worth following</h2>' + (who.length
? who.map(function (p) {
return '<div class="hd-aside-person" data-handle="' + esc(p.handle) + '">' +
link('@' + p.handle, avatarOf(p, 'hd-av--sm') + '<span><b>' + esc(p.name || p.handle) + '</b><i>' + H.tag(p.handle) + '</i></span>', 'hd-aside-who') +
(my ? '<button class="nb-btn nb-btn--sm nb-btn--primary" type="button" data-follow="' + p.id + '">Follow</button>' : '') +
'</div>';
}).join('') + link('explore', 'See more', 'hd-aside-more')
: '<p class="nb-muted">Nobody to suggest yet.</p>');
}
twem(aside);
}
function paintRail() {
var active = routeKey();
if (rail) rail.innerHTML = railHTML(active);
if (bar) bar.innerHTML = barHTML(active);
}
function setCard(title, line, inner, cls) {
return '<section class="nb-card hd-set-card' + (cls ? ' ' + cls : '') + '">' +
'<h2>' + esc(title) + '</h2>' +
(line ? '<p class="hd-set-line">' + esc(line) + '</p>' : '') + inner + '</section>';
}
function rosterHTML() {
var list = H.roster();
if (!list.length) return '';
return '<ul class="hd-acct-list">' + list.map(function (a) {
var who = a.name || a.handle || 'Account';
return '<li class="hd-acct' + (a.current ? ' is-on' : '') + '">' +
'<button class="hd-acct-go" type="button" data-switch="' + esc(a.id) + '"' +
(a.current ? ' disabled' : '') + '>' +
H.avatar(a, 'hd-av--sm') +
'<span class="hd-acct-who"><b>' + esc(who) + '</b>' +
'<i>' + H.tag(a.handle) + '</i></span>' +
(a.current ? '<span class="hd-acct-now">Signed in</span>' : ic('swap')) +
'</button>' +
(a.current ? '' : '<button class="nb-icon-btn hd-acct-x" type="button" data-forget="' + esc(a.id) + '" ' +
'aria-label="Remove ' + esc(who) + ' from this device">' + ic('x') + '</button>') +
'</li>';
}).join('') + '</ul>';
}
function openSettings() {
if (!my) return needAccount();
var sheet = U.sheet({
title: 'Settings',
wide: true,
html:
'<div class="hd-set" id="setBody">' +
setCard('Pictures',
'Your picture sits on every post. Your banner sits across the top of your profile.',
'<div class="hd-set-stage">' +
'<div class="hd-set-cover" id="setCover"></div>' +
'<span class="hd-set-face" id="setFace"></span>' +
'</div>' +
'<div class="hd-set-foot hd-set-foot--pics">' +
'<label class="nb-btn nb-btn--sm">Change picture' +
'<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden id="pickFace"></label>' +
'<label class="nb-btn nb-btn--sm">Change banner' +
'<input type="file" accept="image/png,image/jpeg,image/webp" hidden id="pickCover"></label>' +
'<button type="button" class="nb-btn nb-btn--ghost nb-btn--sm" id="dropCover" hidden>Remove banner</button>' +
'<span class="hd-busy" id="picBusy" hidden><span class="nb-loader nb-loader--sm"></span> Uploading</span>' +
'</div>' +
'<p class="nb-hint hd-set-hint">PNG, JPEG, WebP or GIF, up to 24 MB.</p>' +
'<p class="nb-alert nb-alert--error hd-say" id="picSay" hidden></p>') +
'<form class="nb-card hd-set-card" id="setForm">' +
'<h2>Who you are</h2>' +
'<p class="hd-set-line">Your handle is fixed. It is on every post you have already made.</p>' +
'<div class="hd-set-fields">' +
'<div class="nb-field"><span class="nb-label">Handle</span>' +
'<p class="hd-set-handle">' + H.tag(my.handle) + '</p></div>' +
'<div class="nb-field"><label class="nb-label" for="sName">Name</label>' +
'<input class="nb-input" id="sName" type="text" maxlength="50" autocomplete="name" value="' + esc(my.name || '') + '"></div>' +
'<div class="nb-field"><label class="nb-label" for="sHead">What you do</label>' +
'<input class="nb-input" id="sHead" type="text" maxlength="120" placeholder="One line, under your name on every post" value="' + esc(my.headline || '') + '">' +
'<p class="nb-hint"><span class="hd-set-count" id="cHead"></span></p></div>' +
'<div class="nb-field"><label class="nb-label" for="sBio">About you</label>' +
'<textarea class="nb-textarea" id="sBio" maxlength="400" rows="4" placeholder="A short paragraph on your profile.">' + esc(my.bio || '') + '</textarea>' +
'<p class="nb-hint"><span class="hd-set-count" id="cBio"></span></p></div>' +
'<div class="nb-field"><label class="nb-label" for="sLoc">Where you are</label>' +
'<input class="nb-input" id="sLoc" type="text" maxlength="60" placeholder="City, country" value="' + esc(my.location || '') + '"></div>' +
'<div class="nb-field"><label class="nb-label" for="sSite">Website</label>' +
'<input class="nb-input" id="sSite" type="url" maxlength="120" placeholder="https://" value="' + esc(my.website || '') + '"></div>' +
'</div>' +
'<p class="nb-alert nb-alert--error hd-say" id="setSay" hidden></p>' +
'<div class="hd-set-foot">' +
'<span class="hd-busy" id="setBusy" hidden><span class="nb-loader nb-loader--sm"></span> Saving</span>' +
'<button type="submit" class="nb-btn nb-btn--primary" id="setSave">Save changes</button>' +
'</div>' +
'</form>' +
setCard('Accounts on this device',
'Signing in another account does not sign this one out. Switching is instant and asks for nothing.',
'<div id="setRoster">' + rosterHTML() + '</div>' +
'<div class="hd-set-foot">' +
'<button type="button" class="nb-btn nb-btn--sm" id="addAcct">Add an account</button>' +
'</div>') +
setCard('Company mode',
'A company account carries a square picture, an Articles tab and associated accounts. ' +
'Turning it on files a verification request. It does not grant the badge.',
'<div class="hd-set-state" id="coState"><span class="nb-skel nb-skel--line" style="width:60%"></span></div>' +
'<div class="nb-field" id="claimField"><label class="nb-label" for="sClaim">What is this account for?</label>' +
'<textarea class="nb-textarea" id="sClaim" maxlength="400" rows="3" placeholder="The organisation, and how it can be checked."></textarea></div>' +
'<p class="nb-alert nb-alert--error hd-say" id="coSay" hidden></p>' +
'<div class="hd-set-foot">' +
'<span class="hd-busy" id="coBusy" hidden><span class="nb-loader nb-loader--sm"></span> Saving</span>' +
'<button type="button" class="nb-btn nb-btn--primary nb-btn--sm" id="coOn">Turn company mode on</button>' +
'<button type="button" class="nb-btn nb-btn--ghost nb-btn--sm" id="coOff" hidden>Turn it off</button>' +
'</div>') +
setCard('Who can open your lists',
'These are on. Turning one off closes that list to everybody but you. ' +
'Nobody is told you turned it off; the list simply will not open.',
'<div class="hd-set-checks">' +
'<label class="nb-check"><input type="checkbox" id="sShowFol"' + (my.show_follows === false ? '' : ' checked') +
'><span class="nb-box"></span><span>Followers and following</span></label>' +
'<label class="nb-check"><input type="checkbox" id="sShowAff"' + (my.show_affiliates === false ? '' : ' checked') +
'><span class="nb-box"></span><span>Associated accounts</span></label>' +
'</div>' +
'<p class="nb-alert nb-alert--error hd-say" id="prSay" hidden></p>') +
setCard('Associated accounts',
my.is_company
? 'Product accounts, regional accounts and the people who speak for this company. ' +
'An invitation only counts once the other account accepts it. You can post from an account you hold.'
: 'Companies that have asked to associate this account, and the ones it already belongs to. ' +
'Nothing appears on your profile until you accept.',
(my.is_company
? '<form class="hd-assoc-add" id="assocAdd">' +
'<div class="nb-field"><label class="nb-label" for="aHandle">Handle</label>' +
'<input class="nb-input" id="aHandle" placeholder="handle" maxlength="20" autocomplete="off"></div>' +
'<div class="nb-field"><label class="nb-label" for="aRole">Role <span class="nb-hint">optional</span></label>' +
'<input class="nb-input" id="aRole" placeholder="Chief Safety Officer" maxlength="60"></div>' +
'<div class="nb-field"><label class="nb-label" for="aKind">Kind</label>' +
'<select class="nb-select" id="aKind">' +
'<option value="person">A person who speaks for us</option>' +
'<option value="account">An account we hold</option>' +
'</select></div>' +
'<button class="nb-btn nb-btn--primary nb-btn--sm" type="submit">Invite</button>' +
'</form>'
: '') +
'<div id="assocBody">' + skeletons(2) + '</div>' +
'<p class="nb-alert nb-alert--error hd-say" id="asSay" hidden></p>') +
setCard('Signing out',
'This ends the session for this account on this device. Any other account signed in here stays. ' +
'Your Swiftaw and Fortized accounts are separate and are untouched.',
'<div class="hd-set-foot">' +
'<button type="button" class="nb-btn nb-btn--red nb-btn--sm" id="setOut">Sign out of Hereld</button>' +
'</div>', 'hd-set-card--last') +
'</div>',
wire: function (api) {
var root = api.body;
function $el(id) { return root.querySelector('#' + id); }
var picSay = $el('picSay'), picBusy = $el('picBusy');
function faces() {
$el('setFace').innerHTML = avatarOf(my, 'hd-av--lg');
$el('setCover').innerHTML = my.banner_url
? '<img src="' + esc(my.banner_url) + '" alt="Your banner">'
: '<span>No banner yet</span>';
$el('dropCover').hidden = !my.banner_url;
}
faces();
function counter(id, out, max) {
var f = $el(id), c = $el(out);
function tick() { c.textContent = f.value.length + ' / ' + max; }
f.addEventListener('input', tick);
tick();
}
counter('sHead', 'cHead', 120);
counter('sBio', 'cBio', 400);
function picFail(m) { picSay.textContent = m; picSay.hidden = false; picBusy.hidden = true; }
async function upload(file, kind) {
if (file.size > 24 * 1024 * 1024) return picFail('That picture is over 24 MB.');
picSay.hidden = true; picBusy.hidden = false;
var ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
var path = my.id + '/' + kind + '.' + ext;
var up = await db.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
if (up.error) return picFail(H.trouble(up.error, 'The picture did not upload.'));
var to = db.storage.from('avatars').getPublicUrl(path).data.publicUrl + '?t=' + Date.now();
var patch = {};
patch[kind === 'avatar' ? 'avatar_url' : 'banner_url'] = to;
var w = await db.from('profiles').update(patch).eq('id', my.id);
picBusy.hidden = true;
if (w.error) return picFail(H.trouble(w.error, 'It uploaded but did not save.'));
if (kind === 'avatar') my.avatar_url = to; else my.banner_url = to;
faces();
await H.refreshMe();
paintRail();
U.toast(kind === 'avatar' ? 'Picture changed.' : 'Banner changed.');
}
$el('pickFace').addEventListener('change', function () { if (this.files[0]) upload(this.files[0], 'avatar'); this.value = ''; });
$el('pickCover').addEventListener('change', function () { if (this.files[0]) upload(this.files[0], 'banner'); this.value = ''; });
$el('dropCover').addEventListener('click', async function () {
var sure = await U.ask({ title: 'Remove your banner', line: 'Your profile goes back to the plain header.', yes: 'Remove it' });
if (!sure) return;
picBusy.hidden = false;
var w = await db.from('profiles').update({ banner_url: null }).eq('id', my.id);
picBusy.hidden = true;
if (w.error) return picFail(H.trouble(w.error, 'That did not save.'));
my.banner_url = null;
faces();
await H.refreshMe();
U.toast('Banner removed.');
});
var say = $el('setSay'), busy = $el('setBusy'), save = $el('setSave');
function fail(m) { say.textContent = m; say.hidden = false; busy.hidden = true; save.disabled = false; }
$el('setForm').addEventListener('submit', async function (e) {
e.preventDefault();
var site = $el('sSite').value.trim();
if (site && !/^https?:\/\//i.test(site)) site = 'https://' + site;
if (site && !/^https?:\/\/[^\s.]+\.[^\s]{2,}$/i.test(site)) return fail('That does not look like a web address.');
say.hidden = true; busy.hidden = false; save.disabled = true;
var w = await db.from('profiles').update({
name: $el('sName').value.trim(),
headline: $el('sHead').value.trim(),
bio: $el('sBio').value.trim(),
location: $el('sLoc').value.trim(),
website: site
}).eq('id', my.id);
busy.hidden = true; save.disabled = false;
if (w.error) return fail(H.trouble(w.error, 'That did not save.'));
await H.refreshMe();
my = H.me() || my;
paintRail();
U.toast('Saved.');
});
$el('addAcct').addEventListener('click', function () {
location.href = url(H.joinPage + '?add=1&next=' + encodeURIComponent(here()));
});
$el('setRoster').addEventListener('click', async function (e) {
var b = e.target.closest && e.target.closest('button');
if (!b) return;
var drop = b.getAttribute('data-forget');
if (drop) {
var sure = await U.ask({ title: 'Remove this account', line: 'It comes off this device. The account itself is untouched.', yes: 'Remove it' });
if (!sure) return;
H.forget(drop);
$el('setRoster').innerHTML = rosterHTML();
twem($el('setRoster'));
return;
}
var to = b.getAttribute('data-switch');
if (!to) return;
b.disabled = true;
try {
await H.switchTo(to);
my = H.me();
api.close();
go(my && my.handle ? my.handle : 'home', true);
} catch (err) {
b.disabled = false;
U.toast((err && err.message) || 'That did not switch.', 'bad');
}
});
var coSay = $el('coSay'), coBusy = $el('coBusy');
async function paintCompany() {
var v = await db.from('verifications').select('status,note,created_at')
.eq('subject', my.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
var row = (v && !v.error && v.data) || null;
var line;
if (my.verified) line = 'Verified.';
else if (!row) line = 'No request has been filed.';
else if (row.status === 'pending') line = 'A request is with the staff. Filed ' + H.when(row.created_at) + ' ago.';
else if (row.status === 'more_info') line = 'The staff asked for more: ' + (row.note || 'no detail was given.');
else if (row.status === 'rejected') line = 'The last request was turned down' + (row.note ? ': ' + row.note : '.');
else line = 'Approved.';
$el('coState').innerHTML = '<b>' + (my.is_company ? 'Company mode is on' : 'Company mode is off') + '</b><span>' + esc(line) + '</span>';
$el('coOn').hidden = my.is_company && row && row.status === 'pending';
$el('coOn').textContent = my.is_company ? 'File a request again' : 'Turn company mode on';
$el('coOff').hidden = !my.is_company;
$el('claimField').hidden = !!my.verified;
}
paintCompany();
async function company(on) {
coSay.hidden = true; coBusy.hidden = false;
var r = await db.rpc('company_mode', { p_on: on, p_claim: $el('sClaim').value.trim() });
coBusy.hidden = true;
if (r.error) { coSay.textContent = H.trouble(r.error, 'That did not go through.'); coSay.hidden = false; return; }
my.is_company = on;
await H.refreshMe();
my = H.me() || my;
$el('setFace').innerHTML = avatarOf(my, 'hd-av--lg');
paintCompany();
paintRail();
U.toast(on ? 'Company mode on. Your request is filed.' : 'Company mode off.');
}
$el('coOn').addEventListener('click', function () {
if (!$el('sClaim').value.trim()) { coSay.textContent = 'Say what the account is for first.'; coSay.hidden = false; return; }
company(true);
});
$el('coOff').addEventListener('click', async function () {
var sure = await U.ask({ title: 'Turn company mode off', line: 'Your profile goes back to a personal one.', yes: 'Turn it off' });
if (sure) company(false);
});
var prSay = $el('prSay');
function privacy(field, box) {
box.addEventListener('change', async function () {
var patch = {}; patch[field] = box.checked;
var r = await db.from('profiles').update(patch).eq('id', my.id);
if (r.error) { box.checked = !box.checked; prSay.textContent = H.trouble(r.error, 'That did not save.'); prSay.hidden = false; return; }
prSay.hidden = true; my[field] = box.checked;
U.toast(box.checked ? 'That list is open again.' : 'That list is closed.');
});
}
privacy('show_follows', $el('sShowFol'));
privacy('show_affiliates', $el('sShowAff'));
var asSay = $el('asSay');
async function paintAssoc() {
var box = $el('assocBody');
if (!box) return;
var r = await db.from('associations')
.select('company,member,role,kind,state,' +
'co:profiles!associations_company_fkey(id,handle,name,avatar_url,verified,is_company,is_platform,is_bot),' +
'me:profiles!associations_member_fkey(id,handle,name,avatar_url,verified,is_company,is_platform,is_bot)')
.or('company.eq.' + my.id + ',member.eq.' + my.id)
.limit(100);
if (r.error) { box.innerHTML = broke(H.trouble(r.error, 'That list did not load.')); return; }
var rows = r.data || [];
if (!rows.length) {
box.innerHTML = empty('Nothing yet', my.is_company
? 'Invite an account by its handle and it appears here once accepted.'
: 'A company that wants to associate this account will show up here.');
return;
}
box.innerHTML = rows.map(function (a) {
var them = a.company === my.id ? a.me : a.co;
var theirs = a.company !== my.id;
var waiting = a.state !== 'accepted';
var note = waiting
? (theirs ? 'Wants to associate this account' : 'Invited, waiting on them')
: (a.role || (a.kind === 'account' ? 'An account you hold' : 'Associated'));
return '<div class="nb-card nb-card--tight hd-person">' +
'<a class="hd-av-btn" href="' + who(them.handle) + '" data-r aria-hidden="true" tabindex="-1">' +
avatarOf(them, 'hd-av--sm') + '</a>' +
'<div class="hd-person-txt">' + nameMark(them) +
'<i>' + H.tag(them.handle) + '</i><p>' + esc(note) + '</p></div>' +
(waiting && theirs
? '<span class="hd-person-do">' +
'<button class="nb-btn nb-btn--primary nb-btn--sm" type="button" data-assoc-yes="' + a.company + '">Accept</button>' +
'<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" data-assoc-no="' + a.company + '">Decline</button>' +
'</span>'
: '<button class="nb-btn nb-btn--red nb-btn--sm" type="button" data-assoc-end="' +
a.company + '|' + a.member + '">' + (waiting ? 'Withdraw' : 'End') + '</button>') +
'</div>';
}).join('');
twem(box);
}
paintAssoc();
$el('assocBody').addEventListener('click', async function (e) {
var b = e.target.closest && e.target.closest('button');
if (!b) return;
var yes = b.getAttribute('data-assoc-yes');
var no = b.getAttribute('data-assoc-no');
var end = b.getAttribute('data-assoc-end');
asSay.hidden = true;
b.disabled = true;
var r;
if (yes || no) {
r = await db.rpc('affiliate_answer', { p_company: yes || no, p_yes: !!yes });
} else if (end) {
var sure = await U.ask({
title: 'End this association',
line: 'The mark comes off the profile and the account stops appearing in the list.',
yes: 'End it', bad: true
});
if (!sure) { b.disabled = false; return; }
var pair = end.split('|');
r = await db.rpc('affiliate_remove', { p_company: pair[0], p_member: pair[1] });
} else { b.disabled = false; return; }
if (r.error) {
b.disabled = false;
asSay.textContent = H.trouble(r.error, 'That did not go through.');
asSay.hidden = false;
return;
}
await H.refreshMe();
my = H.me() || my;
loadHeld();
paintAssoc();
U.toast(yes ? 'Accepted.' : no ? 'Declined.' : 'Ended.');
});
if ($el('assocAdd')) {
$el('assocAdd').addEventListener('submit', async function (e) {
e.preventDefault();
var h = $el('aHandle').value.trim().toLowerCase().replace(/^@/, '');
var role = $el('aRole').value.trim();
var kind = $el('aKind').value;
if (!h) { asSay.textContent = 'Type a handle.'; asSay.hidden = false; return; }
asSay.hidden = true;
var r = await db.rpc('affiliate_invite', { p_handle: h, p_role: role, p_kind: kind });
if (r.error) { asSay.textContent = H.trouble(r.error, 'That did not go through.'); asSay.hidden = false; return; }
$el('aHandle').value = ''; $el('aRole').value = '';
paintAssoc();
U.toast('Invitation sent. It counts once they accept.');
});
}
$el('setOut').addEventListener('click', async function () {
var sure = await U.ask({ title: 'Sign out', line: 'You can sign back in at any time.', yes: 'Sign out', bad: true });
if (!sure) return;
H.signOut();
});
twem(root);
}
});
}
var RESERVED = ['home', 'explore', 'search', 'notifications', 'bookmarks', 'supernova',
'profile', 'settings', 'staff', 'join', 'index', 'post', 'article', 'company', '404'];
function parts() { return here().split('/').filter(Boolean); }
function routeKey() {
var s = parts();
if (!s.length || s[0] === 'index') return 'home';
if (NAV.some(function (n) { return n.path === s[0]; })) return s[0];
if (s[0] === 'staff') return 'staff';
if (my && s[0] === my.handle) return 'me';
return s[0] || 'home';
}
async function render() {
painting++;
U.shutMenu();
var s = parts();
paintRail();
document.body.classList.toggle('hd-wide', s[0] === 'staff');
document.body.classList.toggle('hd-ex', s[0] === 'explore');
var first = s[0] || 'home';
if (first === 'index' || first === 'home' || !first) { setTitle('Home'); return viewHome(); }
if (first === 'explore') { setTitle('Explore'); return viewExplore(); }
if (first === 'search') { setTitle('Search'); return viewSearch(); }
if (first === 'notifications') { setTitle('Notifications'); return viewNotifications(); }
if (first === 'bookmarks') { setTitle('Bookmarks'); return viewBookmarks(); }
if (first === 'supernova') { setTitle('Ask Supernova'); return viewSupernova(); }
if (first === 'profile') {
if (!my) return needAccount();
return go('@' + my.handle, true);
}
if (first === 'settings') { setTitle('Settings'); return openSettings(); }
if (first === 'staff') {
setTitle('Staff console');
if (window.HStaff) return window.HStaff.render(col, { db: db, my: my, role: staffRole, go: go, url: url });
col.innerHTML = '<div class="hd-load"><span class="nb-loader"></span></div>';
return loadStaff();
}
if (first === 'post' && s[1]) { setTitle('Post'); return viewThread(s[1]); }
if (first === 'article' && s[1]) { setTitle('Article'); return viewArticle(s[1]); }
if (first === 'company' && s[1]) { setTitle('@' + s[1]); return viewProfile(s[1], s[2]); }
if (/^@[a-z0-9_]{3,20}$/.test(first)) {
setTitle(first);
return viewProfile(first.slice(1), s[1]);
}
if (/^[a-z0-9_]{3,20}$/.test(first) && RESERVED.indexOf(first) < 0) {
return go('@' + first + (s[1] ? '/' + s[1] : ''), true);
}
setTitle('Not found');
col.innerHTML = notFoundHTML();
}
function setTitle(t) { document.title = t + ' - Hereld'; }
function loadStaff() {
var s = document.createElement('script');
s.src = url('css/hereld-staff.js?v=1');
s.onload = function () { render(); };
s.onerror = function () { col.innerHTML = broke('The staff console could not be loaded.'); };
document.head.appendChild(s);
}
function wire() {
document.addEventListener('click', function (e) {
var a = e.target.closest && e.target.closest('a[data-r]');
if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && a.target !== '_blank') {
e.preventDefault();
var to = a.getAttribute('href');
if (to === location.pathname + location.search) return;
history.pushState({}, '', to);
render();
window.scrollTo(0, 0);
return;
}
var b = e.target.closest && e.target.closest('button');
if (!b && !(e.target.closest && e.target.closest('a, input, textarea, video, label'))) {
var opener = e.target.closest && e.target.closest('[data-open]');
if (opener) {
if (!window.getSelection || String(window.getSelection()) === '') {
go('post/' + opener.getAttribute('data-open'));
}
return;
}
}
if (!b) return;
if (b.hasAttribute('data-back')) { history.length > 1 ? history.back() : go('home'); return; }
if (b.hasAttribute('data-retry')) { render(); return; }
if (b.hasAttribute('data-reveal')) {
var hid = b.closest('.hd-spoiler');
if (hid) hid.classList.add('is-revealed');
return;
}
var shot = b.getAttribute('data-shot');
if (shot) {
var box = b.closest('.hd-shots');
var all = box ? [].slice.call(box.querySelectorAll('[data-shot]')).map(function (n) {
return n.getAttribute('data-shot');
}) : [shot];
U.look(all, +(b.getAttribute('data-shot-i') || 0), 'Picture');
return;
}
var face = b.getAttribute('data-face');
if (face !== null && b.classList.contains('hd-av-btn')) {
if (face) U.look([face], 0, 'Profile picture');
return;
}
var cover = b.getAttribute('data-cover');
if (cover) { U.look([cover], 0, 'Banner'); return; }
var answer = b.getAttribute('data-answer');
if (answer !== null) {
var box = b.closest('[data-pollof]');
if (!my) return U.toast('Sign in to answer.');
if (box) answerPoll(box, box.getAttribute('data-pollof'), Number(answer));
return;
}
var listKind = b.getAttribute('data-list');
if (listKind) {
return listCard(listKind, b.getAttribute('data-list-of'), b.getAttribute('data-list-who'));
}
var noteOn = b.getAttribute('data-note');
if (noteOn) return askNote(noteOn);
var doing = b.getAttribute('data-do');
if (doing === 'like') return like(b);
if (doing === 'relay') return relay(b);
if (doing === 'save') return save(b);
if (doing === 'share') return share(b);
if (doing === 'more') return moreMenu(b);
if (doing === 'views') {
var n = b.querySelector('.hd-act-n');
return U.toast((n && n.textContent ? n.textContent : '0') + ' people have seen this post.');
}
if (doing === 'nova') return novaOnPost(b);
if (doing === 'reply') {
var id = b.closest('[data-post]').getAttribute('data-post');
var who = b.closest('[data-post]').getAttribute('data-author');
if (needAccount()) return;
openComposer({ title: 'Reply', replyTo: id, toHandle: who, label: 'Reply', after: function () { render(); } });
return;
}
var undo = b.getAttribute('data-undo');
if (undo) {
db.from('hidden_posts').delete().eq('user_id', my.id).eq('post_id', undo).then(function () { render(); });
return;
}
if (b.closest('[data-settings]')) { openSettings(); return; }
var fid = b.getAttribute('data-follow');
if (fid) {
var on = b.textContent.trim() === 'Follow';
b.disabled = true;
follow(fid, on).then(function (ok) {
b.disabled = false;
if (!ok) return;
b.textContent = on ? 'Following' : 'Follow';
b.className = 'nb-btn nb-btn--sm ' + (on ? 'nb-btn--ghost' : 'nb-btn--primary');
});
return;
}
var ub = b.getAttribute('data-unblock');
if (ub) {
db.from('blocks').delete().eq('blocker', my.id).eq('blocked', ub).then(function () {
U.toast('Unblocked.'); render();
});
return;
}
var pm = b.getAttribute('data-pmore');
if (pm) return profileMenu(b, pm);
if (b.id === 'writeBtn' || b.id === 'writeFab' || b.id === 'firstPost') {
if (needAccount()) return;
openComposer({ after: function () { render(); } });
return;
}
if (b.id === 'meChip') return meMenu(b);
if (b.id === 'readAll') {
db.rpc('notes_read_all').then(function () {
unread = 0; paintRail();
document.querySelectorAll('.hd-note.is-new').forEach(function (n) { n.classList.remove('is-new'); });
U.toast('All caught up.');
});
return;
}
});
document.addEventListener('submit', function (e) {
var f = e.target;
if (f.id === 'exSearch' || f.id === 'asideSearch') {
e.preventDefault();
var q = f.querySelector('input').value.trim();
if (q) go('search?q=' + encodeURIComponent(q));
}
});
document.addEventListener('keydown', function (e) {
if (e.key !== 'Enter') return;
var o = e.target.closest && e.target.closest('[data-open][tabindex]');
if (o && e.target === o) { e.preventDefault(); go('post/' + o.getAttribute('data-open')); }
});
window.addEventListener('popstate', function () { render(); });
document.addEventListener('keydown', function (e) {
if (e.key === '/' && !/input|textarea/i.test((e.target.tagName || ''))) {
var box = document.querySelector('#asideSearch input, #exSearch input');
if (box) { e.preventDefault(); box.focus(); }
}
});
}
async function profileMenu(btn, handle) {
var p = await person(handle);
if (!p) return;
var isMe = my && my.id === p.id;
var items = [
{ label: 'Copy link to profile', ic: 'link', run: function () { U.copy(location.origin + who(p.handle), 'Link copied.'); } }
];
if (!isMe) {
items.push({ label: 'Summarise profile', ic: 'sparkle', run: function () { openProfileSummary(p); } });
items.push({ label: 'Mute @' + p.handle, ic: 'mute', run: function () { mutePerson(p); } });
items.push({ label: 'Block @' + p.handle, ic: 'ban', kind: 'bad', run: function () { blockPerson(p); } });
items.push('rule');
items.push({ label: 'Report account', ic: 'flag', kind: 'bad', run: function () { report({ kind: 'profile', subject: p.id }); } });
}
if (staffRole) {
items.push('rule');
items.push({ label: 'Open in staff console', ic: 'shield', run: function () { go('staff?user=' + p.handle); } });
}
U.menu(btn, items);
}
function meMenu(btn) {
var items = [
{ label: 'Your profile', ic: 'user', run: function () { go('@' + my.handle); } },
{ label: 'Settings', ic: 'gear', run: function () { openSettings(); } },
{ label: 'Bookmarks', ic: 'bookmark', run: function () { go('bookmarks'); } }
];
var others = H.roster().filter(function (a) { return !a.current; });
if (others.length) {
items.push('rule');
others.slice(0, 4).forEach(function (a) {
items.push({
label: (a.name || a.handle) + ' @' + a.handle,
ic: 'swap',
run: async function () {
try {
await H.switchTo(a.id);
my = H.me();
U.toast('Switched to ' + ((my && (my.name || my.handle)) || a.handle) + '.');
go(my && my.handle ? my.handle : 'home', true);
} catch (err) {
U.toast((err && err.message) || 'That did not switch.', 'bad');
}
}
});
});
}
items.push('rule');
items.push({ label: 'Add an account', ic: 'plus', run: function () {
location.href = url(H.joinPage + '?add=1&next=' + encodeURIComponent(here()));
} });
items.push({ label: 'Sign out', ic: 'out', kind: 'bad', run: async function () {
var next = await H.signOut();
if (next) { my = next; go(next.handle, true); U.toast('Signed out. You are on ' + (next.name || next.handle) + ' now.'); }
else location.href = url('');
} });
U.menu(btn, items);
}
async function countNotes() {
if (!my) return;
var r = await db.from('notifications').select('id', { count: 'exact', head: true })
.eq('user_id', my.id).is('read_at', null);
unread = r.count || 0;
}
async function whoAmIOnStaff() {
if (!my) return;
var r = await db.rpc('staff_role');
staffRole = (r && !r.error && r.data) || null;
if (!staffRole) {
var b = await db.rpc('bootstrap_staff');
if (b && !b.error && b.data === 'superadmin') staffRole = 'superadmin';
}
}
var SPLASH_HOLD = 2300;
function splashOff() {
var s = el('splash');
if (!s) return;
var up = window.__hdSplashAt || 0;
var wait = up ? Math.max(0, SPLASH_HOLD - (Date.now() - up)) : 0;
setTimeout(function () {
s.classList.add('is-done');
setTimeout(function () { s.remove(); }, 620);
}, wait);
}
function shell() {
var lift = el('splash');
document.body.classList.add('hd-app');
document.body.innerHTML =
'<a class="nb-skip" href="#col">Skip to the content</a>' +
'<div class="hd-shell">' +
'<aside class="hd-rail" id="rail"></aside>' +
'<main class="hd-col" id="col" tabindex="-1"></main>' +
'<aside class="hd-aside" id="aside"></aside>' +
'</div>' +
'<nav class="hd-bar" id="bar" aria-label="Hereld"></nav>';
if (lift) document.body.appendChild(lift);
col = el('col'); aside = el('aside'); rail = el('rail'); bar = el('bar');
}
H.ready(async function () {
db = H.db();
if (!db) {
document.body.innerHTML =
'<div class="hd-boot-bad"><div class="nb-card nb-card--lg">' +
'<h1>Hereld could not be reached</h1>' +
'<p>Something between you and Hereld is not answering. Check your ' +
'connection and try again.</p>' +
'<button class="nb-btn nb-btn--primary" id="bootRetry">Reload</button>' +
'</div></div>';
var retry = el('bootRetry');
if (retry) retry.addEventListener('click', function () { location.reload(); });
splashOff();
return;
}
my = H.me();
if (H.user() && !my) {
location.replace(url('join'));
return;
}
shell();
wire();
wireCards();
await Promise.all([countNotes(), whoAmIOnStaff(), loadHeld()]);
await render();
paintAside();
splashOff();
twem(document.body);
H.onChange(function (u, profile) {
my = profile;
paintRail();
});
});
})();
