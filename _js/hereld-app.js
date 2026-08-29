/* The network itself: the rail, the feed, the composer, profiles and threads.

   One page, routed on the hash, so moving between a feed and a profile never
   throws the whole shell away and rebuilds it. */
(function () {
  'use strict';

  var H = window.Hereld;
  var esc = H.esc, when = H.when, avatar = H.avatar, trouble = H.trouble;
  var db = null, me = null;

  var MAX = 600;

  var I = {
    home: '<svg viewBox="0 0 576 512" aria-hidden="true"><path d="M303.5 5.7c-9-7.6-22.1-7.6-31.1 0l-264 224c-10.1 8.6-11.3 23.7-2.8 33.8s23.7 11.3 33.8 2.8L64 245.5 64 432c0 44.2 35.8 80 80 80l288 0c44.2 0 80-35.8 80-80l0-186.5 24.5 20.8c10.1 8.6 25.3 7.3 33.8-2.8s7.3-25.3-2.8-33.8l-264-224zM272 320l32 0c26.5 0 48 21.5 48 48l0 96-128 0 0-96c0-26.5 21.5-48 48-48z"/></svg>',
    explore: '<svg viewBox="0 0 512 512" aria-hidden="true"><path d="M256 0a256 256 0 1 1 0 512A256 256 0 1 1 256 0zM369.4 158.2c3.1-8.4 1-17.8-5.3-24.2s-15.8-8.4-24.2-5.3L204.8 178.6c-12.3 4.5-22 14.2-26.5 26.5L128.2 339.8c-3.1 8.4-1 17.8 5.3 24.2s15.8 8.4 24.2 5.3l135.1-49.9c12.3-4.5 22-14.2 26.5-26.5l49.9-135.1zM288 256a32 32 0 1 1 -64 0 32 32 0 1 1 64 0z"/></svg>',
    person: '<svg viewBox="0 0 448 512" aria-hidden="true"><path d="M224 256a128 128 0 1 0 0-256 128 128 0 1 0 0 256zm-45.7 48C79.8 304 0 383.8 0 482.3 0 498.7 13.3 512 29.7 512l388.6 0c16.4 0 29.7-13.3 29.7-29.7 0-98.5-79.8-178.3-178.3-178.3l-91.4 0z"/></svg>',
    feather: '<svg viewBox="0 0 512 512" aria-hidden="true"><path d="M278.5 215.6 23 471c-9.4 9.4-9.4 24.6 0 33.9s24.6 9.4 33.9 0l99.9-99.9 143.6 0c31 0 60.8-12.3 82.7-34.3L488 273.9c14.4-14.4 20.5-33.5 18.2-51.8 24.1-24.1 34.4-59.5 25.6-95.3-8.5-34.4-35.4-61.3-69.8-69.8-35.8-8.8-71.2 1.5-95.3 25.6-18.3-2.3-37.4 3.8-51.8 18.2l-96.8 96.8c-22 22-34.3 51.7-34.3 82.7l0 143.6-99.9 99.9 255.4-255.4-60.8 0 0-84.5c0-8.5 3.4-16.6 9.4-22.6L323.7 143c4.4-4.4 11.6-4.4 16 0 4.4 4.4 4.4 11.6 0 16l-2 2c-9.4 9.4-9.4 24.6 0 33.9 9.4 9.4 24.6 9.4 33.9 0l2-2 33.9-33.9 33.9 33.9-33.9 33.9-84.5 0 0-11.2z"/></svg>',
    endorse: '<svg viewBox="0 0 576 512" aria-hidden="true"><path d="M316.9 18C311.6 7 300.4 0 288.1 0s-23.4 7-28.8 18L195 150.3 51.4 171.5c-12 1.8-22 10.2-25.7 21.7s-.7 24.2 7.9 32.7L137.8 339 113.2 483.9c-2 11.9 3 24 12.9 31.1s23 8 33.8 2.3l128.3-68.5 128.3 68.5c10.8 5.7 23.9 4.9 33.8-2.3s14.9-19.3 12.9-31.1L438.5 339 542.7 225.9c8.6-8.5 11.7-21.2 7.9-32.7s-13.7-19.9-25.7-21.7L381.2 150.3 316.9 18z"/></svg>',
    relay: '<svg viewBox="0 0 512 512" aria-hidden="true"><path d="M105.1 202.6c7.7-21.8 20.2-42.3 37.8-59.8 62.5-62.5 163.8-62.5 226.3 0L386.3 160 336 160c-17.7 0-32 14.3-32 32s14.3 32 32 32l128 0c17.7 0 32-14.3 32-32l0-128c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 51.2L414.4 97.6c-87.5-87.5-229.3-87.5-316.8 0-24.4 24.4-42.1 53.1-52.9 83.8-8.8 24.9 4.2 52.2 29.1 61s52.2-4.2 61-29.1zM39 289.3c-5 1.5-9.8 4.2-13.7 8.2-4 4-6.7 8.8-8.1 14-.3 1.2-.6 2.5-.8 3.8-.3 1.7-.4 3.4-.4 5.1L16 448c0 17.7 14.3 32 32 32s32-14.3 32-32l0-51.2 33.6 33.6c87.5 87.5 229.3 87.5 316.8 0 24.4-24.4 42.1-53.1 52.9-83.8 8.8-24.9-4.2-52.2-29.1-61s-52.2 4.2-61 29.1c-7.7 21.8-20.2 42.3-37.8 59.8-62.5 62.5-163.8 62.5-226.3 0L125.7 352l50.3 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L48.4 288c-1.6 0-3.2 .1-4.8 .3S40.3 288.9 39 289.3z"/></svg>',
    reply: '<svg viewBox="0 0 512 512" aria-hidden="true"><path d="M123.6 391.3c12.9-9.4 29.6-11.8 44.6-6.4 26.5 9.6 56.2 15.1 87.8 15.1 124.7 0 208-80.5 208-160S380.7 80 256 80 48 160.5 48 240c0 32 12.4 62.8 35.7 89.2 8.6 9.7 12.8 22.5 11.8 35.5-1.4 18.1-5.7 34.7-11.3 49.4 17-7.9 31.1-16.7 39.4-22.7zM21.2 431.9c1.8-2.7 3.5-5.4 5.1-8.1 10-16.6 19.5-38.4 21.4-62.9C17.7 326.8 0 285.1 0 240 0 125.1 114.6 32 256 32s256 93.1 256 208-114.6 208-256 208c-37.1 0-72.3-6.4-104.1-17.9-11.9 8.7-31.3 20.6-54.3 30.6-15.1 6.6-32.3 12.6-50.1 16.1-.8 .2-1.6 .3-2.4 .5-4.4 .8-8.7 1.5-13.2 1.9-.2 0-.5 .1-.7 .1-5.1 .5-10.2 .8-15.3 .8-6.5 0-12.3-3.9-14.8-9.9s-1.1-12.8 3.4-17.4c4.1-4.2 7.8-8.7 11.3-13.5 1.7-2.3 3.3-4.6 4.8-6.9l.3-.5z"/></svg>',
    search: '<svg viewBox="0 0 512 512" aria-hidden="true"><path d="M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0s208 93.1 208 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z"/></svg>',
    back: '<svg viewBox="0 0 448 512" aria-hidden="true"><path d="M9.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l160 160c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L109.2 288 416 288c17.7 0 32-14.3 32-32s-14.3-32-32-32l-306.7 0L214.6 118.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-160 160z"/></svg>',
    trash: '<svg viewBox="0 0 448 512" aria-hidden="true"><path d="M170.5 51.6 151.5 80l145 0-19-28.4c-1.5-2.2-4-3.6-6.7-3.6l-93.7 0c-2.7 0-5.2 1.3-6.7 3.6zm147-26.6L354.2 80 368 80l48 0 8 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-8 0 0 304c0 44.2-35.8 80-80 80l-224 0c-44.2 0-80-35.8-80-80l0-304-8 0c-13.3 0-24-10.7-24-24s10.7-24 24-24l8 0 48 0 13.8 0 36.7-55.1C140.9 9.4 158.4 0 177.1 0l93.7 0c18.7 0 36.2 9.4 46.6 24.9zM80 128l0 304c0 17.7 14.3 32 32 32l224 0c17.7 0 32-14.3 32-32l0-304L80 128z"/></svg>'
  };

  function el(id) { return document.getElementById(id); }

  /* Links, and nothing else. The body is escaped first, so what goes in here
     is already inert text: this only ever adds an anchor around it. */
  function body(text) {
    var s = esc(text);
    s = s.replace(/(https?:\/\/[^\s<]+)/g, function (u) {
      var clean = u.replace(/[.,;:)]+$/, '');
      var tail = u.slice(clean.length);
      var show = clean.replace(/^https?:\/\//, '');
      if (show.length > 46) show = show.slice(0, 44) + '…';
      return '<a href="' + clean + '" target="_blank" rel="noopener nofollow">' + show + '</a>' + tail;
    });
    s = s.replace(/(^|[\s(])@([a-z0-9_]{3,20})\b/gi, function (m, pre, h) {
      return pre + '<a href="#/u/' + h.toLowerCase() + '">@' + h + '</a>';
    });
    return s;
  }

  // ── DATA ────────────────────────────────────────────────────────────────

  var WITH_AUTHOR = '*, author:profiles!posts_author_fkey(id,handle,name,headline,avatar_url)';
  var mine = { endorsed: {}, relayed: {} };

  /* One round trip for "which of these did I endorse", not one per post. */
  async function markMine(rows) {
    if (!me || !rows.length) return;
    var ids = rows.map(function (p) { return p.id; });
    var orig = rows.map(function (p) { return p.relay_of; }).filter(Boolean);
    var all = ids.concat(orig);

    var e = await db.from('endorsements').select('post_id').eq('user_id', me.id).in('post_id', all);
    if (!e.error) e.data.forEach(function (r) { mine.endorsed[r.post_id] = true; });

    var r = await db.from('posts').select('relay_of').eq('author', me.id).in('relay_of', all);
    if (!r.error) r.data.forEach(function (x) { mine.relayed[x.relay_of] = true; });
  }

  /* A relay carries the post it is passing on. Fetched by id in one go rather
     than nested in the first query, because a nested embed through an RPC is
     one more thing that can quietly return null. */
  async function attachRelays(rows) {
    var ids = rows.map(function (p) { return p.relay_of; }).filter(Boolean);
    if (!ids.length) return rows;
    var r = await db.from('posts').select(WITH_AUTHOR).in('id', ids);
    if (r.error) return rows;
    var by = {};
    r.data.forEach(function (p) { by[p.id] = p; });
    rows.forEach(function (p) { if (p.relay_of) p.relayed = by[p.relay_of] || null; });
    return rows;
  }

  async function hydrate(rows) {
    rows = rows || [];
    await attachRelays(rows);
    await markMine(rows);
    return rows;
  }

  // ── RENDERING ───────────────────────────────────────────────────────────

  function nameLine(p, stamp) {
    var a = p.author || {};
    return '<div class="hd-post-name">' +
      '<b>' + esc(a.name || a.handle || 'Someone') + '</b>' +
      '<span>@' + esc(a.handle || '') + '</span>' +
      (stamp ? '<span class="sep">·</span><time datetime="' + esc(p.created_at) + '">' + esc(when(p.created_at)) + '</time>' : '') +
      '</div>' +
      (a.headline ? '<p class="hd-headline">' + esc(a.headline) + '</p>' : '');
  }

  function acts(p) {
    var endorsed = !!mine.endorsed[p.id];
    var relayed = !!mine.relayed[p.id];
    return '<div class="hd-acts">' +
      '<button type="button" class="hd-act" data-act="reply" data-id="' + p.id + '">' +
        I.reply + '<span class="c">' + (p.reply_count || '') + '</span></button>' +
      '<button type="button" class="hd-act hd-act--relay' + (relayed ? ' is-on' : '') + '" data-act="relay" data-id="' + p.id + '" aria-pressed="' + relayed + '">' +
        I.relay + '<span class="c">' + (p.relay_count || '') + '</span></button>' +
      '<button type="button" class="hd-act hd-act--endorse' + (endorsed ? ' is-on' : '') + '" data-act="endorse" data-id="' + p.id + '" aria-pressed="' + endorsed + '">' +
        I.endorse + '<span class="c">' + (p.endorse_count || '') + '</span></button>' +
      (me && p.author && p.author.id === me.id
        ? '<button type="button" class="hd-act hd-act--more" data-act="bin" data-id="' + p.id + '" aria-label="Delete this post">' + I.trash + '</button>'
        : '') +
      '</div>';
  }

  function card(p, opts) {
    opts = opts || {};
    var shown = p;
    var banner = '';

    if (p.relay_of && !String(p.body || '').trim()) {
      if (!p.relayed) {
        return '<article class="hd-post"><p class="hd-post-body nb-muted">' +
          'This post was relayed, and the original is gone.</p></article>';
      }
      banner = '<div class="hd-relay">' + I.relay + esc((p.author && (p.author.name || p.author.handle)) || 'Someone') + ' relayed</div>';
      shown = p.relayed;
    }

    var cls = 'hd-post' + (opts.focus ? ' hd-post--focus' : '') + (opts.reply ? ' hd-post--reply' : '');
    return '<article class="' + cls + '" data-post="' + p.id + '" data-open="' + shown.id + '">' +
      banner +
      '<div class="hd-post-top">' +
        '<a href="#/u/' + esc((shown.author && shown.author.handle) || '') + '" aria-label="Open profile">' +
          avatar(shown.author) + '</a>' +
        '<div class="hd-post-who">' + nameLine(shown, true) + '</div>' +
      '</div>' +
      '<p class="hd-post-body">' + body(shown.body) + '</p>' +
      acts(shown) +
      '</article>';
  }

  function feedHTML(rows, opts) {
    if (!rows.length) return '';
    return rows.map(function (p) { return card(p, opts); }).join('');
  }

  function empty(title, line) {
    return '<div class="nb-card hd-empty">' +
      '<img src="Hereld%20logomark2.png" alt="">' +
      '<h3 class="nb-h4">' + esc(title) + '</h3>' +
      '<p>' + esc(line) + '</p></div>';
  }

  function skeletons(n) {
    var one = '<article class="hd-post hd-skel" aria-hidden="true">' +
      '<div class="hd-post-top"><span class="nb-skel nb-skel--av"></span>' +
      '<div class="hd-post-who"><span class="nb-skel nb-skel--line" style="width:44%"></span></div></div>' +
      '<p class="hd-post-body"><span class="nb-skel nb-skel--line"></span>' +
      '<span class="nb-skel nb-skel--line" style="width:72%"></span></p></article>';
    return new Array(n + 1).join(one);
  }

  // ── THE RAIL ────────────────────────────────────────────────────────────

  function railHTML(active) {
    function item(href, key, icon, label) {
      return '<a class="hd-nav-i' + (active === key ? ' is-on' : '') + '" href="' + href + '">' +
        icon + '<span>' + label + '</span></a>';
    }
    return '<a class="hd-brand hd-rail-brand" href="#/home" aria-label="Hereld">' +
        '<span class="hd-mark"><img src="HereldAt.png" alt=""></span>' +
        '<span class="hd-brand-word"><img src="Hereld%20logomark2.png" alt="Hereld" style="height:21px"></span>' +
      '</a>' +
      '<nav class="hd-nav">' +
        item('#/home', 'home', I.home, 'Feed') +
        item('#/explore', 'explore', I.explore, 'Explore') +
        item(me ? '#/u/' + me.handle : '#/home', 'me', I.person, 'Profile') +
      '</nav>' +
      '<div class="hd-rail-cta">' +
        '<button type="button" class="nb-btn nb-btn--primary nb-btn--block" id="railWrite">' +
          I.feather + '<span>Write</span></button>' +
      '</div>' +
      (me ? '<button type="button" class="hd-me" id="railMe">' +
        avatar(me, 'hd-av--sm') +
        '<span class="hd-me-txt"><b>' + esc(me.name || me.handle) + '</b><i>@' + esc(me.handle) + '</i></span>' +
        '</button>' : '');
  }

  function barHTML(active) {
    function b(href, key, icon, label) {
      return '<a href="' + href + '" class="' + (active === key ? 'is-on' : '') + '" aria-label="' + label + '">' + icon + '</a>';
    }
    return b('#/home', 'home', I.home, 'Feed') +
      b('#/explore', 'explore', I.explore, 'Explore') +
      b(me ? '#/u/' + me.handle : '#/home', 'me', I.person, 'Profile');
  }

  // ── VIEWS ───────────────────────────────────────────────────────────────

  var col, aside;

  function head(title, sub, opts) {
    opts = opts || {};
    return '<header class="hd-col-head">' +
      (opts.back ? '<button type="button" class="nb-icon-btn hd-back" id="goBack" aria-label="Back">' + I.back + '</button>' : '') +
      '<div><h1>' + esc(title) + '</h1>' + (sub ? '<p class="sub">' + esc(sub) + '</p>' : '') + '</div>' +
      (opts.tabs || '') +
      '</header>';
  }

  function composerHTML(placeholder, replyTo) {
    return '<section class="nb-card hd-compose">' +
      '<div class="hd-compose-row">' + avatar(me) +
        '<div class="hd-compose-body">' +
          '<label class="nb-sr" for="cmpBody">What are you announcing</label>' +
          '<textarea class="hd-ta" id="cmpBody" maxlength="' + MAX + '" placeholder="' + esc(placeholder) + '"></textarea>' +
          '<div class="hd-compose-foot">' +
            '<span class="hd-busy" id="cmpBusy" hidden><span class="nb-loader nb-loader--sm"></span> Sending</span>' +
            '<span class="hd-count" id="cmpCount">' + MAX + '</span>' +
            '<button type="button" class="nb-btn nb-btn--primary" id="cmpGo" data-reply="' + (replyTo || '') + '" disabled>' +
              (replyTo ? 'Reply' : 'Post') + '</button>' +
          '</div>' +
          '<div class="nb-alert nb-alert--error hd-say" id="cmpSay" hidden></div>' +
        '</div></div></section>';
  }

  function wireComposer() {
    var ta = el('cmpBody'), go = el('cmpGo'), count = el('cmpCount');
    if (!ta) return;
    ta.addEventListener('input', function () {
      var left = MAX - ta.value.length;
      count.textContent = left;
      count.classList.toggle('is-near', left <= 60 && left >= 0);
      count.classList.toggle('is-over', left < 0);
      go.disabled = !ta.value.trim() || left < 0;
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 320) + 'px';
    });
    ta.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !go.disabled) go.click();
    });
    go.addEventListener('click', send);
  }

  async function send() {
    var ta = el('cmpBody'), go = el('cmpGo'), say = el('cmpSay'), busy = el('cmpBusy');
    var text = ta.value.trim();
    if (!text) return;
    go.disabled = true; busy.hidden = false; say.hidden = true;
    var row = { author: me.id, body: text };
    var reply = go.dataset.reply;
    if (reply) row.reply_to = reply;
    var r = await db.from('posts').insert(row).select(WITH_AUTHOR).single();
    busy.hidden = true;
    if (r.error) {
      say.textContent = trouble(r.error, 'That did not go out.');
      say.hidden = false;
      go.disabled = false;
      return;
    }
    ta.value = ''; ta.style.height = 'auto';
    el('cmpCount').textContent = MAX;
    var host = el('feed');
    if (host) {
      var first = host.firstElementChild;
      var html = card(r.data, { reply: !!reply });
      if (host.querySelector('.hd-empty')) host.innerHTML = html;
      else if (reply) host.insertAdjacentHTML('beforeend', html);
      else if (first) first.insertAdjacentHTML('beforebegin', html);
      else host.innerHTML = html;
    }
  }

  async function viewHome() {
    col.innerHTML = head('Feed', 'The people you follow, newest first') +
      composerHTML('Say what you are working on.') +
      '<div class="hd-feed" id="feed">' + skeletons(3) + '</div>';
    wireComposer();

    var r = await db.rpc('feed', { p_limit: 25 }).select(WITH_AUTHOR);
    var host = el('feed');
    if (!host) return;
    if (r.error) {
      host.innerHTML = '<div class="nb-alert nb-alert--error">' + esc(trouble(r.error, 'The feed did not load.')) + '</div>';
      return;
    }
    var rows = await hydrate(r.data);
    host.innerHTML = rows.length ? feedHTML(rows)
      : empty('Nothing here yet', 'Follow a few people from Explore, or write the first thing yourself.');
  }

  async function viewExplore(q) {
    var tabs = '<div class="hd-tabs"><span class="hd-tab is-on">Latest</span></div>';
    col.innerHTML = head('Explore', 'Everything on Hereld, newest first', { tabs: tabs }) +
      '<div class="hd-feed" id="feed">' + skeletons(3) + '</div>';

    var sel = db.from('posts').select(WITH_AUTHOR).is('reply_to', null)
      .order('created_at', { ascending: false }).limit(30);
    if (q) sel = sel.ilike('body', '%' + q + '%');
    var r = await sel;
    var host = el('feed');
    if (!host) return;
    if (r.error) {
      host.innerHTML = '<div class="nb-alert nb-alert--error">' + esc(trouble(r.error, 'Could not load.')) + '</div>';
      return;
    }
    var rows = await hydrate(r.data);
    host.innerHTML = rows.length ? feedHTML(rows)
      : empty(q ? 'No posts match that' : 'Hereld is empty', q ? 'Try a shorter search.' : 'Be the first to say something.');
  }

  async function viewProfile(handle) {
    col.innerHTML = head('@' + handle, '', { back: true }) +
      '<div class="nb-card nb-card--lg"><span class="nb-skel nb-skel--line" style="width:40%"></span></div>' +
      '<div class="hd-feed" id="feed" style="margin-top:16px">' + skeletons(2) + '</div>';

    var pr = await db.from('profiles').select('*').eq('handle', handle).maybeSingle();
    if (pr.error || !pr.data) {
      col.innerHTML = head('Not found', '', { back: true }) +
        empty('No such handle', 'Nobody on Hereld goes by @' + handle + '.');
      return;
    }
    var p = pr.data;
    var isMe = me && p.id === me.id;

    var following = false;
    if (me && !isMe) {
      var f = await db.from('follows').select('following').eq('follower', me.id).eq('following', p.id).maybeSingle();
      following = !!(f.data);
    }

    col.innerHTML = head(p.name || ('@' + p.handle), p.post_count + (p.post_count === 1 ? ' post' : ' posts'), { back: true }) +
      '<section class="nb-card nb-card--lg">' +
        '<div class="hd-prof-top">' + avatar(p, 'hd-av--lg') +
          '<div class="hd-prof-txt">' +
            '<h1>' + esc(p.name || p.handle) + '</h1>' +
            '<p class="hd-prof-handle">@' + esc(p.handle) + '</p>' +
            (p.headline ? '<p class="hd-prof-head">' + esc(p.headline) + '</p>' : '') +
          '</div></div>' +
        (p.bio ? '<p class="hd-prof-bio">' + body(p.bio) + '</p>' : '') +
        '<div class="hd-prof-meta">' +
          '<span><b>' + p.follower_count + '</b> ' + (p.follower_count === 1 ? 'follower' : 'followers') + '</span>' +
          '<span><b>' + p.following_count + '</b> following</span>' +
          (p.location ? '<span>' + esc(p.location) + '</span>' : '') +
          (p.website ? '<span><a href="' + esc(p.website) + '" target="_blank" rel="noopener nofollow">' + esc(p.website.replace(/^https?:\/\//, '')) + '</a></span>' : '') +
          '<span>Joined ' + esc(new Date(p.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })) + '</span>' +
        '</div>' +
        '<div class="hd-prof-acts">' +
          (isMe
            ? '<a class="nb-btn nb-btn--sm" href="settings.html">Edit profile</a>'
            : (me ? '<button type="button" class="nb-btn nb-btn--sm' + (following ? '' : ' nb-btn--primary') + '" id="followGo" data-on="' + following + '" data-id="' + p.id + '">' +
                (following ? 'Following' : 'Follow') + '</button>'
                 : '<a class="nb-btn nb-btn--sm nb-btn--primary" href="join.html">Join to follow</a>')) +
        '</div>' +
      '</section>' +
      '<div class="hd-feed" id="feed" style="margin-top:16px">' + skeletons(2) + '</div>';

    var go = el('followGo');
    if (go) go.addEventListener('click', follow);

    var r = await db.from('posts').select(WITH_AUTHOR).eq('author', p.id)
      .order('created_at', { ascending: false }).limit(30);
    var host = el('feed');
    if (!host || r.error) return;
    var rows = await hydrate(r.data);
    host.innerHTML = rows.length ? feedHTML(rows)
      : empty('Nothing posted yet', isMe ? 'Your posts will show up here.' : 'When they post, it shows up here.');
  }

  async function follow(e) {
    var b = e.currentTarget;
    var on = b.dataset.on === 'true';
    b.disabled = true;
    var r = on
      ? await db.from('follows').delete().eq('follower', me.id).eq('following', b.dataset.id)
      : await db.from('follows').insert({ follower: me.id, following: b.dataset.id });
    b.disabled = false;
    if (r.error) return;
    on = !on;
    b.dataset.on = String(on);
    b.textContent = on ? 'Following' : 'Follow';
    b.classList.toggle('nb-btn--primary', !on);
  }

  async function viewThread(id) {
    col.innerHTML = head('Post', '', { back: true }) +
      '<div class="hd-feed" id="feed">' + skeletons(1) + '</div>';

    var r = await db.from('posts').select(WITH_AUTHOR).eq('id', id).maybeSingle();
    if (r.error || !r.data) {
      col.innerHTML = head('Post', '', { back: true }) + empty('Gone', 'That post is no longer here.');
      return;
    }
    var rows = await hydrate([r.data]);
    var rep = await db.from('posts').select(WITH_AUTHOR).eq('reply_to', id)
      .order('created_at', { ascending: true }).limit(50);
    var replies = rep.error ? [] : await hydrate(rep.data);

    col.innerHTML = head('Post', replies.length + (replies.length === 1 ? ' reply' : ' replies'), { back: true }) +
      '<div class="hd-feed" id="thread">' + card(rows[0], { focus: true }) + '</div>' +
      (me ? composerHTML('Write a reply.', id) : '') +
      '<div class="hd-feed" id="feed" style="margin-top:16px">' +
        (replies.length ? feedHTML(replies, { reply: true }) : '') + '</div>';
    wireComposer();
  }

  // ── ASIDE ───────────────────────────────────────────────────────────────

  async function paintAside() {
    aside.innerHTML =
      '<div class="nb-card"><label class="nb-sr" for="q">Search Hereld</label>' +
        '<div class="hd-search">' + I.search +
        '<input class="nb-input" id="q" type="search" placeholder="Search posts" autocomplete="off"></div></div>' +
      '<div class="nb-card"><span class="hd-side-h">Worth following</span>' +
        '<div id="whoBox"><span class="nb-skel nb-skel--line"></span></div></div>' +
      '<div class="nb-card nb-card--flat"><span class="hd-side-h">Hereld</span>' +
        '<p class="nb-muted" style="font-size:13px;line-height:1.6;margin:0 0 12px">' +
        'A Swiftaw product, newly out of the workshop. Rough edges are ours to file down.</p>' +
        '<a class="nb-btn nb-btn--sm nb-btn--ghost" href="index.html">About Hereld</a></div>';

    var q = el('q');
    q.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var v = q.value.trim();
      location.hash = v ? '#/explore?q=' + encodeURIComponent(v) : '#/explore';
    });

    var r = await db.from('profiles').select('id,handle,name,headline,avatar_url,follower_count')
      .order('follower_count', { ascending: false }).limit(20);
    var box = el('whoBox');
    if (!box) return;
    if (r.error) { box.innerHTML = '<p class="nb-muted" style="font-size:13px;margin:0">Could not load.</p>'; return; }

    var list = r.data.filter(function (p) { return !me || p.id !== me.id; }).slice(0, 4);
    box.innerHTML = list.length ? list.map(function (p) {
      return '<a class="hd-who" href="#/u/' + esc(p.handle) + '">' + avatar(p, 'hd-av--sm') +
        '<span class="hd-who-txt"><b>' + esc(p.name || p.handle) + '</b>' +
        '<i>' + esc(p.headline || ('@' + p.handle)) + '</i></span></a>';
    }).join('') : '<p class="nb-muted" style="font-size:13px;margin:0">Nobody else yet. You are early.</p>';
  }

  // ── ACTIONS ─────────────────────────────────────────────────────────────

  async function endorse(btn) {
    if (!me) { location.href = 'join.html'; return; }
    var id = btn.dataset.id;
    var on = btn.classList.contains('is-on');
    var c = btn.querySelector('.c');
    var n = parseInt(c.textContent || '0', 10) || 0;

    btn.classList.toggle('is-on', !on);
    btn.setAttribute('aria-pressed', String(!on));
    c.textContent = (on ? Math.max(0, n - 1) : n + 1) || '';
    mine.endorsed[id] = !on;

    var r = on
      ? await db.from('endorsements').delete().eq('post_id', id).eq('user_id', me.id)
      : await db.from('endorsements').insert({ post_id: id, user_id: me.id });

    if (r.error) {
      // Put it back rather than leave a number that never happened.
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(on));
      c.textContent = n || '';
      mine.endorsed[id] = on;
    }
  }

  async function relay(btn) {
    if (!me) { location.href = 'join.html'; return; }
    var id = btn.dataset.id;
    var on = btn.classList.contains('is-on');
    btn.disabled = true;
    var r = on
      ? await db.from('posts').delete().eq('author', me.id).eq('relay_of', id).eq('body', '')
      : await db.from('posts').insert({ author: me.id, relay_of: id, body: '' });
    btn.disabled = false;
    if (r.error) return;
    var c = btn.querySelector('.c');
    var n = parseInt(c.textContent || '0', 10) || 0;
    btn.classList.toggle('is-on', !on);
    btn.setAttribute('aria-pressed', String(!on));
    c.textContent = (on ? Math.max(0, n - 1) : n + 1) || '';
    mine.relayed[id] = !on;
  }

  async function bin(btn) {
    if (!confirm('Delete this post? It goes for everyone, and replies to it go with it.')) return;
    var r = await db.from('posts').delete().eq('id', btn.dataset.id).eq('author', me.id);
    if (r.error) return;
    var art = btn.closest('.hd-post');
    if (art) art.remove();
  }

  // ── ROUTING ─────────────────────────────────────────────────────────────

  function parse() {
    var h = (location.hash || '#/home').replace(/^#\/?/, '');
    var qi = h.indexOf('?');
    var q = '';
    if (qi > -1) {
      var sp = new URLSearchParams(h.slice(qi + 1));
      q = sp.get('q') || '';
      h = h.slice(0, qi);
    }
    var bits = h.split('/').filter(Boolean);
    return { seg: bits, q: q };
  }

  var painting = 0;

  async function route() {
    var r = parse();
    var key = r.seg[0] || 'home';
    var token = ++painting;

    var active = key === 'u' && me && r.seg[1] === me.handle ? 'me'
               : key === 'explore' ? 'explore'
               : key === 'home' ? 'home' : '';
    el('rail').innerHTML = railHTML(active);
    el('bar').innerHTML = barHTML(active);
    var w = el('railWrite');
    if (w) w.addEventListener('click', function () {
      if (location.hash !== '#/home') { location.hash = '#/home'; setTimeout(focusComposer, 60); }
      else focusComposer();
    });
    var m = el('railMe');
    if (m) m.addEventListener('click', function () { location.hash = '#/u/' + me.handle; });

    window.scrollTo(0, 0);
    if (key === 'u' && r.seg[1]) await viewProfile(r.seg[1].toLowerCase());
    else if (key === 'p' && r.seg[1]) await viewThread(r.seg[1]);
    else if (key === 'explore') await viewExplore(r.q);
    else await viewHome();

    if (token !== painting) return;
    var back = el('goBack');
    if (back) back.addEventListener('click', function () { history.length > 1 ? history.back() : (location.hash = '#/home'); });
  }

  function focusComposer() {
    var ta = el('cmpBody');
    if (ta) { ta.focus(); ta.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }

  // ── BOOT ────────────────────────────────────────────────────────────────

  H.ready(function () {
    db = H.db();
    me = H.me();

    if (!db) {
      document.body.innerHTML = '<div class="hd-gate"><div class="nb-card nb-card--lg hd-gate-card">' +
        '<h1 class="nb-h3">Hereld could not start</h1>' +
        '<p class="nb-muted">The connection to Hereld did not load. Reload the page, and if it keeps happening the service is down rather than you.</p>' +
        '</div></div>';
      return;
    }
    if (!H.user()) { H.require(); return; }
    if (!me) {
      document.body.innerHTML = '<div class="hd-gate"><div class="nb-card nb-card--lg hd-gate-card">' +
        '<h1 class="nb-h3">Your profile is missing</h1>' +
        '<p class="nb-muted">The account signed in, but there is no profile attached to it. That is ours to fix, not yours.</p>' +
        '<div style="margin-top:18px"><button type="button" class="nb-btn nb-btn--sm" id="outNow">Sign out</button></div>' +
        '</div></div>';
      var b = document.getElementById('outNow');
      if (b) b.addEventListener('click', function () { H.signOut().then(function () { location.href = 'join.html'; }); });
      return;
    }

    col = el('col');
    aside = el('aside');

    document.addEventListener('click', function (e) {
      var act = e.target.closest('[data-act]');
      if (act) {
        e.preventDefault();
        var k = act.dataset.act;
        if (k === 'endorse') endorse(act);
        else if (k === 'relay') relay(act);
        else if (k === 'bin') bin(act);
        else if (k === 'reply') location.hash = '#/p/' + act.dataset.id;
        return;
      }
      var art = e.target.closest('.hd-post[data-open]');
      if (art && !e.target.closest('a, button')) location.hash = '#/p/' + art.dataset.open;
    });

    window.addEventListener('hashchange', route);
    paintAside();
    route();
  });
})();
