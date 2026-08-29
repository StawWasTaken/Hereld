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

  var WITH_AUTHOR = '*, author:profiles!posts_author_fkey(id,handle,name,headline,avatar_url,verified,is_company,is_platform,is_bot,banned,parent_id,follower_count)';

  /* What I have already done, so the buttons come up in the right state
     without one query per post. */
  var mine = { liked: {}, relayed: {}, saved: {}, following: {} };
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

  /* Helper specifically for user profile paths ensuring /@username structure */
  function profilePath(handle) {
    var clean = String(handle || '').replace(/^@+/, '').toLowerCase();
    return url('@' + clean);
  }

  function profileLink(handle, text, cls, extra) {
    var clean = String(handle || '').replace(/^@+/, '').toLowerCase();
    return '<a href="' + profilePath(clean) + '" data-r' + (cls ? ' class="' + cls + '"' : '') +
           (extra || '') + '>' + text + '</a>';
  }

  /* ── Writing ─────────────────────────────────────────────────────────────
     Escape first, then find the things worth linking inside the escaped text.
     Doing it the other way round is how a post ends up running as markup. */

  var PIC_RE = /https?:\/\/[^\s<]+?\.(?:png|jpe?g|webp|gif|avif)(?:\?[^\s<]*)?/gi;
  var VID_RE = /https?:\/\/[^\s<]+?\.(?:mp4|webm|mov)(?:\?[^\s<]*)?/gi;

  /* A picture posted as a link is a picture, not a link. Pull the media out
     of the text so it can be drawn under the words instead of read out as a
     row of blue characters. */
  function mediaOf(text) {
    var out = [], seen = {}, s = String(text || '');
    s.replace(PIC_RE, function (u) { if (!seen[u]) { seen[u] = 1; out.push({ kind: 'pic', url: u }); } return u; });
    s.replace(VID_RE, function (u) { if (!seen[u]) { seen[u] = 1; out.push({ kind: 'vid', url: u }); } return u; });
    return out;
  }

  function mediaHTML(list) {
    if (!list || !list.length) return '';
    var few = list.slice(0, 4);
    return '<div class="hd-shots hd-shots--' + few.length + '">' + few.map(function (m, i) {
      if (m.kind === 'vid') {
        return '<video class="hd-shot hd-shot--vid" src="' + esc(m.url) + '" controls playsinline preload="metadata"></video>';
      }
      return '<button class="hd-shot-btn" type="button" data-shot="' + esc(m.url) + '" data-shot-i="' + i + '" aria-label="Open picture">' +
        '<img class="hd-shot" src="' + esc(m.url) + '" alt="" loading="lazy" decoding="async"></button>';
    }).join('') + '</div>';
  }

  /* Escape first, then find the things worth marking up inside the escaped
     text. Doing it the other way round is how a post ends up running as
     markup. Anything already turned into html is parked as a token so the
     formatting pass cannot reach inside a href. */
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
      return pre + park('<a href="' + profilePath(h) + '" data-r data-card="' + esc(h.toLowerCase()) +
             '" class="hd-mention">' + H.tag(h) + '</a>');
    });
    out = out.replace(/(^|[\s(])#([a-z0-9_]{2,30})\b/gi, function (m, pre, t) {
      return pre + park('<a href="' + url('search?q=' + encodeURIComponent('#' + t)) +
             '" data-r class="hd-tag-link">#' + esc(t) + '</a>');
    });

    /* Bold before italic, or a run of three stars comes out as one star and a
       bold that never closes. */
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

  /* ── People ─────────────────────────────────────────────────────────────── */

  /* Two marks, and they mean different things. A person who has been checked
     gets the blue one; a company that has been checked gets the yellow
     building. Neither sits on a disc - the mark is the mark. */
  function badges(p) {
    var out = '';
    if (p.is_platform) {
      out += '<span class="hd-badge hd-badge--plat" title="Official Hereld account">' + ic('shield') +
             '<span class="nb-sr">Official Hereld account</span></span>';
    } else if (p.verified) {
      out += p.is_company
        ? '<span class="hd-badge hd-badge--co" title="Verified company">' + ic('verifiedco') +
          '<span class="nb-sr">Verified company</span></span>'
        : '<span class="hd-badge hd-badge--ver" title="Verified account">' + ic('verified') +
          '<span class="nb-sr">Verified account</span></span>';
    }
    /* A parent account carries the child it belongs to, so a regional or
       product account can be traced back in one look. */
    if (p.parent) {
      out += '<a class="hd-badge hd-badge--par" href="' + profilePath(p.parent.handle) + '" data-r ' +
        'title="Part of ' + esc(p.parent.name || p.parent.handle) + '">' +
        H.avatar(p.parent, 'hd-av--pin') +
        '<span class="nb-sr">Part of ' + esc(p.parent.name || p.parent.handle) + '</span></a>';
    }
    return out;
  }

  function avatarOf(p, cls) {
    return H.avatar(p, cls || '');
  }

  /* A name, its marks, its handle and, where we know it, how many people
     follow it. Everything in here points at the profile. */
  function nameLine(p, stamp, extra) {
    var count = p.follower_count == null ? '' :
      '<span class="hd-who-fol">' + num(p.follower_count) + ' follower' + (p.follower_count === 1 ? '' : 's') + '</span>';
    return '<span class="hd-who">' +
      profileLink(p.handle, '<b>' + esc(p.name || p.handle) + '</b>', 'hd-who-name', ' data-card="' + esc(p.handle || '') + '"') +
      badges(p) +
      profileLink(p.handle, H.tag(p.handle), 'hd-who-at', ' data-card="' + esc(p.handle || '') + '"') + count +
      (stamp ? '<span class="hd-dot">&middot;</span><span class="hd-when">' + esc(stamp) + '</span>' : '') +
      (extra || '') + '</span>';
  }

  /* ── The action bar ──────────────────────────────────────────────────────
     Reply, relay, like, views, save, share, Supernova, more. Every count
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

    return '<div class="hd-acts" data-id="' + p.id + '">' +
      act('reply',  'comment',  'Reply',   p.reply_count,   false, 'data-do="reply"') +
      act('relay',  'relay',    'Relay',   p.relay_count,   mine.relayed[p.id],  'data-do="relay"') +
      act('like',   'heart',    'Like',    p.endorse_count, mine.liked[p.id],    'data-do="like"') +
      act('views',  'chart',    'Views',   p.view_count,    false, 'data-do="views"') +
      act('save',   'bookmark', mine.saved[p.id] ? 'Saved' : 'Save', null, mine.saved[p.id], 'data-do="save"') +
      act('share',  'share',    'Share',   null, false, 'data-do="share"') +
      '<button class="hd-act hd-act--nova" type="button" data-do="nova" ' +
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
        profileLink(p.relayed_by.handle, esc(p.relayed_by.name || p.relayed_by.handle)) + ' relayed this</div>';
    } else if (p.reply_at) {
      lead = '<div class="hd-lead">' + ic('comment') + ' Replying to ' +
        profileLink(p.reply_at.handle, H.tag(p.reply_at.handle), 'hd-lead-at') + '</div>';
    }

    var quoted = p.quote ? '<div class="hd-quote" data-open="' + p.quote.id + '">' +
      '<div class="hd-quote-top">' + avatarOf(p.quote.author, 'hd-av--xs') +
      nameLine(p.quote.author, H.when(p.quote.created_at)) + '</div>' +
      '<p>' + body(p.quote.body) + '</p>' + mediaHTML(mediaOf(p.quote.body).slice(0, 1)) + '</div>' : '';

    var shots = mediaHTML(mediaOf(p.body));
    var said = body(p.body);

    /* The whole card opens the post. Every control inside it stops the click,
       so nothing that already does something gets hijacked. */
    return '<article class="nb-card hd-post' + (o.lead ? ' hd-post--lead' : '') + '" data-post="' + p.id +
      '" data-author="' + esc(a.handle || '') + '"' + (o.lead ? '' : ' data-open="' + p.id + '" tabindex="0" role="link"') + '>' +
      lead +
      '<div class="hd-post-top">' +
        '<a class="hd-av-btn" href="' + profilePath(a.handle || '') + '" data-r data-card="' + esc(a.handle || '') + '" ' +
          'aria-label="' + esc(a.name || a.handle || '') + '">' + avatarOf(a) + '</a>' +
        '<div class="hd-post-who">' + nameLine(a, H.when(p.created_at)) +
          (a.headline ? '<i class="hd-head">' + esc(a.headline) + '</i>' : '') +
        '</div>' +
      '</div>' +
      (said ? '<p class="hd-post-body">' + said + '</p>' : '') +
      shots + quoted + note + acts(p) +
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
    (got[0].data || []).forEach(function (r) { mine.liked[r.post_id] = true; });
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

  /* What sits under a post is not one person's paragraph. People add context,
     Supernova reads what they added and writes one summary of it, and the
     summary is what a reader sees. A note a member of staff published by hand
     still shows, because those came first and are still true. */
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

  /* A reply on its own says nothing about who it answers. One query names
     them all so the card can say so above the words. */
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

  /* One read for the parent of every account on screen, so a product or
     regional account can show the company it belongs to. */
  async function attachParents(rows) {
    var need = [], seen = {};
    rows.forEach(function (p) {
      var a = p.author;
      if (a && a.parent_id && !seen[a.parent_id]) { seen[a.parent_id] = 1; need.push(a.parent_id); }
    });
    if (!need.length) return rows;
    var r = await db.from('profiles').select('id,handle,name,avatar_url,is_company').in('id', need);
    var by = {};
    (r.data || []).forEach(function (x) { by[x.id] = x; });
    rows.forEach(function (p) {
      if (p.author && p.author.parent_id && by[p.author.parent_id]) p.author.parent = by[p.author.parent_id];
    });
    return rows;
  }

  async function hydrate(rows) {
    rows = rows || [];
    rows = await attachRelays(rows);
    await Promise.all([attachNotes(rows), attachReplies(rows), attachParents(rows), markMine(rows)]);
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
      if (f.size > 24 * 1024 * 1024) return warn('That picture is over 24 MB. Try a smaller one.');
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
      /* Put it back rather than leave a number that never happened. */
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
      { label: 'Relay with your own words', ic: 'quill', /* ... continuation omitted for length ... */ }
    ]);
  }
})();
