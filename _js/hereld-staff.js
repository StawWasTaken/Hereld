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
    { id: 'users',     label: 'People',            ic: 'users',    min: 'moderator' },
    { id: 'posts',     label: 'Posts',             ic: 'quill',    min: 'moderator' },
    { id: 'reports',   label: 'Reports',           ic: 'flag',     min: 'moderator' },
    { id: 'notes',     label: 'Community notes',   ic: 'file',     min: 'moderator' },
    { id: 'companies', label: 'Companies',         ic: 'building', min: 'admin' },
    { id: 'bots',      label: 'Seed accounts',     ic: 'robot',    min: 'admin' },
    { id: 'nova',      label: 'Supernova',         mark: true,     min: 'superadmin' },
    { id: 'staff',     label: 'Staff',             ic: 'shield',   min: 'superadmin' },
    { id: 'platform',  label: 'Platform account',  ic: 'tick',     min: 'superadmin' },
    { id: 'settings',  label: 'Settings',          ic: 'gear',     min: 'admin' },
    { id: 'log',       label: 'Audit log',         ic: 'clock',    min: 'moderator' }
  ];

  /* ── small pieces ───────────────────────────────────────────────────── */

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

  function switchRow(key, title, desc, flagObj, isBad) {
    var checked = flagObj && flagObj.enabled;
    return '<div class="hd-stf-row">' +
      '<span class="hd-stf-who-t"><b>' + esc(title) + '</b><small>' + esc(desc) + '</small></span>' +
      '<label class="nb-switch">' +
      '<input type="checkbox" data-flag="' + esc(key) + '"' + (checked ? ' checked' : '') + '>' +
      '<span class="nb-switch-slider' + (isBad ? ' nb-switch-slider--red' : '') + '"></span>' +
      '</label></div>';
  }

  /* Postgres speaks in constraint names. People do not. */
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

  /* ── shell ──────────────────────────────────────────────────────────── */

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

  /* ── dashboard ────────────────────────────────────────────────        */

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
  }

  function queueCard(page, title, line) {
    return '<button class="nb-card hd-stf-qcard" type="button" data-page="' + page + '">' +
      ic('flag') + '<span><b>' + esc(title) + '</b><small>' + esc(line) + '</small></span>' + ic('back') + '</button>';
  }

  /* ── seed accounts ──────────────────────────────────────────────────── */

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

    node.innerHTML =
      '<div class="hd-stf-tiles hd-stf-tiles--2">' +
        '<div class="nb-card hd-stf-tile"><span class="hd-stf-tile-n">' + total + '</span>' +
          '<span class="hd-stf-tile-l">Seed accounts</span><span class="hd-stf-tile-s">Records that exist</span></div>' +
        '<div class="nb-card hd-stf-tile"><span class="hd-stf-tile-n">' + live + '</span>' +
          '<span class="hd-stf-tile-l">Active now</span><span class="hd-stf-tile-s">Allowed to take part</span></div>' +
      '</div>' +
      switchRow('bots_enabled', 'Seed system', 'While this is off nothing automated runs at all.', flag.bots_enabled) +
      switchRow('bots_emergency', 'Emergency stop', 'Setting this on deactivates every seed account and turns the system off.', flag.bots_emergency, true) +
      '<form class="hd-stf-search" id="stfBotN">' +
        '<label class="nb-label" for="stfBotNi">Accounts allowed to take part</label>' +
        '<input class="nb-input" id="stfBotNi" type="number" min="0" step="1" inputmode="numeric" value="' +
          ((flag.bots_active && flag.bots_active.number) || 0) + '">' +
        '<button class="nb-btn nb-btn--primary" type="submit">Set</button>' +
      '</form>';

    host.querySelector('#stfBotN').addEventListener('submit', async function (e) {
      e.preventDefault();
      var n = parseInt(host.querySelector('#stfBotNi').value, 10) || 0;
      if (await call('staff_set_flag', { p_key: 'bots_active', p_number: n }, 'Saved.')) {
        pageBots(host);
      }
    });

    host.querySelectorAll('[data-flag]').forEach(function (cb) {
      cb.addEventListener('change', async function () {
        var key = cb.dataset.flag;
        var val = cb.checked;
        if (await call('staff_set_flag', { p_key: key, p_bool: val }, 'Updated.')) {
          pageBots(host);
        }
      });
    });
  }

  window.HereldStaff = {
    init: function (database, profile, userRole, gotoFn, urlFn) {
      db = database;
      my = profile;
      role = userRole;
      go = gotoFn;
      url = urlFn;
    }
  };
})();
