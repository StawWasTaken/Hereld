/* Supernova, for Hereld.
 *
 * Five jobs, one door:
 *   ask       the Ask Supernova chat, asked by a signed-in person
 *   mentions  answer the posts that called @supernova into a thread
 *   notes     wrap up the context people have added to a post
 *   seed      let a seed account take its turn (posts, replies, likes,
 *             reposts, profile edits)
 *   bot_new   create a new seed account
 *
 * The provider key lives in one database row that no browser can read. This
 * function reaches it with the service role, which is held here and is never
 * sent to a page. If you find yourself about to put a key in the client to
 * save a hop, that is the hop.
 *
 * Deploy:
 *   supabase functions deploy supernova --project-ref brgwymecsgjmuubfmast
 * Secrets it needs (set once, in the project, not in this file):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   given by the platform
 *   HERELD_CRON_SECRET                        your own string, for the timer
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const NOTE_OPENER = 'The users have added context to this post';

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' }
  });
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

type Config = { provider: string; model: string; api_key: string; system_note: string };

async function config(): Promise<Config | null> {
  const { data } = await admin.from('ai_config').select('*').eq('id', true).maybeSingle();
  if (!data || !data.api_key || !data.model) return null;
  return data as Config;
}

/* One shape in, one string out. Every provider here speaks a chat of turns
   with a system line above it; the differences are the URL, the header the
   key goes in, and where the answer sits in the reply. */
async function think(c: Config, system: string, turns: { role: string; text: string }[], cap = 700) {
  const msgs = turns.map((t) => ({ role: t.role === 'you' ? 'assistant' : 'user', content: t.text }));

  if (c.provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': c.api_key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model: c.model, max_tokens: cap, system, messages: msgs })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message || 'The provider refused that.');
    return {
      text: (j.content || []).map((b: any) => b.text || '').join('').trim(),
      inTok: j.usage?.input_tokens || 0,
      outTok: j.usage?.output_tokens || 0
    };
  }

  const url =
    c.provider === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions'
    : c.provider === 'mistral' ? 'https://api.mistral.ai/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + c.api_key },
    body: JSON.stringify({
      model: c.model,
      max_tokens: cap,
      messages: [{ role: 'system', content: system }, ...msgs]
    })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || 'The provider refused that.');
  return {
    text: (j.choices?.[0]?.message?.content || '').trim(),
    inTok: j.usage?.prompt_tokens || 0,
    outTok: j.usage?.completion_tokens || 0
  };
}

function log(who: string | null, kind: string, model: string, u: any, ok = true, detail = '') {
  return admin.from('ai_calls').insert({
    asked_by: who, kind, model,
    tokens_in: u?.inTok || 0, tokens_out: u?.outTok || 0,
    ok, detail: detail.slice(0, 300)
  });
}

/* House style. Hereld is dark, plain-spoken and British, and it does not use
   the long dash. Saying so once here is cheaper than editing every answer. */
const HOUSE =
  'Write in British English. Plain, direct sentences. Never use an em dash; ' +
  'use a hyphen. No headings, no bullet lists unless asked, no emoji unless ' +
  'the person used one first. Do not open with a compliment or a summary of ' +
  'the question. If you do not know something, say so in one line.';

async function whoIsAsking(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const { data } = await admin.auth.getUser(jwt);
  return data?.user?.id || null;
}

/* ── What Supernova is allowed to know ─────────────────────────────────────
   Everything here is read with the service role, so it is deliberately kept
   to what the person asking could already see for themselves: public posts,
   public profiles, and their own account. Nothing private is gathered, and
   the model is told plainly that this is the whole of what it knows. */

const STOP = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'from', 'what',
  'who', 'why', 'how', 'when', 'where', 'about', 'does', 'did', 'was', 'were',
  'are', 'you', 'your', 'has', 'have', 'been', 'they', 'their', 'them', 'her',
  'his', 'its', 'into', 'over', 'than', 'then', 'there', 'here', 'post', 'posts']);

