/* Hereld accounts.

   Hereld runs on its own Supabase project and its own session. A Hereld
   account is not a Swiftaw account and not a Fortized account, and nothing
   here reaches across to either of them.

   window.Hereld
     .ready(cb)        run cb once the session has been resolved
     .db()             the supabase client
     .user()           the auth user, or null
     .me()             the profile row for the auth user, or null
     .onChange(cb)     cb(user, profile) on every change
     .signIn(email, password)
     .signUp({ email, password, handle, name })
     .signOut()
     .refreshMe()      re-read the profile row
     .require()        send a signed-out visitor to the join page
     .esc(s)           html-escape
     .when(iso)        short relative time
     .at()             the Hereld mark, drawn in place of an @
     .tag(handle)      the mark followed by a handle
     .roster()         the accounts this device has signed into
     .switchTo(id)     move to another one of them
     .forget(id)       drop one from the list
*/
(function () {
  'use strict';
  if (window.Hereld) return;

  var SUPA_URL = 'https://brgwymecsgjmuubfmast.supabase.co';
  var SUPA_KEY = 'sb_publishable__yhsh8Ck_OLfGTPG9DlEsg_Gh9S12L9';
  var SUPA_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  var AUTH_KEY = 'hereld-auth';
  var ROSTER_KEY = 'hereld-accounts';
  var JOIN_PAGE = 'join';

  var db = null, user = null, me = null, isReady = false;
  var readyCbs = [], changeCbs = [];

  window.Hereld = {
    ready: function (cb) { if (isReady) cb(); else readyCbs.push(cb); },
    db: function () { return db; },
    user: function () { return user; },
    me: function () { return me; },
    onChange: function (cb) { changeCbs.push(cb); },
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    refreshMe: refreshMe,
    require: require_,
    joinPage: JOIN_PAGE,
    esc: esc,
    when: when,
    hue: hue,
    avatar: avatar,
    at: at,
    tag: tag,
    trouble: trouble,
    fn: fn,
    roster: roster,
    switchTo: switchTo,
    forget: forget
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Anything older than a week gets a date. "43w" is not information. */
  function when(iso) {
    var t = new Date(iso).getTime();
    if (!t) return '';
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 45) return 'now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 604800) return Math.floor(s / 86400) + 'd';
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  /* A stable colour per handle, so the same person is the same colour on
     every screen without storing anything. */
  function hue(handle) {
    var h = String(handle || ''), n = 0;
    for (var i = 0; i < h.length; i++) n = (n * 31 + h.charCodeAt(i)) % 5;
    return n;
  }

  function avatar(p, cls) {
    var handle = (p && p.handle) || '';
    var name = (p && (p.name || p.handle)) || '?';
    var url = p && p.avatar_url;
    /* A person is a circle and a company is a square, decided here rather
       than at each call site, because a caller that forgets makes a company
       look like a person. */
    var c = 'hd-av' + (cls ? ' ' + cls : '');
    if (p && p.is_company && !/hd-av--sq\b/.test(c)) c += ' hd-av--sq';
    if (url) {
      return '<span class="' + c + '" data-hue="' + hue(handle) + '" ' +
        'style="background-image:url(' + esc(url) + ')" aria-hidden="true"></span>';
    }
    return '<span class="' + c + '" data-hue="' + hue(handle) + '" aria-hidden="true">' +
      esc(String(name).trim().charAt(0).toUpperCase() || '?') + '</span>';
  }

  /* A handle is written with the mark rather than a typed @. It is drawn
     inline at the size of the text and inherits its colour, so it sits on the
     same baseline as the letters after it. The @ still goes to a screen
     reader, because "staw" and "@staw" are not the same thing said aloud. */
  var AT_PATH = 'M256 64C150 64 64 150 64 256s86 192 192 192c17.7 0 32 14.3 32 32s-14.3 32-32 32C114.6 512 0 397.4 0 256S114.6 0 256 0 512 114.6 512 256l0 32c0 53-43 96-96 96-29.3 0-55.6-13.2-73.2-33.9-22.8 21-53.3 33.9-86.8 33.9-70.7 0-128-57.3-128-128s57.3-128 128-128c27.9 0 53.7 8.9 74.7 24.1 5.7-5 13.1-8.1 21.3-8.1 17.7 0 32 14.3 32 32l0 112c0 17.7 14.3 32 32 32s32-14.3 32-32l0-32c0-106-86-192-192-192zm64 192a64 64 0 1 0 -128 0 64 64 0 1 0 128 0z';

  function at(cls) {
    return '<svg class="hd-at' + (cls ? ' ' + cls : '') + '" viewBox="0 0 512 512" ' +
           'aria-hidden="true" focusable="false"><path d="' + AT_PATH + '"/></svg>' +
           '<span class="nb-sr">@</span>';
  }

  function tag(handle, cls) {
    return at(cls) + '<span class="hd-at-h">' + esc(handle || '') + '</span>';
  }

  /* Supabase speaks in constraint names. People do not. */
  /* ── Reaching the server side ─────────────────────────────────────────────
     Anything that needs a provider key happens in the Supernova function, not
     here, because a key in a page is a key everybody has. This posts to it
     with whoever is signed in, and hands back whatever the function said went
     wrong rather than a shrug. */
  async function fn(job, body) {
    var s = await db.auth.getSession();
    var token = (s.data && s.data.session && s.data.session.access_token) || SUPA_KEY;
    var r = await fetch(SUPA_URL + '/functions/v1/' + job, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: SUPA_KEY,
        authorization: 'Bearer ' + token
      },
      body: JSON.stringify(body || {})
    });
    var out = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(out.error || 'That did not go through.');
    return out;
  }

  function trouble(err, fallback) {
    var m = (err && (err.message || err.error_description)) || '';
    if (/duplicate key|already exists|unique/i.test(m)) return 'That handle is taken. Try another one.';
    if (/invalid login credentials/i.test(m)) return 'That email and password do not match an account.';
    if (/email not confirmed/i.test(m)) return 'Confirm your email first. The link is in your inbox.';
    if (/rate limit|too many/i.test(m)) return 'Too many tries. Give it a minute.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Could not reach Hereld. Check your connection.';
    return m || fallback || 'Something went wrong.';
  }

  /* ── More than one account on one device ───────────────────────────────
     Signing in a second account does not sign the first one out. The tokens
     for each are kept side by side and swapped in when you pick a name, the
     same tokens the session already keeps on this device, so switching costs
     nothing and asks for nothing. Signing out drops only the account you
     signed out of. */

  function readRoster() {
    try {
      var raw = localStorage.getItem(ROSTER_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function writeRoster(list) {
    try { localStorage.setItem(ROSTER_KEY, JSON.stringify(list.slice(0, 8))); } catch (e) {}
  }

  function roster() {
    var here = user && user.id;
    return readRoster().map(function (a) {
      return { id: a.id, handle: a.handle, name: a.name, avatar_url: a.avatar_url,
               is_company: !!a.is_company, current: a.id === here };
    });
  }

  /* Called whenever the session settles or is refreshed, because a refresh
     token is spent once. Holding a stale one would send somebody to the sign
     in page for an account they never left. */
  async function remember(session) {
    if (!session || !session.user || !session.refresh_token) return;
    var p = me && me.id === session.user.id ? me : null;
    var list = readRoster().filter(function (a) { return a.id !== session.user.id; });
    var was = readRoster().filter(function (a) { return a.id === session.user.id; })[0] || {};
    list.unshift({
      id: session.user.id,
      handle: (p && p.handle) || was.handle || '',
      name: (p && p.name) || was.name || '',
      avatar_url: p ? p.avatar_url : was.avatar_url || null,
      is_company: p ? !!p.is_company : !!was.is_company,
      access_token: session.access_token,
      refresh_token: session.refresh_token
    });
    writeRoster(list);
  }

  function forget(id) {
    writeRoster(readRoster().filter(function (a) { return a.id !== id; }));
  }

  async function switchTo(id) {
    var a = readRoster().filter(function (x) { return x.id === id; })[0];
    if (!a) throw new Error('That account is not signed in on this device.');
    if (user && user.id === id) return me;
    var r = await db.auth.setSession({ access_token: a.access_token, refresh_token: a.refresh_token });
    if (r.error) {
      /* The stored token no longer works. Say so and take the dead entry out
         rather than leave a name in the list that cannot be reached. */
      forget(id);
      throw new Error('That account needs signing in again.');
    }
    user = (r.data && r.data.user) || (r.data && r.data.session && r.data.session.user) || null;
    await refreshMe();
    await remember(r.data && r.data.session);
    fire();
    return me;
  }

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.async = true; s.onload = res; s.onerror = function () { rej(new Error('cdn')); };
      document.head.appendChild(s);
    });
  }

  function fire() {
    changeCbs.forEach(function (cb) { try { cb(user, me); } catch (e) {} });
  }

  async function refreshMe() {
    if (!user) { me = null; return null; }
    var r = await db.from('profiles').select('*').eq('id', user.id).maybeSingle();
    me = r.error ? null : r.data;
    return me;
  }

  async function signIn(email, password) {
    var r = await db.auth.signInWithPassword({ email: email, password: password });
    if (r.error) throw r.error;
    user = r.data.user;
    await refreshMe();
    await remember(r.data.session);
    fire();
    return r.data;
  }

  /* The handle is claimed by a trigger on the auth user, reading the metadata
     written here. Claiming it client-side would leave a window where an
     account exists with no name to it. */
  async function signUp(a) {
    var r = await db.auth.signUp({
      email: a.email,
      password: a.password,
      options: { data: { handle: a.handle, name: a.name || a.handle } }
    });
    if (r.error) throw r.error;
    if (r.data.session) {
      user = r.data.user;
      await refreshMe();
      await remember(r.data.session);
      fire();
    }
    return r.data;
  }

  /* Signing out takes this account off the device. Any other account signed
     in here stays signed in, and the first one left steps forward. */
  async function signOut() {
    var leaving = user && user.id;
    try { await db.auth.signOut(); } catch (e) {}
    user = null; me = null;
    if (leaving) forget(leaving);

    var next = readRoster()[0];
    if (next) {
      try { await switchTo(next.id); return me; } catch (e) {}
    }
    fire();
    return null;
  }

  function require_() {
    if (user) return true;
    var back = location.pathname.split('/').pop().replace(/\.html$/, '') + location.search;
    location.replace(JOIN_PAGE + '?next=' + encodeURIComponent(back));
    return false;
  }

  function done() {
    isReady = true;
    readyCbs.splice(0).forEach(function (cb) { try { cb(); } catch (e) {} });
    fire();
  }

  (async function boot() {
    try {
      if (!(window.supabase && window.supabase.createClient)) await loadScript(SUPA_CDN);
      db = window.supabase.createClient(SUPA_URL, SUPA_KEY, {
        auth: { storageKey: AUTH_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      var s = await db.auth.getSession();
      var session = (s.data && s.data.session) || null;
      user = (session && session.user) || null;
      if (user) { await refreshMe(); await remember(session); }

      db.auth.onAuthStateChange(function (evt, session) {
        var next = (session && session.user) || null;
        var same = (next && next.id) === (user && user.id);
        user = next;
        if (!next) { me = null; fire(); return; }
        if (!same) refreshMe().then(function () { remember(session); fire(); });
        else if (evt === 'TOKEN_REFRESHED') remember(session);
      });
    } catch (e) {
      db = null;
    }
    done();
  })();
})();
