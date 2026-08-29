# Hereld

A professional network. Part of the Swiftaw ecosystem.

Hereld runs on its own Supabase project and its own session. A Hereld account
is not a Swiftaw account and not a Fortized account, and nothing in this repo
reaches across to either of them.

## Before it works: run the migration

`supabase/migrations/2026-08-29-hereld-core.sql` has to be run once, by hand,
in the Hereld project's SQL editor. It is idempotent, so running it twice is
safe. It creates the tables, the row level security, the counter triggers, the
`feed` and `handle_free` functions, and the public `avatars` storage bucket.

Nothing on the site works before that runs: sign-up will fail, because the
profile is created by a database trigger rather than by the browser.

Two settings live in the Supabase dashboard rather than in the file:

- **Email confirmation.** If it is on, `join.html` shows a "check your email"
  panel instead of signing the person straight in. Both paths are handled.
- **Site URL and redirect URLs.** These need to point at wherever Hereld is
  served from, or confirmation links come back to the wrong place.

## Layout

    _css/     stylesheet sources
    _js/      script sources
    css/      built output, both CSS and JS. This is what the pages load.
    _build/   the build step and the HTML comment stripper
    supabase/ the migration

Everything at the root is flat and every path in the HTML is relative, so the
site works unchanged under a project path (`/Hereld/`) and at a domain root
later.

## Build

    node _build/min.mjs            build css/ from _css/ and _js/
    node _build/min.mjs --check    fail if css/ is stale
    node _build/clean-html.mjs index.html app.html join.html settings.html 404.html

The HTML pages are both source and output: write comments while working on
them, strip them before committing.

## The design system

`_css/hereld-nb.css` is a copy of Swiftaw's `_css/swiftaw-nb.css`, vendored
here so Hereld does not depend on another origin being up for its own layout.
Swiftaw is the source of truth. To pull a change across:

1. Edit `_css/swiftaw-nb.css` in the Swiftaw repo.
2. Copy it over `_css/hereld-nb.css` here.
3. Change the Tropicon `@font-face` URL back from `/Tropicon-Regular.otf` to
   `../Tropicon-Regular.otf`. The absolute path resolves against the site root,
   which is not where the font sits here.
4. `node _build/min.mjs`

`_css/hereld.css` is Hereld's own layer on top: the blue brand override, the
app shell, the feed and everything else that is Hereld rather than Swiftaw.

## Pages

    index.html     the landing page
    join.html      sign up and sign in, one card, ?mode=in for sign in
    app.html       the app. Hash routed: #/home #/explore #/u/<handle> #/p/<id>
    settings.html  profile editor
    404.html
