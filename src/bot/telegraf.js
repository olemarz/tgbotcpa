import { Telegraf, Markup } from 'telegraf';
import { config } from '../config.js';
import { query } from '../db/index.js';
import { uuid } from '../util/id.js';
import axios from 'axios';
import { hmacSHA256Hex } from '../util/hmac.js';

export const bot = new Telegraf(config.botToken, { handlerTimeout: 30_000 });

function btn(url, text='Перейти') {
  return Markup.inlineKeyboard([[Markup.button.url(text, url)], [Markup.button.callback('Проверить', 'chk')]]);
}

// Map offer -> target action (simplified). In real life, read "offers" by id
async function resolveStartToken(token) {
  const r = await query('SELECT offer_id, uid FROM start_tokens WHERE token=$1 AND exp_at>now()', [token]);
  if (!r.rowCount) return null;
  return r.rows[0];
}

async function getOffer(offerId) {
  const r = await query('SELECT * FROM offers WHERE id=$1', [offerId]);
  return r.rowCount ? r.rows[0] : null;
}

async function postback({ uid, offer_id, event, fields={} }) {
  const ts = Math.floor(Date.now()/1000);
  const sig = hmacSHA256Hex(process.env.CPA_PB_SECRET, `${uid}|${offer_id}|${event}|${ts}`);
  const payload = { click_id: uid, offer_id, event, ts, sig, status: 1, ...fields };
  try {
    await axios.post(process.env.CPA_POSTBACK_URL, payload, { timeout: 4000 });
  } catch (e) {
    // TODO: push to retry queue
    console.error('postback fail', e.message);
  }
}

bot.start(async (ctx) => {
  const token = (ctx.startPayload || '').trim();
  if (!token) return ctx.reply('Нет токена. Откройте ссылку из рекламной сети.');
  const resolved = await resolveStartToken(token);
  if (!resolved) return ctx.reply('Токен просрочен, повторите переход по рекламе.');

  const offer = await getOffer(resolved.offer_id);
  if (!offer) return ctx.reply('Оффер не найден или деактивирован.');

  // Save attribution
  await query(`INSERT INTO attribution(user_id, offer_id, uid, is_premium)
               VALUES($1,$2,$3,$4)
               ON CONFLICT (user_id, offer_id) DO UPDATE SET uid=EXCLUDED.uid, last_seen=now(), is_premium=$4`,
               [ctx.from.id, resolved.offer_id, resolved.uid, Boolean(ctx.from.is_premium)]);

  // Build target button (very simplified - expects chat_ref in offer.chat_ref)
  const chatRef = offer.chat_ref || {};
  let url = offer.target_url;

  if (offer.event_type === 'join_channel' && chatRef.invite_link) url = chatRef.invite_link;
  if (offer.event_type === 'join_group' && chatRef.invite_link) url = chatRef.invite_link;
  // For reaction/comment -> link to the post
  // For share -> generate share link (simplified: use target_url as redirect)
  if (offer.event_type === 'share_click') {
    const shareToken = Buffer.from(`${resolved.uid}|${offer.id}|${Date.now()}`).toString('base64url');
    url = `${process.env.BASE_URL}/s/${shareToken}?to=${encodeURIComponent(offer.target_url)}`;
  }

  await ctx.reply('Выполните задание по кнопке ниже, затем нажмите «Проверить».', btn(url));
});

// "Проверить" button (basic check)
bot.action('chk', async (ctx) => {
  await ctx.answerCbQuery('Проверяем…');
  // In MVP we rely on async event catching; here you could re-check via getChatMember or cached events
  return ctx.reply('Если действие выполнено, оно будет учтено в течение минуты.');
});

