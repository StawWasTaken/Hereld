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
*/
(function () {
  'use strict';
  if (window.Hereld) return;

  var SUPA_URL = 'https://brgwymecsgjmuubfmast.supabase.co';
  var SUPA_KEY = 'sb_publishable__yhsh8Ck_OLfGTPG9DlEsg_Gh9S12L9';
  var SUPA_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  var AUTH_KEY = 'hereld-auth';
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
    trouble: trouble
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
    var c = 'hd-av' + (cls ? ' ' + cls : '');
    if (url) {
      return '<span class="' + c + '" data-hue="' + hue(handle) + '" ' +
        'style="background-image:url(' + esc(url) + ')" aria-hidden="true"></span>';
    }
    return '<span class="' + c + '" data-hue="' + hue(handle) + '" aria-hidden="true">' +
      esc(String(name).trim().charAt(0).toUpperCase() || '?') + '</span>';
  }

  /* Hereld's mark is a horn with an @ coiled inside it, so a handle is
     written with the mark rather than a typed @. It is a mask, so it inherits
     the colour of the text around it. The @ still goes to a screen reader,
     because "staw" and "@staw" are not the same thing said aloud. */
  function at(cls) {
    return '<i class="hd-at' + (cls ? ' ' + cls : '') + '" aria-hidden="true"></i>' +
           '<span class="nb-sr">@</span>';
  }

  function tag(handle, cls) {
    return at(cls) + esc(handle || '');
  }

  /* Supabase speaks in constraint names. People do not. */
  function trouble(err, fallback) {
    var m = (err && (err.message || err.error_description)) || '';
    if (/duplicate key|already exists|unique/i.test(m)) return 'That handle is taken. Try another one.';
    if (/invalid login credentials/i.test(m)) return 'That email and password do not match an account.';
    if (/email not confirmed/i.test(m)) return 'Confirm your email first. The link is in your inbox.';
    if (/rate limit|too many/i.test(m)) return 'Too many tries. Give it a minute.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Could not reach Hereld. Check your connection.';
    return m || fallback || 'Something went wrong.';
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
      fire();
    }
    return r.data;
  }

  async function signOut() {
    try { await db.auth.signOut(); } catch (e) {}
    user = null; me = null;
    fire();
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
      user = (s.data && s.data.session && s.data.session.user) || null;
      if (user) await refreshMe();

      db.auth.onAuthStateChange(function (_evt, session) {
        var next = (session && session.user) || null;
        var same = (next && next.id) === (user && user.id);
        user = next;
        if (!next) { me = null; fire(); return; }
        if (!same) refreshMe().then(fire);
      });
    } catch (e) {
      db = null;
    }
    done();
  })();
})();
