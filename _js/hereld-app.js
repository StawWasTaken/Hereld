/* Hereld, the application.

   One shell, real paths, and every control on a post wired to something that
   actually happens in the database. Nothing here draws a button it cannot
   honour.
*/
(function () {
  'use strict';

  var H = window.Hereld, U = window.HU;
  var db = null, me = null, my = null;
  var el = function (id) { return document.getElementById(id); };
  var esc = U.esc, ic = U.icon;

  var MAX = 600;
  var TWEMOJI = 'https://cdn.jsdelivr.net/npm/@twemoji/api@15.1.0/dist/twemoji.min.js';
  var TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/';

  var WITH_AUTHOR = '*, author:profiles!posts_author_fkey(id,handle,name,headline,avatar_url,verified,is_company,is_platform,is_bot,banned)';

  /* What I have already done, so the buttons come up in the right state
     without one query per post. */
  var mine = { endorsed: {}, relayed: {}, saved: {}, following: {} };
  var staffRole = null;

  /* ── Emoji ───────────────────────────────────────────────────────────────
     Twemoji, like the rest of Swiftaw, so a face looks the same on every
     machine. If the script does not arrive the native glyph stays, which is
     worse looking and still readable. */

  var twemojiAsked = false;
  function twem(node) {
    if (!node) return;
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

  /* ── Paths ───────────────────────────────────────────────────────────────
     Everything is a real path. The base is worked out once so the same build
     runs under a project folder today and at a domain root later. */

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

  /* ── Writing ─────────────────────────────────────────────────────────────
     Escape first, then find the things worth linking inside the escaped text.
     Doing it the other way round is how a post ends up running as markup. */

  function body(text) {
    var out = esc(text || '');
    out = out.replace(/\bhttps?:\/\/[^\s<]+/g, function (u) {
      var trim = u.replace(/[.,;:!?)\]]+$/, '');
      var tail = u.slice(trim.length);
      return '<a href="' + trim + '" target="_blank" rel="noopener nofollow">' +
             esc(trim.replace(/^https?:\/\/(www\.)?/, '')) + '</a>' + tail;
    });
    out = out.replace(/(^|[\s(])@([a-z0-9_]{3,20})\b/gi, function (m, pre, h) {
      return pre + '<a href="' + url(h.toLowerCase()) + '" data-r class="hd-mention">' +
             H.at() + esc(h) + '</a>';
    });
    out = out.replace(/(^|[\s(])#([a-z0-9_]{2,30})\b/gi, function (m, pre, t) {
      return pre + '<a href="' + url('search?q=' + encodeURIComponent('#' + t)) + '" data-r class="hd-tag-link">#' + esc(t) + '</a>';
    });
    return out.replace(/\n/g, '<br>');
  }

  function num(n) {
    n = Number(n || 0);
    if (n < 1000) return String(n);
    if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'K';
    return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }

  /* ── People ─────────────────────────────────────────────────────────────── */

  function badges(p) {
    var out = '';
    if (p.is_platform) out += '<span class="hd-badge hd-badge--plat" title="Official Hereld account">' + ic('shield') + '</span>';
    else if (p.verified) out += '<span class="hd-badge hd-badge--ver" title="Verified company">' + ic('tick') + '</span>';
    if (p.is_bot) out += '<span class="hd-badge hd-badge--bot" title="Automated account">' + ic('robot') + '<span class="nb-sr">Automated account</span></span>';
    return out;
  }

  function avatarOf(p, cls) {
    return H.avatar(p, (cls || '') + (p && p.is_company ? ' hd-av--sq' : ''));
  }

  function nameLine(p, stamp, extra) {
    return '<span class="hd-who">' +
      link(p.handle, '<b>' + esc(p.name || p.handle) + '</b>', 'hd-who-name') + badges(p) +
      '<span class="hd-who-at">' + H.tag(p.handle) + '</span>' +
      (stamp ? '<span class="hd-dot">·</span><span class="hd-when">' + esc(stamp) + '</span>' : '') +
      (extra || '') + '</span>';
  }

  /* ── The action bar ──────────────────────────────────────────────────────
     Reply, relay, endorse, views, save, share, Supernova, more. Every count
     is a real column and every control writes a real row. */

  function act(kind, ico, label, count, on, extra) {
    return '<button class="hd-act hd-act--' + kind + (on ? ' is-on' : '') + '" type="button" ' +
      (extra || '') + ' aria-label="' + esc(label) + '" data-tip="' + esc(label) + '">' +
      ic(ico) + '<span class="hd-act-n">' + (count == null ? '' : num(count)) + '</span></button>';
  }

  function acts(p) {
    /* The author column and the embedded author row share the name "author",
       and the embed wins in the JSON. Read the id off the object. */
    var owned = !!(my && p.author && p.author.id === my.id);
    var supernovaAsk = 'https://swiftaw.com/supernova/chat?q=' +
      encodeURIComponent('Explain this Hereld post in plain language:\n\n' + (p.body || ''));

    return '<div class="hd-acts" data-id="' + p.id + '">' +
      act('reply',  'comment',  'Reply',   p.reply_count,   false, 'data-do="reply"') +
      act('relay',  'relay',    'Relay',   p.relay_count,   mine.relayed[p.id],  'data-do="relay"') +
      act('endorse','heart',    'Endorse', p.endorse_count, mine.endorsed[p.id], 'data-do="endorse"') +
      act('views',  'chart',    'Views',   p.view_count,    false, 'data-do="views"') +
      act('save',   'bookmark', mine.saved[p.id] ? 'Saved' : 'Save', null, mine.saved[p.id], 'data-do="save"') +
      act('share',  'share',    'Share',   null, false, 'data-do="share"') +
      '<button class="hd-act hd-act--nova" type="button" data-do="nova" data-href="' + esc(supernovaAsk) + '" ' +
        'aria-label="Ask Supernova about this" data-tip="Ask Supernova">' +
        '<img src="' + url('Supernova%20mark.png') + '" alt="" width="18" height="18"></button>' +
      '<button class="hd-act hd-act--more" type="button" data-do="more" data-own="' + (owned ? '1' : '') + '" ' +
        'aria-haspopup="menu" aria-expanded="false" aria-label="More" data-tip="More">' + ic('more') + '</button>' +
    '</div>';
  }

  /* ── A post ─────────────────────────────────────────────────────────────── */

  function card(p, o) {
    o = o || {};
    var a = p.author || {};
    var lead = '';

    if (p.relayed_by) {
      lead = '<div class="hd-lead">' + ic('relay') +
        link(p.relayed_by.handle, esc(p.relayed_by.name || p.relayed_by.handle)) + ' relayed this</div>';
    }

    var note = p.note ? '<div class="hd-cnote">' +
      '<b>' + ic('info') + ' Community note</b><p>' + body(p.note.body) + '</p>' +
      (p.note.source ? '<a href="' + esc(p.note.source) + '" target="_blank" rel="noopener nofollow">Source</a>' : '') +
      '</div>' : '';

    var quoted = p.quote ? '<div class="hd-quote">' +
      '<div class="hd-quote-top">' + avatarOf(p.quote.author, 'hd-av--xs') +
      nameLine(p.quote.author, H.when(p.quote.created_at)) + '</div>' +
      '<p>' + body(p.quote.body) + '</p></div>' : '';

    return '<article class="nb-card hd-post' + (o.lead ? ' hd-post--lead' : '') + '" data-post="' + p.id + '" data-author="' + esc(a.handle || '') + '">' +
      lead +
      '<div class="hd-post-top">' +
        '<button class="hd-av-btn" type="button" data-face="' + esc(a.avatar_url || '') + '" data-who="' + esc(a.handle || '') + '">' +
          avatarOf(a) + '</button>' +
        '<div class="hd-post-who">' + nameLine(a, H.when(p.created_at)) +
          (a.headline ? '<i class="hd-head">' + esc(a.headline) + '</i>' : '') +
        '</div>' +
      '</div>' +
      (p.body ? '<p class="hd-post-body">' + body(p.body) + '</p>' : '') +
      quoted + note + acts(p) +
    '</article>';
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

  /* ── Reading a batch ────────────────────────────────────────────────────── */

  async function markMine(rows) {
    if (!my || !rows.length) return;
    var ids = rows.map(function (p) { return p.id; });
    var got = await Promise.all([
      db.from('endorsements').select('post_id').eq('user_id', my.id).in('post_id', ids),
      db.from('posts').select('relay_of').eq('author', my.id).in('relay_of', ids),
      db.from('bookmarks').select('post_id').eq('user_id', my.id).in('post_id', ids)
    ]);
    (got[0].data || []).forEach(function (r) { mine.endorsed[r.post_id] = true; });
    (got[1].data || []).forEach(function (r) { mine.relayed[r.relay_of] = true; });
    (got[2].data || []).forEach(function (r) { mine.saved[r.post_id] = true; });
  }

  /* A relay carries the post it points at. Two round trips instead of a
     nested embed through a function, because a nested embed can quietly come
     back null and take the whole row with it. */
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
    var r = await db.from('community_notes').select('post_id,body,source')
      .in('post_id', ids).eq('status', 'published');
    var by = {};
    (r.data || []).forEach(function (n) { if (!by[n.post_id]) by[n.post_id] = n; });
    rows.forEach(function (p) { if (by[p.id]) p.note = by[p.id]; });
    return rows;
  }

  async function hydrate(rows) {
    rows = rows || [];
    rows = await attachRelays(rows);
    await attachNotes(rows);
    await markMine(rows);
    return rows;
  }

  /* ── Views ───────────────────────────────────────────────────────────────
     Counted when a post is actually on screen for a moment, batched, and only
     once per person per post. The server does the deduplicating. */

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

  /* ── The shell ──────────────────────────────────────────────────────────── */

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
        ? '<img src="' + url('Supernova%20mark.png') + '" alt="" width="21" height="21">'
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

  /* ── The composer ────────────────────────────────────────────────────────
     One implementation, used inline at the top of the feed and inside the
     dialog the Post button opens. */

  var composeSeq = 0;

  function composerHTML(o) {
    o = o || {};
    var id = 'c' + (++composeSeq);
    return '<form class="hd-compose" data-c="' + id + '">' +
      (o.replyTo ? '<p class="hd-compose-to">Replying to ' + H.tag(esc(o.toHandle || '')) + '</p>' : '') +
      '<div class="hd-compose-row">' + avatarOf(my) +
        '<textarea class="hd-compose-in" rows="' + (o.rows || 2) + '" maxlength="' + MAX + '" ' +
          'placeholder="' + esc(o.placeholder || 'What is worth saying?') + '"></textarea>' +
      '</div>' +
      '<div class="hd-compose-media" hidden></div>' +
      '<div class="hd-compose-foot">' +
        '<div class="hd-compose-tools">' +
          '<label class="nb-icon-btn hd-compose-tool" data-tip="Add a picture">' + ic('image') +
            '<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden data-pic>' +
            '<span class="nb-sr">Add a picture</span></label>' +
          '<button class="nb-icon-btn hd-compose-tool" type="button" data-tag data-tip="Add a topic">' + ic('hash') + '</button>' +
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
    var media = null;
    var busy = false;

    function grow() {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 320) + 'px';
    }

    function tick() {
      var left = MAX - ta.value.length;
      count.textContent = left;
      count.classList.toggle('is-low', left <= 60);
      count.classList.toggle('is-over', left < 0);
      go.disabled = busy || left < 0 || (!ta.value.trim() && !media);
      grow();
    }

    ta.addEventListener('input', tick);
    ta.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') form.requestSubmit();
    });

    form.querySelector('[data-tag]').addEventListener('click', function () {
      var at = ta.selectionStart;
      ta.setRangeText('#', at, at, 'end');
      ta.focus(); tick();
    });

    pic.addEventListener('change', function () {
      var f = pic.files && pic.files[0];
      pic.value = '';
      if (!f) return;
      if (f.size > 4 * 1024 * 1024) return warn('That picture is over 4 MB. Try a smaller one.');
      media = f;
      var read = new FileReader();
      read.onload = function () {
        tray.hidden = false;
        tray.innerHTML = '<figure class="hd-compose-pic"><img src="' + read.result + '" alt="">' +
          '<button class="nb-icon-btn nb-icon-btn--round" type="button" data-drop aria-label="Remove picture">' + ic('x') + '</button>' +
          '<span class="hd-compose-bar" data-bar hidden><i></i></span></figure>';
        tray.querySelector('[data-drop]').addEventListener('click', function () {
          media = null; tray.hidden = true; tray.innerHTML = ''; tick();
        });
        tick();
      };
      read.readAsDataURL(f);
    });

    function warn(m) { say.hidden = false; say.textContent = m; say.className = 'hd-compose-say is-bad'; }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (busy) return;
      var text = ta.value.trim();
      if (!text && !media) return;
      busy = true; go.disabled = true; say.hidden = true;
      go.innerHTML = '<span class="nb-loader nb-loader--sm"></span> Posting';

      try {
        if (media) {
          var bar = tray.querySelector('[data-bar]');
          if (bar) bar.hidden = false;
          var path = my.id + '/' + Date.now() + '-' + media.name.replace(/[^a-zA-Z0-9._-]/g, '');
          var up = await db.storage.from('avatars').upload(path, media, { upsert: true });
          if (up.error) throw up.error;
          var pub = db.storage.from('avatars').getPublicUrl(path);
          text = (text ? text + '\n' : '') + pub.data.publicUrl;
        }

        var row = { author: my.id, body: text };
        if (o.replyTo) row.reply_to = o.replyTo;
        if (o.quoteOf) row.relay_of = o.quoteOf;

        var r = await db.from('posts').insert(row).select(WITH_AUTHOR).single();
        if (r.error) throw r.error;

        ta.value = ''; media = null; tray.hidden = true; tray.innerHTML = '';
        tick();
        U.toast(o.replyTo ? 'Reply posted.' : 'Posted.');
        if (o.after) o.after(r.data);
      } catch (err) {
        var m = String((err && err.message) || '');
        if (/may_post|row-level security/i.test(m)) warn('Your account cannot post right now.');
        else warn(H.trouble(err, 'That did not post.'));
      }
      busy = false;
      go.textContent = o.label || 'Post';
      tick();
    });

    tick();
    return { focus: function () { ta.focus(); } };
  }

  function openComposer(o) {
    o = o || {};
    var s = U.sheet({
      title: o.title || 'New post',
      tools: '',
      html: composerHTML(Object.assign({ rows: 4, placeholder: 'What is worth saying?' }, o)),
      wire: function (api) {
        var c = wireComposer(api.q('.hd-compose'), Object.assign({}, o, {
          after: function (row) { api.close(); if (o.after) o.after(row); }
        }));
        setTimeout(c.focus, 60);
      }
    });
    return s;
  }

  /* ── Acting on a post ───────────────────────────────────────────────────── */

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

  async function endorse(btn) {
    if (needAccount()) return;
    var id = btn.closest('[data-post]').getAttribute('data-post');
    var on = btn.classList.toggle('is-on');
    bump(btn, on ? 1 : -1);
    mine.endorsed[id] = on;
    var r = on
      ? await db.from('endorsements').insert({ user_id: my.id, post_id: id })
      : await db.from('endorsements').delete().eq('user_id', my.id).eq('post_id', id);
    if (r.error) {
      /* Put it back rather than leave a number that never happened. */
      btn.classList.toggle('is-on', !on);
      bump(btn, on ? -1 : 1);
      mine.endorsed[id] = !on;
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

  function askNote(id) {
    if (needAccount()) return;
    U.sheet({
      title: 'Request a community note',
      html:
        '<p class="hd-ask-line">Community notes add missing context to a post. Anyone can ask for one, anyone can write one, and the Hereld team publishes the ones that hold up.</p>' +
        '<div class="nb-field"><label class="nb-label" for="nq">What is missing?</label>' +
        '<textarea class="nb-input" id="nq" rows="3" maxlength="300" data-focus placeholder="Say what a reader would need to know."></textarea></div>' +
        '<div class="hd-ask-foot"><button class="nb-btn nb-btn--ghost" type="button" data-no>Cancel</button>' +
        '<button class="nb-btn nb-btn--primary" type="button" data-yes>Request a note</button></div>',
      wire: function (api) {
        api.q('[data-no]').addEventListener('click', api.close);
        api.q('[data-yes]').addEventListener('click', async function () {
          var r = await db.from('note_requests').insert({
            post_id: id, user_id: my.id, reason: api.q('#nq').value.trim()
          });
          api.close();
          if (r.error && /duplicate|unique/i.test(r.error.message || '')) {
            return U.toast('You have already asked for a note on this post.');
          }
          if (r.error) return U.toast(H.trouble(r.error, 'That did not send.'), 'bad');
          U.toast('Noted. A note will appear if one is published.');
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
    /* Muting is a block that says nothing about the reasons. It uses the same
       row, and the copy is the only difference. */
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
    items.push({ label: 'Request community note', ic: 'info', run: function () { askNote(id); } });
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
  async function person(handle) {
    if (peopleCache[handle]) return peopleCache[handle];
    var r = await db.from('profiles').select('*').eq('handle', String(handle).toLowerCase()).maybeSingle();
    if (r.error || !r.data) { U.toast('That account could not be found.', 'bad'); return null; }
    peopleCache[handle] = r.data;
    return r.data;
  }

  /* ── Views ─────────────────────────────────────────────────────────────── */

  var col, aside, rail, bar;
  var painting = 0;

  async function viewHome() {
    col.innerHTML = head('Home', '') +
      (my ? '<div class="nb-card hd-compose-card">' + composerHTML({}) + '</div>' : '') +
      '<div class="hd-feed" id="feed">' + skeletons(4) + '</div>';

    if (my) {
      wireComposer(col.querySelector('.hd-compose'), {
        after: function () { viewHome(); }
      });
    }

    var token = painting;
    var r = await db.rpc('feed', { p_limit: 25 }).select(WITH_AUTHOR);
    if (token !== painting) return;
    var feed = el('feed');
    if (!feed) return;

    if (r.error) { feed.innerHTML = broke(H.trouble(r.error, '')); return; }
    var rows = await hydrate(r.data || []);
    if (token !== painting) return;

    feed.innerHTML = rows.length ? feedHTML(rows)
      : empty('Quiet so far', my ? 'Follow a few people, or say the first thing.' : 'Nothing has been posted yet.',
          my ? '<button class="nb-btn nb-btn--primary nb-btn--sm" type="button" id="firstPost">' + ic('quill') + ' Write a post</button>' : '');
    twem(feed);
    watchViews(feed);
  }

  async function viewExplore() {
    col.innerHTML = head('Explore', 'What Hereld is talking about.') +
      '<form class="hd-searchbar" id="exSearch">' +
        '<span class="hd-searchbar-ic">' + ic('search') + '</span>' +
        '<input class="nb-input" type="search" name="q" placeholder="Search posts, people and topics" aria-label="Search">' +
      '</form>' +
      '<section class="hd-block"><h2 class="hd-block-h">' + ic('hash') + ' The Horn Line</h2>' +
        '<div class="hd-chips" id="exTags">' + skeletons(0) + '<span class="nb-skel nb-skel--line" style="width:60%"></span></div></section>' +
      '<section class="hd-block"><h2 class="hd-block-h">' + ic('users') + ' Worth following</h2>' +
        '<div class="hd-list" id="exWho"></div></section>' +
      '<section class="hd-block"><h2 class="hd-block-h">' + ic('quill') + ' Latest</h2>' +
        '<div class="hd-feed" id="feed">' + skeletons(3) + '</div></section>';

    var token = painting;
    var got = await Promise.all([
      db.rpc('horn_line', { p_limit: 12 }),
      db.rpc('who_to_follow', { p_limit: 6 }),
      db.from('posts').select(WITH_AUTHOR).is('reply_to', null).order('created_at', { ascending: false }).limit(15)
    ]);
    if (token !== painting) return;

    var tags = got[0].data || [];
    el('exTags').innerHTML = tags.length
      ? tags.map(function (t) {
          return link('search?q=' + encodeURIComponent('#' + t.tag),
            '<b>#' + esc(t.tag) + '</b><i>' + t.posts + ' post' + (t.posts === 1 ? '' : 's') +
            ' · ' + t.people + ' ' + (t.people === 1 ? 'person' : 'people') + '</i>', 'hd-chip');
        }).join('')
      : '<p class="nb-muted">No topics yet. Put a # in a post and it starts one.</p>';

    el('exWho').innerHTML = (got[1].data || []).length
      ? (got[1].data).map(personRow).join('')
      : '<p class="nb-muted">Nobody to suggest yet.</p>';

    var feed = el('feed');
    if (got[2].error) { feed.innerHTML = broke(); return; }
    var rows = await hydrate(got[2].data || []);
    if (token !== painting) return;
    feed.innerHTML = rows.length ? feedHTML(rows) : empty('Nothing yet', 'The first post has not been written.');
    twem(col);
    watchViews(feed);
  }

  function personRow(p) {
    var on = mine.following[p.handle];
    return '<div class="nb-card nb-card--tight hd-person" data-person="' + p.id + '" data-handle="' + esc(p.handle) + '">' +
      '<button class="hd-av-btn" type="button" data-face="' + esc(p.avatar_url || '') + '">' + avatarOf(p, 'hd-av--sm') + '</button>' +
      '<div class="hd-person-txt">' + link(p.handle, '<b>' + esc(p.name || p.handle) + '</b>' + badges(p)) +
        '<i>' + H.tag(p.handle) + '</i>' +
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

    var people = got[0].data || [];
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
    endorse: 'endorsed your post',
    relay: 'relayed your post',
    reply: 'replied to you',
    follow: 'started following you',
    mention: 'mentioned you',
    verify: 'ruled on your verification request',
    staff: 'sent you a message from the Hereld team',
    note: 'published a community note'
  };

  async function viewNotifications() {
    if (!my) return needAccount();
    col.innerHTML = head('Notifications', '', {
      tools: '<button class="nb-btn nb-btn--ghost nb-btn--sm" type="button" id="readAll">' + ic('check') + ' Mark all read</button>'
    }) + '<div class="hd-list" id="notes">' + skeletons(4) + '</div>';

    var token = painting;
    var r = await db.from('notifications')
      .select('*, actor:profiles!notifications_actor_fkey(id,handle,name,avatar_url,verified,is_company,is_platform,is_bot)')
      .eq('user_id', my.id).order('created_at', { ascending: false }).limit(60);
    if (token !== painting) return;

    var host = el('notes');
    if (r.error) { host.innerHTML = broke(H.trouble(r.error, '')); return; }
    var rows = r.data || [];

    var quotes = {};
    var ids = rows.filter(function (n) { return n.post_id; }).map(function (n) { return n.post_id; });
    if (ids.length) {
      var q = await db.from('posts').select('id,body').in('id', ids);
      (q.data || []).forEach(function (p) { quotes[p.id] = p.body; });
    }
    if (token !== painting) return;

    host.innerHTML = rows.length ? rows.map(function (n) {
      var a = n.actor || {};
      var text = NOTE_WORDS[n.kind] || 'did something';
      var to = n.post_id ? 'post/' + n.post_id : (a.handle || 'home');
      return '<a class="nb-card nb-card--tight hd-note' + (n.read_at ? '' : ' is-new') + '" href="' + url(to) + '" data-r>' +
        '<span class="hd-note-ic" data-k="' + esc(n.kind) + '">' +
          ic(n.kind === 'endorse' ? 'heart' : n.kind === 'relay' ? 'relay' : n.kind === 'follow' ? 'follow'
             : n.kind === 'mention' ? 'quill' : n.kind === 'verify' ? 'tick' : 'comment') + '</span>' +
        '<span class="hd-note-txt"><p><b>' + esc(a.name || a.handle || 'Someone') + '</b> ' + esc(text) + '</p>' +
        (quotes[n.post_id] ? '<p class="hd-note-quote">' + esc(String(quotes[n.post_id]).slice(0, 160)) + '</p>' : '') +
        '<span class="hd-note-when">' + esc(H.when(n.created_at)) + '</span></span></a>';
    }).join('') : empty('Nothing yet', 'Endorsements, relays, replies and follows land here.');

    twem(host);
    if (unread) {
      await db.rpc('notes_read_all');
      unread = 0;
      paintRail();
    }
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
      p.is_company ? db.from('associations').select('member:profiles!associations_member_fkey(handle,name,avatar_url,verified,is_company)')
        .eq('company', p.id).eq('state', 'accepted').limit(12) : Promise.resolve({})
    ]);
    if (token !== painting) return;

    var following = !!(counts[0] && counts[0].data);
    var blocked = !!(counts[1] && counts[1].data);
    mine.following[p.handle] = following;
    var isMe = my && my.id === p.id;

    var tabsHTML = tabs(PROF_TABS.filter(function (t) {
      return t.key !== 'articles' || p.is_company;
    }).map(function (t) {
      return { key: t.key, label: t.label, path: p.handle + (t.key === 'posts' ? '' : '/' + t.key) };
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
          '<h2 class="hd-prof-name">' + esc(p.name || p.handle) + badges(p) + '</h2>' +
          '<p class="hd-prof-at">' + H.tag(p.handle, 'hd-at--lg') +
            (p.is_company ? '<span class="hd-kind">' + ic('building') + ' Company</span>' : '') +
            (p.is_bot ? '<span class="hd-kind hd-kind--bot">' + ic('robot') + ' Automated</span>' : '') + '</p>' +
          (p.headline ? '<p class="hd-prof-head">' + esc(p.headline) + '</p>' : '') +
          (p.bio ? '<p class="hd-prof-bio">' + body(p.bio) + '</p>' : '') +
          '<p class="hd-prof-meta">' +
            (p.location ? '<span>' + ic('compass') + esc(p.location) + '</span>' : '') +
            (p.website ? '<span>' + ic('link') + '<a href="' + esc(p.website) + '" target="_blank" rel="noopener nofollow">' +
              esc(p.website.replace(/^https?:\/\/(www\.)?/, '')) + '</a></span>' : '') +
            '<span>' + ic('clock') + 'Joined ' + esc(joined) + '</span>' +
            (p.industry ? '<span>' + ic('building') + esc(p.industry) + '</span>' : '') +
          '</p>' +
          '<p class="hd-count-row">' +
            link(p.handle, '<b>' + num(p.following_count) + '</b> following') +
            link(p.handle, '<b>' + num(p.follower_count) + '</b> follower' + (p.follower_count === 1 ? '' : 's')) +
          '</p>' +
          (counts[2] && counts[2].data && counts[2].data.length ? assocHTML(counts[2].data) : '') +
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
      r = await db.from('articles').select('*').eq('author', p.id).eq('published', true)
        .order('created_at', { ascending: false }).limit(30);
      if (token !== painting) return;
      var arts = r.data || [];
      feed.innerHTML = arts.length ? arts.map(function (a) { return articleCard(a, p); }).join('')
        : empty('No articles yet', p.is_company ? 'Articles this company publishes will appear here.' : 'Only company accounts publish articles.');
      twem(feed);
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
      list.map(function (a) {
        var m = a.member || {};
        return link(m.handle, avatarOf(m, 'hd-av--sm') + '<span>' + esc(m.name || m.handle) + '</span>', 'hd-assoc-one');
      }).join('') + '</div></div>';
  }

  function profileActs(p, isMe, following, blocked) {
    if (isMe) {
      return link('settings', ic('edit') + ' Edit profile', 'nb-btn nb-btn--ghost nb-btn--sm');
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

  function articleCard(a, who) {
    return '<article class="nb-card hd-art">' +
      (a.cover_url ? '<img class="hd-art-cover" src="' + esc(a.cover_url) + '" alt="">' : '') +
      '<div class="hd-art-in">' +
        '<span class="hd-art-kind">' + ic(a.kind === 'link' ? 'link' : 'file') + (a.kind === 'link' ? 'Linked article' : 'Article') + '</span>' +
        '<h3>' + (a.kind === 'link'
          ? '<a href="' + esc(a.url) + '" target="_blank" rel="noopener nofollow">' + esc(a.title) + '</a>'
          : '<a href="' + url('article/' + a.id) + '" data-r>' + esc(a.title) + '</a>') + '</h3>' +
        (a.summary ? '<p>' + esc(a.summary) + '</p>' : '') +
        '<span class="hd-art-by">' + esc(who.name || who.handle) + ' · ' + esc(H.when(a.created_at)) + '</span>' +
      '</div></article>';
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
    if (token !== painting) return;

    el('feed').innerHTML =
      (parent ? card(parent) + '<div class="hd-thread-line"></div>' : '') +
      card(main, { lead: true }) +
      (my ? '<div class="nb-card hd-compose-card">' + composerHTML({
        replyTo: id, toHandle: (main.author || {}).handle, label: 'Reply', placeholder: 'Write a reply'
      }) + '</div>' : '') +
      (replies.length ? feedHTML(replies)
        : '<div class="hd-sep-say">' + (my ? 'No replies yet. Yours would be the first.' : 'No replies yet.') + '</div>');

    if (my) {
      wireComposer(col.querySelector('.hd-compose'), { replyTo: id, label: 'Reply', after: function () { viewThread(id); } });
    }
    twem(col);
    watchViews(col);
  }

  function viewSupernova() {
    col.innerHTML = head('Ask Supernova', 'Swiftaw&rsquo;s assistant, on Hereld.') +
      '<div class="nb-card nb-card--lg hd-nova">' +
        '<img class="hd-nova-mark" src="' + url('Supernova%20mark.png') + '" alt="Supernova" width="64" height="64">' +
        '<h2 class="nb-h3">Supernova runs on Swiftaw</h2>' +
        '<p>Hereld is served as static files, so there is nowhere here to keep an API key without shipping it to every visitor. ' +
        'Until Hereld has a server of its own, the Supernova button on a post opens the real Supernova with that post as the question.</p>' +
        '<div class="hd-nova-acts">' +
          '<a class="nb-btn nb-btn--primary" href="https://swiftaw.com/supernova/chat" target="_blank" rel="noopener">Open Supernova</a>' +
          link('explore', 'Back to Explore', 'nb-btn nb-btn--ghost') +
        '</div>' +
      '</div>';
  }

  function notFoundHTML(line) {
    return '<div class="nb-card nb-card--lg hd-404">' +
      '<div class="hd-404-num">404</div>' +
      '<h1 class="nb-h2">Nobody answered that horn<span class="dot">.</span></h1>' +
      '<p>' + esc(line || 'The page is not here. It may have been a handle that changed, a post that was taken down, or a link that was never right.') + '</p>' +
      '<div class="hd-404-acts">' + link('home', 'Back to the feed', 'nb-btn nb-btn--primary') +
      link('explore', 'Explore', 'nb-btn nb-btn--ghost') + '</div></div>';
  }

  /* ── The right hand column ─────────────────────────────────────────────── */

  async function paintAside() {
    if (!aside) return;
    aside.innerHTML =
      '<form class="hd-searchbar hd-searchbar--aside" id="asideSearch">' +
        '<span class="hd-searchbar-ic">' + ic('search') + '</span>' +
        '<input class="nb-input" type="search" name="q" placeholder="Search Hereld" aria-label="Search Hereld">' +
      '</form>' +
      '<section class="nb-card hd-aside-card" id="asideTags"><h2>' + ic('hash') + ' The Horn Line</h2>' +
        '<p class="nb-muted">Reading the room…</p></section>' +
      '<section class="nb-card hd-aside-card" id="asideWho"><h2>' + ic('users') + ' Worth following</h2>' +
        '<p class="nb-muted">Looking…</p></section>' +
      '<nav class="hd-aside-legal">' +
        '<a href="https://swiftaw.com/legal/terms-of-service">Terms</a>' +
        '<a href="https://swiftaw.com/legal/privacy-policy">Privacy</a>' +
        '<a href="https://swiftaw.com/">Swiftaw</a>' +
        '<a href="https://fortized.com">Fortized</a>' +
        '<span>© 2026 Swiftaw</span></nav>';

    var got = await Promise.all([
      db.rpc('horn_line', { p_limit: 6 }),
      db.rpc('who_to_follow', { p_limit: 3 })
    ]);

    var tags = got[0].data || [];
    var tagBox = el('asideTags');
    if (tagBox) {
      tagBox.innerHTML = '<h2>' + ic('hash') + ' The Horn Line</h2>' + (tags.length
        ? tags.map(function (t) {
            return link('search?q=' + encodeURIComponent('#' + t.tag),
              '<b>#' + esc(t.tag) + '</b><i>' + t.posts + ' post' + (t.posts === 1 ? '' : 's') + '</i>', 'hd-aside-row');
          }).join('')
        : '<p class="nb-muted">Nothing trending yet. Start something with a #.</p>');
    }

    var who = got[1].data || [];
    var whoBox = el('asideWho');
    if (whoBox) {
      whoBox.innerHTML = '<h2>' + ic('users') + ' Worth following</h2>' + (who.length
        ? who.map(function (p) {
            return '<div class="hd-aside-person" data-handle="' + esc(p.handle) + '">' +
              link(p.handle, avatarOf(p, 'hd-av--sm') + '<span><b>' + esc(p.name || p.handle) + '</b><i>' + H.tag(p.handle) + '</i></span>', 'hd-aside-who') +
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

  /* ── Routing ───────────────────────────────────────────────────────────── */

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

    var first = s[0] || 'home';

    if (first === 'index' || first === 'home' || !first) { setTitle('Home'); return viewHome(); }
    if (first === 'explore') { setTitle('Explore'); return viewExplore(); }
    if (first === 'search') { setTitle('Search'); return viewSearch(); }
    if (first === 'notifications') { setTitle('Notifications'); return viewNotifications(); }
    if (first === 'bookmarks') { setTitle('Bookmarks'); return viewBookmarks(); }
    if (first === 'supernova') { setTitle('Ask Supernova'); return viewSupernova(); }
    if (first === 'profile') {
      if (!my) return needAccount();
      return go(my.handle, true);
    }
    if (first === 'settings') { location.href = url('settings'); return; }
    if (first === 'staff') {
      setTitle('Staff console');
      if (window.HStaff) return window.HStaff.render(col, { db: db, my: my, role: staffRole, go: go, url: url });
      col.innerHTML = '<div class="hd-load"><span class="nb-loader"></span></div>';
      return loadStaff();
    }
    if (first === 'post' && s[1]) { setTitle('Post'); return viewThread(s[1]); }
    if (first === 'article' && s[1]) { setTitle('Article'); return viewArticle(s[1]); }
    if (first === 'company' && s[1]) { setTitle('@' + s[1]); return viewProfile(s[1], s[2]); }

    if (/^[a-z0-9_]{3,20}$/.test(first) && RESERVED.indexOf(first) < 0) {
      setTitle('@' + first);
      return viewProfile(first, s[1]);
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

  /* ── Wiring ────────────────────────────────────────────────────────────── */

  function wire() {
    /* Internal links move without a page load. Anything with a modifier key,
       or aimed at another tab, is left alone. */
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
      if (!b) return;

      if (b.hasAttribute('data-back')) { history.length > 1 ? history.back() : go('home'); return; }
      if (b.hasAttribute('data-retry')) { render(); return; }

      var face = b.getAttribute('data-face');
      if (face !== null && b.classList.contains('hd-av-btn')) {
        if (face) U.look([face], 0, 'Profile picture');
        return;
      }
      var cover = b.getAttribute('data-cover');
      if (cover) { U.look([cover], 0, 'Banner'); return; }

      var img = e.target.closest && e.target.closest('.hd-post-body img, .hd-shot');
      if (img) { U.look([img.src], 0, 'Picture'); return; }

      var doing = b.getAttribute('data-do');
      if (doing === 'endorse') return endorse(b);
      if (doing === 'relay') return relay(b);
      if (doing === 'save') return save(b);
      if (doing === 'share') return share(b);
      if (doing === 'more') return moreMenu(b);
      if (doing === 'views') {
        var n = b.querySelector('.hd-act-n');
        return U.toast((n && n.textContent ? n.textContent : '0') + ' people have seen this post.');
      }
      if (doing === 'nova') { window.open(b.getAttribute('data-href'), '_blank', 'noopener'); return; }
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

    window.addEventListener('popstate', function () { render(); });

    /* One keyboard shortcut, the one people reach for. */
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
      { label: 'Copy link to profile', ic: 'link', run: function () { U.copy(location.origin + url(p.handle), 'Link copied.'); } }
    ];
    if (!isMe) {
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
    U.menu(btn, [
      { label: 'Your profile', ic: 'user', run: function () { go(my.handle); } },
      { label: 'Settings', ic: 'gear', href: url('settings') },
      { label: 'Bookmarks', ic: 'bookmark', run: function () { go('bookmarks'); } },
      'rule',
      { label: 'Sign out', ic: 'out', kind: 'bad', run: async function () {
        await H.signOut();
        location.href = url('');
      } }
    ]);
  }

  /* ── Boot ──────────────────────────────────────────────────────────────── */

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
      /* The very first superadmin is claimed once and never again. Asking
         costs one call and only ever answers for one account. */
      var b = await db.rpc('bootstrap_staff');
      if (b && !b.error && b.data === 'superadmin') staffRole = 'superadmin';
    }
  }

  function splashOff() {
    var s = el('splash');
    if (!s) return;
    s.classList.add('is-done');
    setTimeout(function () { s.remove(); }, 620);
  }

  function shell() {
    /* The splash is written by the page itself so it is on screen before any
       script runs. Lift it out before the body is replaced, or the thing that
       covers the boot would be removed by the boot. */
    var lift = el('splash');
    document.body.classList.add('hd-app');
    document.body.innerHTML =
      '<a class="nb-skip" href="#col">Skip to the content</a>' +
      '<div class="nb-rainbaw" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>' +
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
    /* Signed in with no profile is a half-made account. Sending them back to
       the join page is the only honest thing to do with it. */
    if (H.user() && !my) {
      location.replace(url('join'));
      return;
    }

    shell();
    wire();
    await Promise.all([countNotes(), whoAmIOnStaff()]);
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