// JOIN GROUP
bot.on('chat_member', async (ctx) => {
  const upd = ctx.update.chat_member;
  const user = upd.new_chat_member.user;
  const becameMember = upd.new_chat_member.status === 'member';
  if (!becameMember) return;

  // Find any active attribution for this chat? In MVP tie by latest attribution (simplified)
  const r = await query('SELECT offer_id, uid FROM attribution WHERE user_id=$1 ORDER BY last_seen DESC LIMIT 1', [user.id]);
  if (!r.rowCount) return;
  const { offer_id, uid } = r.rows[0];

  // Idempotency key
  const key = `${user.id}|${offer_id}|join_group|${upd.chat.id}`;
  try {
    await query('INSERT INTO events(id, offer_id, uid, user_id, event_type, chat_id, idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [uuid(), offer_id, uid, user.id, 'join_group', upd.chat.id, key]);
    await postback({ uid, offer_id, event: 'join_group', fields: { chat_id: upd.chat.id } });
  } catch(e) {}
});

// JOIN CHANNEL via requests
bot.on('chat_join_request', async (ctx) => {
  const req = ctx.update.chat_join_request;
  const userId = req.from.id;
  const r = await query('SELECT offer_id, uid FROM attribution WHERE user_id=$1 ORDER BY last_seen DESC LIMIT 1', [userId]);
  if (r.rowCount) {
    const { offer_id, uid } = r.rows[0];
    const key = `${userId}|${offer_id}|join_channel|${req.chat.id}`;
    try {
      await query('INSERT INTO events(id, offer_id, uid, user_id, event_type, chat_id, idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [uuid(), offer_id, uid, userId, 'join_channel', req.chat.id, key]);
      await postback({ uid, offer_id, event: 'join_channel', fields: { chat_id: req.chat.id } });
    } catch(e) {}
  }
  await ctx.telegram.approveChatJoinRequest(req.chat.id, userId).catch(()=>{});
});

// Reactions (non-anonymous)
bot.on('message_reaction', async (ctx) => {
  const m = ctx.update.message_reaction;
  if (!m?.user) return;
  const userId = m.user.id;
  const r = await query('SELECT offer_id, uid FROM attribution WHERE user_id=$1 ORDER BY last_seen DESC LIMIT 1', [userId]);
  if (!r.rowCount) return;
  const { offer_id, uid } = r.rows[0];
  const key = `${userId}|${offer_id}|reaction|${m.chat.id}|${m.message_id}`;
  try {
    await query('INSERT INTO events(id, offer_id, uid, user_id, event_type, chat_id, message_id, idempotency_key, payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [uuid(), offer_id, uid, userId, 'reaction', m.chat.id, m.message_id, key, m]);
    await postback({ uid, offer_id, event: 'reaction', fields: { chat_id: m.chat.id, message_id: m.message_id } });
  } catch(e) {}
});

// Comments in discussion threads
bot.on('message', async (ctx) => {
  const m = ctx.message;
  if (!m?.message_thread_id || !m.from) return;
  const userId = m.from.id;
  const r = await query('SELECT offer_id, uid FROM attribution WHERE user_id=$1 ORDER BY last_seen DESC LIMIT 1', [userId]);
  if (!r.rowCount) return;
  const { offer_id, uid } = r.rows[0];
  const key = `${userId}|${offer_id}|comment|${m.chat.id}|${m.message_thread_id}`;
  try {
    await query('INSERT INTO events(id, offer_id, uid, user_id, event_type, chat_id, message_id, thread_id, idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [uuid(), offer_id, uid, userId, 'comment', m.chat.id, m.message_id, m.message_thread_id, key]);
    await postback({ uid, offer_id, event: 'comment', fields: { chat_id: m.chat.id, thread_id: m.message_thread_id, message_id: m.message_id } });
  } catch(e) {}
});

// Poll vote (non-anonymous, created by our bot ideally)
bot.on('poll_answer', async (ctx) => {
  const a = ctx.update.poll_answer;
  const userId = a.user?.id;
  if (!userId) return;
  const r = await query('SELECT offer_id, uid FROM attribution WHERE user_id=$1 ORDER BY last_seen DESC LIMIT 1', [userId]);
  if (!r.rowCount) return;
  const { offer_id, uid } = r.rows[0];
  const opt = a.option_ids?.[0];
  const key = `${userId}|${offer_id}|poll_vote|${a.poll_id}|${opt}`;
  try {
    await query('INSERT INTO events(id, offer_id, uid, user_id, event_type, poll_id, idempotency_key, payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [uuid(), offer_id, uid, userId, 'poll_vote', a.poll_id, key, a]);
    await postback({ uid, offer_id, event: 'poll_vote', fields: { poll_id: a.poll_id, option_id: opt } });
  } catch(e) {}
});

export const webhookCallback = bot.webhookCallback('/bot/webhook');