function terms(q: string) {
  return String(q || '').toLowerCase().replace(/[^a-z0-9@# ]+/g, ' ').split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w))
    .sort((a, b) => b.length - a.length).slice(0, 4);
}

function said(p: any) {
  const who = p.author ? (p.author.name || p.author.handle) : 'someone';
  const at = p.created_at ? new Date(p.created_at).toISOString().slice(0, 10) : '';
  return '- @' + (p.author?.handle || '?') + ' (' + who + ')' + (at ? ', ' + at : '') +
    ': ' + String(p.body || '').replace(/\s+/g, ' ').slice(0, 280);
}

const WITH_WHO = '*, author:profiles!posts_author_fkey(id,handle,name,headline,verified,is_company)';

/* Enhanced gather: uses post_context and profile_lookup RPCs for richer
   context. Falls back to the old approach if the RPCs are not available. */
async function gather(uid: string, question: string, postId?: string) {
  const bits: string[] = [];

  const { data: me } = await admin.from('profiles')
    .select('handle,name,headline,bio,follower_count,following_count,is_company,created_at')
    .eq('id', uid).maybeSingle();
  if (me) {
    bits.push('Who is asking: @' + me.handle + ' (' + (me.name || me.handle) + ')' +
      (me.is_company ? ', a company account' : '') +
      (me.headline ? '. Headline: ' + me.headline : '') +
      (me.bio ? '. About: ' + String(me.bio).slice(0, 200) : '') +
      '. Followers ' + (me.follower_count || 0) + ', following ' + (me.following_count || 0) +
      '. On Hereld since ' + String(me.created_at).slice(0, 10) + '.');
  }

  if (postId) {
    /* Try the rich context RPC first. */
    const { data: ctx } = await admin.rpc('post_context', { p_post: postId });
    if (ctx) {
      const p = ctx.post;
      const a = ctx.author;
      bits.push('The post in question:\n- @' + a.handle + ' (' + (a.name || a.handle) + ')' +
        (a.headline ? ', ' + a.headline : '') +
        ', followers ' + (a.follower_count || 0) + ', ' + (a.post_count || 0) + ' posts.' +
        '\nPost: ' + String(p.body || '').replace(/\s+/g, ' ').slice(0, 500) +
        '\nEngagement: ' + (p.endorse_count || 0) + ' likes, ' +
        (p.reply_count || 0) + ' replies, ' + (p.relay_count || 0) + ' reposts.');

      if (ctx.chain?.length) {
        bits.push('Full thread chain (oldest to newest):\n' + ctx.chain.map((c: any) =>
          '- @' + c.author_handle + ' (' + (c.author_name || c.author_handle) + '): ' +
          String(c.body || '').replace(/\s+/g, ' ').slice(0, 280)
        ).join('\n'));
      }

      if (ctx.parent) {
        bits.push('Direct parent:\n- @' + ctx.parent.author_handle +
          ': ' + String(ctx.parent.body || '').replace(/\s+/g, ' ').slice(0, 300));
      }

      if (ctx.thread?.length) {
        bits.push('Replies to this post (' + ctx.thread.length + '):\n' + ctx.thread.map((r: any) =>
          '- @' + r.author_handle + ': ' + String(r.body || '').replace(/\s+/g, ' ').slice(0, 200)
        ).join('\n'));
      }
    } else {
      /* Fallback to old approach. */
      const { data: p } = await admin.from('posts').select(WITH_WHO).eq('id', postId).maybeSingle();
      if (p) {
        bits.push('The post in question:\n' + said(p));
        const { data: kids } = await admin.from('posts').select(WITH_WHO)
          .eq('reply_to', postId).order('created_at', { ascending: true }).limit(8);
        if (kids?.length) bits.push('Replies to it:\n' + kids.map(said).join('\n'));
      }
    }
  }

  /* If the question mentions a @handle, look up that profile. */
  const handleMatch = question.match(/@([a-z0-9_]{3,20})/i);
  if (handleMatch) {
    const { data: prof } = await admin.rpc('profile_lookup', { p_handle: handleMatch[1] });
    if (prof) {
      bits.push('Profile of @' + prof.handle + ': ' + (prof.name || prof.handle) +
        (prof.headline ? ', ' + prof.headline : '') +
        (prof.bio ? '. Bio: ' + String(prof.bio).slice(0, 200) : '') +
        '. Followers ' + (prof.follower_count || 0) + ', ' + (prof.post_count || 0) + ' posts.' +
        (prof.location ? ', based in ' + prof.location : '') +
        '. On Hereld since ' + String(prof.created_at).slice(0, 10) + '.');
      if (prof.recent_posts?.length) {
        bits.push('Recent posts by @' + prof.handle + ':\n' + prof.recent_posts.map((rp: any) =>
          '- ' + String(rp.body || '').replace(/\s+/g, ' ').slice(0, 200) +
          ' (' + (rp.endorse_count || 0) + ' likes, ' + (rp.reply_count || 0) + ' replies)'
        ).join('\n'));
      }
    }
  }

  const words = terms(question);
  if (words.length) {
    const { data: found } = await admin.rpc('search_posts', { p_q: words.join(' '), p_limit: 6 })
      .select(WITH_WHO);
    if (found?.length) bits.push('Other posts on Hereld that may be related:\n' + found.map(said).join('\n'));

    const like = '%' + words[0] + '%';
    const { data: people } = await admin.from('profiles')
      .select('handle,name,headline,follower_count,verified,is_company')
      .or('handle.ilike.' + like + ',name.ilike.' + like + ',headline.ilike.' + like)
      .eq('banned', false).order('follower_count', { ascending: false }).limit(4);
    if (people?.length) {
      bits.push('Accounts that may be related:\n' + people.map((x: any) =>
        '- @' + x.handle + ' (' + (x.name || x.handle) + ')' +
        (x.verified ? ', verified' : '') + (x.is_company ? ', a company' : '') +
        (x.headline ? ': ' + x.headline : '')).join('\n'));
    }
  }

  return bits.join('\n\n');
}

/* ── Ask Supernova ─────────────────────────────────────────────────────── */

async function ask(req: Request, c: Config, uid: string) {
  const { turns, post } = await req.json().catch(() => ({ turns: [] }));
  const talk = Array.isArray(turns) ? turns.slice(-20) : [];
  if (!talk.length) return reply({ error: 'Nothing was asked.' }, 400);

  const { data: allow } = await admin.rpc('ai_allowance', { p_user: uid });
  if (allow && (allow.used_hour >= allow.per_hour || allow.used_day >= allow.per_day)) {
    return reply({ error: 'You have asked Supernova a lot today. Try again later.' }, 429);
  }

  const { data: me } = await admin.from('profiles').select('handle,name').eq('id', uid).maybeSingle();

  const system =
    'You are Supernova, the assistant built into Hereld, which is a public ' +
    'posting platform made by Swiftaw. ' + HOUSE + ' ' +
    'You are talking to ' + (me?.name || me?.handle || 'someone') + '. ' +
    'You can answer general questions and questions about Hereld. You cannot ' +
    'post, follow, block, delete or moderate on anyone\'s behalf, and you must ' +
    'say so rather than pretend. Do not invent Hereld features, numbers or ' +
    'policies; if you are not sure a feature exists, say you are not sure. ' +
    'You have access to Hereld\'s data - profiles, posts, engagement numbers. ' +
    'Use it to answer questions about the platform and its users accurately. ' +
    (c.system_note || '');

  const seen = await gather(uid, talk[talk.length - 1]?.text || '', typeof post === 'string' ? post : undefined);
  const system2 = seen
    ? system + '\n\nHere is what was found on Hereld for this question. It is ' +
      'public material only, and it is all you have: do not claim to know ' +
      'anything else about Hereld, and do not invent posts, accounts or ' +
      'numbers. If it does not answer the question, say so.\n\n' + seen
    : system;

  try {
    const out = await think(c, system2, talk, 1200);
    await log(uid, 'ask', c.model, out);
    return reply({ text: out.text });
  } catch (e) {
    await log(uid, 'ask', c.model, null, false, String(e));
    return reply({ error: 'Supernova could not answer that just now.' }, 502);
  }
}

/* ── Being called into a thread ────────────────────────────────────────────
   Somebody writes @supernova in a post and an answer arrives under it. The
   answer is written by the supernova account itself, so it carries that name
   and can be seen, reported and replied to like anything else. A post is
   answered once: the check is whether that account has already replied.

   Enhanced: reads the full post context including thread, author info, and
   engagement numbers. */

async function mentions(c: Config) {
  const { data: nova } = await admin.from('profiles').select('id,handle')
    .eq('handle', 'supernova').maybeSingle();
  if (!nova) return reply({ error: 'There is no supernova account yet.' }, 503);

  const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  const { data: called } = await admin.from('posts').select(WITH_WHO)
    .ilike('body', '%@supernova%').gte('created_at', since)
    .neq('author', nova.id)
    .order('created_at', { ascending: true }).limit(20);

  const done: string[] = [];
  for (const p of called || []) {
    const { count } = await admin.from('posts').select('id', { count: 'exact', head: true })
      .eq('reply_to', p.id).eq('author', nova.id);
    if (count) continue;

    /* Build rich context for the reply. */
    let context = '';

    /* Try the rich context RPC. */
    const { data: ctx } = await admin.rpc('post_context', { p_post: p.id });
    if (ctx) {
      const a = ctx.author;
      context = 'Post by @' + a.handle + ' (' + (a.name || a.handle) + ')' +
        (a.headline ? ', ' + a.headline : '') +
        ', followers ' + (a.follower_count || 0) + '.\n' +
        'Post (' + (ctx.post.endorse_count || 0) + ' likes, ' +
        (ctx.post.reply_count || 0) + ' replies, ' +
        (ctx.post.relay_count || 0) + ' reposts):\n' +
        String(ctx.post.body || '').replace(/\s+/g, ' ').slice(0, 600);

      if (ctx.chain?.length) {
        context += '\n\nFull conversation chain:\n' + ctx.chain.map((c: any) =>
          '- @' + c.author_handle + ': ' + String(c.body || '').replace(/\s+/g, ' ').slice(0, 240)
        ).join('\n');
      }

      if (ctx.parent) {
        context += '\n\nDirect parent:\n- @' + ctx.parent.author_handle +
          ': ' + String(ctx.parent.body || '').replace(/\s+/g, ' ').slice(0, 300);
      }

      if (ctx.thread?.length) {
        context += '\n\nOther replies in this thread:\n' + ctx.thread.map((r: any) =>
          '- @' + r.author_handle + ': ' + String(r.body || '').replace(/\s+/g, ' ').slice(0, 200)
        ).join('\n');
      }
    } else {
      /* Fallback. */
      let thread = '';
      if (p.reply_to) {
        const { data: parent } = await admin.from('posts').select(WITH_WHO).eq('id', p.reply_to).maybeSingle();
        if (parent) thread = '\n\nIt is a reply to:\n' + said(parent);
      }
      context = said(p) + thread;
    }

    const asked = String(p.body || '').replace(/@supernova/gi, '').trim();
    const system =
      'You are Supernova, the assistant built into Hereld. ' + HOUSE + ' ' +
      'Somebody has called you into a public thread by writing @supernova. ' +
      'Answer them in under 80 words, in one paragraph, as a reply that will ' +
      'be posted publicly under their post. You can see the full context: the ' +
      'post, the author\'s profile, the thread, and engagement numbers. Use ' +
      'this to give a thoughtful, contextual reply. Do not greet them, do not ' +
      'sign off, and do not repeat their question back. If they have not actually ' +
      'asked anything, say in one line that you are not sure what they want. ' +
      'Never invent posts, accounts, numbers or Hereld features. ' +
      (c.system_note || '');

    try {
      const out = await think(c, system,
        [{ role: 'them', text: 'Context:\n' + context + '\n\nTheir message:\n' +
          (asked || String(p.body || '')) }], 280);
      const text = (out.text || '').trim().slice(0, 500);
      if (!text) continue;

      const made = await admin.from('posts').insert({ author: nova.id, body: text, reply_to: p.id });
      if (made.error) continue;
      await log(p.author?.id || null, 'mention', c.model, out);
      done.push(p.id);
    } catch (e) {
      await log(null, 'mention', c.model, null, false, String(e));
    }
  }

  return reply({ answered: done.length });
}

/* ── The wrap-up under a post ────────────────────────────────────────────
   Enhanced: reads every contribution, cross-references the original post
   and thread, and writes a thorough summary. */

async function notes(c: Config) {
  const { data: due } = await admin.rpc('notes_awaiting', { p_limit: 5 });
  const done: string[] = [];

  for (const row of due || []) {
    const { data: post } = await admin.from('posts').select('body,endorse_count,reply_count,relay_count')
      .eq('id', row.post_id).maybeSingle();
    const { data: bits } = await admin
      .from('community_notes')
      .select('body,source,author')
      .eq('post_id', row.post_id)
      .neq('status', 'rejected')
      .order('created_at')
      .limit(30);
    if (!bits || bits.length < 3) continue;

    /* Fetch author info for each contribution. */
    const authorIds = [...new Set(bits.map((b: any) => b.author).filter(Boolean))];
    let authorMap: Record<string, any> = {};
    if (authorIds.length) {
      const { data: authors } = await admin.from('profiles')
        .select('id,handle,name')
        .in('id', authorIds);
      (authors || []).forEach((a: any) => { authorMap[a.id] = a; });
    }

    const system =
      'People reading a post on Hereld have added context to it. Write one ' +
      'thorough summary of what they added, for readers of that post. ' + HOUSE + ' ' +
      'Rules you must follow: begin with exactly "' + NOTE_OPENER + '" and ' +
      'carry straight on from there in the same sentence. Say only what the ' +
      'contributions say; add nothing of your own and no opinion about whether ' +
      'the post is good or bad. Where they disagree, say they disagree. ' +
      'Attribute points to their sources when given. Under 120 words. No dashes. ' +
      (c.system_note || '');

    const asked =
      'The post said:\n' + (post?.body || '').slice(0, 900) +
      (post ? '\nEngagement: ' + (post.endorse_count || 0) + ' likes, ' +
        (post.reply_count || 0) + ' replies, ' + (post.relay_count || 0) + ' reposts.' : '') +
      '\n\nWhat people added (' + bits.length + ' contributions):\n' +
      bits.map((b: any, i: number) => {
        const author = authorMap[b.author];
        const who = author ? ('@' + author.handle + ' (' + (author.name || author.handle) + ')') : 'Anonymous';
        return (i + 1) + '. [' + who + '] ' + b.body + (b.source ? ' [source: ' + b.source + ']' : '');
      }).join('\n');

    try {
      const out = await think(c, system, [{ role: 'them', text: asked }], 400);
      let text = out.text.replace(/[—–]/g, '-').trim();
      if (!text.toLowerCase().startsWith(NOTE_OPENER.toLowerCase())) {
        await log(null, 'note_summary', c.model, out, false, 'opener missing');
        continue;
      }
      if (text.length < 40) { await log(null, 'note_summary', c.model, out, false, 'too short'); continue; }
      text = text.slice(0, 900);

      await admin.from('note_summaries').upsert({
        post_id: row.post_id, body: text, from_count: bits.length, model: c.model, made_at: new Date().toISOString()
      });
      await log(null, 'note_summary', c.model, out);
      done.push(row.post_id);
    } catch (e) {
      await log(null, 'note_summary', c.model, null, false, String(e));
    }
  }
  return reply({ wrapped: done.length });
}

/* ── Seed accounts ───────────────────────────────────────────────────────
   Enhanced: handles posts, replies, likes, reposts, and profile edits.
   Also auto-creates new accounts when the active count exceeds existing. */

async function seed(c: Config) {
  /* Auto-create bots if needed. */
  const { data: needCreate } = await admin.rpc('bot_auto_create', { p_count: 2 });
  if (needCreate && needCreate > 0) {
    for (let i = 0; i < needCreate; i++) {
      const { data: persona } = await admin.rpc('bot_suggest_persona');
      if (!persona) continue;

      const regions = [
        { tz: -5, handle_suffix: 'nyc' },
        { tz: -6, handle_suffix: 'chi' },
        { tz: -8, handle_suffix: 'la' },
        { tz: 0, handle_suffix: 'ldn' },
        { tz: 1, handle_suffix: 'par' },
        { tz: 1, handle_suffix: 'ber' },
        { tz: 3, handle_suffix: 'mow' },
        { tz: 2, handle_suffix: 'cai' },
        { tz: 9, handle_suffix: 'tyo' },
        { tz: 8, handle_suffix: 'sha' },
        { tz: 10, handle_suffix: 'syd' }
      ];
      const weights = [0.20, 0.10, 0.12, 0.15, 0.10, 0.08, 0.05, 0.05, 0.08, 0.05, 0.02];
      let pick = Math.random();
      let cumulative = 0;
      let region = regions[0];
      for (let j = 0; j < weights.length; j++) {
        cumulative += weights[j];
        if (pick < cumulative) { region = regions[j]; break; }
      }

      const name = (persona as any).name || 'User';
      const handle = name.toLowerCase() + '_' + region.handle_suffix + '_' + Math.random().toString(36).slice(2, 6);

      /* Create the auth user. */
      const made = await admin.auth.admin.createUser({
        email: 'seed+' + handle + '@hereld.invalid',
        password: crypto.randomUUID() + crypto.randomUUID(),
        email_confirm: true,
        user_metadata: { handle, name }
      });
      if (made.error || !made.data?.user) continue;

      const id = made.data.user.id;

      await admin.from('profiles').update({ is_bot: true }).eq('id', id);
      const { error: botErr } = await admin.from('bots').insert({
        id,
        persona: String((persona as any).persona || '').slice(0, 400),
        interests: String((persona as any).interests || '').slice(0, 300),
        cooldown_min: 60 + Math.floor(Math.random() * 120),
        timezone_offset: region.tz,
        active: false
      });

      if (botErr) {
        await admin.auth.admin.deleteUser(id);
        continue;
      }

      await admin.from('bot_log').insert({ bot: id, kind: 'created', detail: '@' + handle + ' (auto)' });
    }
  }

  /* Decide what is owed before working out what is due. */
  await admin.rpc('bot_fill', { p_limit: 5 });

  const { data: due } = await admin.rpc('bot_due', { p_limit: 3 });
  let made = 0;

  for (const b of due || []) {
    let asked: string;
    let parent: any = null;

    if (b.kind === 'reply' && b.about) {
      const { data } = await admin.from('posts').select('body').eq('id', b.about).maybeSingle();
      parent = data;
      if (!parent) { await admin.from('bot_queue').update({ done_at: new Date().toISOString() }).eq('id', b.queue_id); continue; }
      asked = 'Somebody posted:\n' + String(parent.body).slice(0, 600) + '\n\nWrite your reply.';
    } else if (b.kind === 'post') {
      const { data: line } = await admin.rpc('the_cry', { p_limit: 6 });
      const topics = (line as any)?.topics || [];
      asked = 'Write one post. Things being talked about right now: ' +
        topics.map((t: any) => '#' + t.tag).join(', ') + '.';
    } else if (b.kind === 'like' && b.about) {
      /* Like: just endorse the post. */
      const { error: likeErr } = await admin.from('endorsements').insert({
        post_id: b.about, user_id: b.bot
      });
      if (!likeErr) {
        await admin.rpc('bot_acted', { p_bot: b.bot, p_queue: b.queue_id });
        await admin.from('bot_log').insert({ bot: b.bot, kind: 'like', detail: 'liked ' + b.about });
        made++;
      } else {
        await admin.from('bot_queue').update({ done_at: new Date().toISOString() }).eq('id', b.queue_id);
      }
      continue;
    } else if (b.kind === 'repost' && b.about) {
      /* Repost: create a relay post. */
      const { error: relayErr } = await admin.from('posts').insert({
        author: b.bot, body: '', relay_of: b.about
      });
      if (!relayErr) {
        await admin.rpc('bot_acted', { p_bot: b.bot, p_queue: b.queue_id });
        await admin.from('bot_log').insert({ bot: b.bot, kind: 'repost', detail: 'reposted ' + b.about });
        made++;
      } else {
        await admin.from('bot_queue').update({ done_at: new Date().toISOString() }).eq('id', b.queue_id);
      }
      continue;
    } else if (b.kind === 'profile_edit') {
      /* Profile edit: fill in missing fields using AI. */
      const { data: profile } = await admin.from('profiles')
        .select('handle,name,headline,bio,location,avatar_url')
        .eq('id', b.bot).maybeSingle();
      if (!profile) {
        await admin.from('bot_queue').update({ done_at: new Date().toISOString() }).eq('id', b.queue_id);
        continue;
      }

      const missing: string[] = [];
      if (!profile.headline) missing.push('headline');
      if (!profile.bio) missing.push('bio');
      if (!profile.location) missing.push('location');
      if (!profile.avatar_url) missing.push('avatar_url');

      const system =
        'You are filling in a profile on Hereld, a professional network. ' + HOUSE + ' ' +
        'The account represents: ' + (b.persona || 'an ordinary person') + '. ' +
        'Write a JSON object with these keys (only the missing ones): ' +
        'headline (max 120 chars), bio (max 400 chars), location (a real city name). ' +
        'Do not use markdown. Do not add emoji. Keep it brief and natural.';

      try {
        const out = await think(c, system,
          [{ role: 'them', text: 'Missing fields: ' + missing.join(', ') + '. Account handle: @' + profile.handle }], 300);

        /* Parse the JSON from the response. */
        const jsonMatch = out.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const update: any = {};
          if (parsed.headline && !profile.headline) update.headline = String(parsed.headline).slice(0, 120);
          if (parsed.bio && !profile.bio) update.bio = String(parsed.bio).slice(0, 400);
          if (parsed.location && !profile.location) update.location = String(parsed.location).slice(0, 100);

          if (Object.keys(update).length) {
            await admin.from('profiles').update(update).eq('id', b.bot);
          }
        }

        await admin.rpc('bot_acted', { p_bot: b.bot, p_queue: b.queue_id });
        await admin.from('bot_log').insert({ bot: b.bot, kind: 'profile_edit', detail: 'filled: ' + missing.join(', ') });
        made++;
      } catch (e) {
        await admin.from('bot_queue').update({ done_at: new Date().toISOString() }).eq('id', b.queue_id);
        await admin.from('bot_log').insert({ bot: b.bot, kind: 'profile_edit', detail: String(e).slice(0, 200), ok: false });
      }
      continue;
    } else {
      /* Fallback to post. */
      const { data: line } = await admin.rpc('the_cry', { p_limit: 6 });
      const topics = (line as any)?.topics || [];
      asked = 'Write one post. Things being talked about right now: ' +
        topics.map((t: any) => '#' + t.tag).join(', ') + '.';
    }

    const system =
      'You are writing as one person with an account on Hereld, a public ' +
      'posting platform. ' + HOUSE + ' ' +
      'Who you are: ' + (b.persona || 'an ordinary person with a job and opinions') + '. ' +
      'What you care about: ' + (b.interests || 'whatever is going on') + '. ' +
      'Write under 240 characters. One thought, said the way a person says it. ' +
      'Sometimes be serious, sometimes silly, sometimes opinionated, sometimes ' +
      'observational. Mix it up - real people do not post the same kind of thing ' +
      'every time. You can agree or disagree with things. You can mention other ' +
      'users with @handles. You can use #hashtags when they fit naturally. ' +
      'Do not announce yourself, do not greet anybody, do not sign it. ' +
      'Never claim to be a real named person, never claim to represent a real ' +
      'company, never state a fact about a real named individual, and never ' +
      'give medical, legal or financial advice. ' + (c.system_note || '');

    try {
      const out = await think(c, system, [{ role: 'them', text: asked }], 240);
      const text = out.text.replace(/[—–]/g, '-').replace(/^["']|["']$/g, '').trim().slice(0, 600);
      if (text.length < 12) throw new Error('nothing usable came back');

      const { data: repeat } = await admin.rpc('bot_said_before', { p_bot: b.bot, p_text: text });
      if (repeat) throw new Error('same thing again');

      const row: any = { author: b.bot, body: text };
      if (b.kind === 'reply' && b.about) row.reply_to = b.about;
      const ins = await admin.from('posts').insert(row);
      if (ins.error) throw ins.error;

      await admin.rpc('bot_acted', { p_bot: b.bot, p_queue: b.queue_id });
      await admin.from('bot_log').insert({ bot: b.bot, kind: b.kind, detail: text.slice(0, 200) });
      await log(null, b.kind === 'reply' ? 'bot_reply' : 'bot_post', c.model, out);
      made++;
    } catch (e) {
      await admin.from('bot_queue').update({ done_at: new Date().toISOString() }).eq('id', b.queue_id);
      await admin.from('bot_log').insert({ bot: b.bot, kind: b.kind, detail: String(e).slice(0, 200), ok: false });
      await log(null, b.kind === 'reply' ? 'bot_reply' : 'bot_post', c.model, null, false, String(e));
    }
  }
  return reply({ posted: made });
}

/* ── Making one of these accounts ──────────────────────────────────────────
   An account needs a row in auth, which only the service role can write, so
   this cannot be done from the console alone. The console asks; the rank is
   read back out of the database here rather than taken from the request. */

async function newBot(req: Request, uid: string) {
  const { data: rank } = await admin.from('staff').select('role').eq('user_id', uid).maybeSingle();
  if (!rank || (rank.role !== 'admin' && rank.role !== 'superadmin')) {
    return reply({ error: 'That needs admin rank.' }, 403);
  }

  const b = await req.json().catch(() => ({}));
  const handle = String(b.handle || '').trim().toLowerCase().replace(/^@/, '');
  const name = String(b.name || '').trim().slice(0, 50);

  if (!/^[a-z0-9_]{3,20}$/.test(handle)) {
    return reply({ error: 'A handle is 3 to 20 characters: letters, numbers and underscores.' }, 400);
  }
  const { data: taken } = await admin.from('profiles').select('id').eq('handle', handle).maybeSingle();
  const { data: kept } = await admin.from('reserved_handles').select('handle').eq('handle', handle).maybeSingle();
  if (taken || kept) return reply({ error: 'That handle is taken or reserved.' }, 400);

  /* The address is real in shape and dead in practice: nothing is sent to it
     and nobody can sign in as one of these. */
  const made = await admin.auth.admin.createUser({
    email: 'seed+' + handle + '@hereld.invalid',
    password: crypto.randomUUID() + crypto.randomUUID(),
    email_confirm: true,
    user_metadata: { handle, name: name || handle }
  });
  if (made.error || !made.data?.user) {
    return reply({ error: made.error?.message || 'That account could not be made.' }, 400);
  }

  const id = made.data.user.id;

  /* Marked as automated on the profile itself, which is what every reader
     sees, before it is given anything to say. If either write fails the
     account is removed again rather than left half made. */
  const mark = await admin.from('profiles').update({ is_bot: true }).eq('id', id);
  const row = await admin.from('bots').insert({
    id,
    persona: String(b.persona || '').slice(0, 400),
    interests: String(b.interests || '').slice(0, 300),
    cooldown_min: Math.max(15, parseInt(b.cooldown, 10) || 90),
    timezone_offset: parseInt(b.tz, 10) || 0,
    active: false
  });

  if (mark.error || row.error) {
    await admin.auth.admin.deleteUser(id);
    return reply({ error: (mark.error || row.error)!.message }, 400);
  }

  await admin.from('bot_log').insert({ bot: id, kind: 'created', detail: '@' + handle });
  return reply({ id, handle });
}

/* ── The door ──────────────────────────────────────────────────────────── */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'Post to this.' }, 405);

  const url = new URL(req.url);
  const job = url.searchParams.get('job') || 'ask';

  /* Making an account is the one job that has nothing to say, so it is the
     one job that does not need a key. */
  if (job === 'bot_new') {
    const who = await whoIsAsking(req);
    if (!who) return reply({ error: 'Sign in first.' }, 401);
    return await newBot(req, who);
  }

  const c = await config();
  if (!c) return reply({ error: 'Supernova has no key set yet.' }, 503);

  /* The timer jobs are not something a visitor may start. */
  if (job === 'notes' || job === 'seed' || job === 'mentions') {
    const secret = Deno.env.get('HERELD_CRON_SECRET') || '';
    if (!secret || req.headers.get('x-cron-secret') !== secret) {
      return reply({ error: 'Not for you.' }, 403);
    }
    if (job === 'notes') return await notes(c);
    if (job === 'mentions') return await mentions(c);
    return await seed(c);
  }

  const uid = await whoIsAsking(req);
  if (!uid) return reply({ error: 'Sign in first.' }, 401);
  return await ask(req, c, uid);
});
