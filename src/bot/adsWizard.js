// src/bot/adsWizard.js
import { Scenes, Markup } from 'telegraf';
import { query } from '../db/index.js';
import { EVENT_TYPES, MIN_RATES, TIME_PRESETS } from '../constants/offers.js';
import { makeSlug } from '../util/slug.js';

function isValidUrl(u) {
  try {
    const url = new URL(u);
    return ['http:', 'https:'].includes(url.protocol) && !!url.host;
  } catch { return false; }
}
function fmtMoney(x){ return `${x}⭐`; }
function humanEvent(ev){ return EVENT_TYPES[ev] || ev; }

const eventButtons = Object.keys(EVENT_TYPES).map((k)=>[Markup.button.callback(EVENT_TYPES[k],`ev_${k}`)]);
const timeButtons = [
  [Markup.button.callback('24/7','tp_247')],
  [Markup.button.callback('Только будни','tp_weekdays')],
  [Markup.button.callback('Только выходные','tp_weekends')],
];

export const adsWizard = new Scenes.WizardScene(
  'ads-wizard',

  async (ctx)=>{
    ctx.wizard.state.offer = {};
    await ctx.reply('🔗 Введите URL (канал/группа/бот/мини-апп), что продвигаем:', Markup.forceReply());
    return ctx.wizard.next();
  },

  async (ctx)=>{
    const text = ctx.message?.text?.trim();
    if(!text || !isValidUrl(text)){
      await ctx.reply('❗ Пришлите корректный URL, напр.: https://t.me/your_channel');
      return;
    }
    ctx.wizard.state.offer.target_url = text;
    await ctx.reply(`✅ URL принят: ${text}\n\nВыберите тип целевого действия:`, Markup.inlineKeyboard(eventButtons));
    return ctx.wizard.next();
  },

  async (ctx)=>{
    const cb = ctx.update?.callback_query?.data;
    if(!cb?.startsWith('ev_')){ await ctx.reply('Выберите кнопку с типом действия.'); return; }
    const ev = cb.slice(3);
    ctx.wizard.state.offer.event_type = ev;
    await ctx.answerCbQuery(); await ctx.editMessageReplyMarkup();
    const min = MIN_RATES[ev] || {regular:1, premium:1};
    await ctx.reply(
      `📌 ЦД: *${humanEvent(ev)}*\n\nУкажите *стоимость ЦД* (обычные аккаунты).\nМинимум: *${fmtMoney(min.regular)}*\n\nФормат: \`число\` (например: 7)`,
      { parse_mode:'Markdown' }
    );
    return ctx.wizard.next();
  },

  async (ctx)=>{
    const n = Number((ctx.message?.text||'').trim());
    const ev = ctx.wizard.state.offer.event_type;
    const min = MIN_RATES[ev] || {regular:1, premium:1};
    if(!Number.isInteger(n) || n < min.regular){ await ctx.reply(`❗ Введите целое число ≥ ${min.regular}`); return; }
    ctx.wizard.state.offer.base_rate = n;
    await ctx.reply(
      `⭐ Укажите *стоимость ЦД для премиум-аккаунтов*.\nМинимум: *${fmtMoney(min.premium)}*\n\nФормат: \`число\` (например: 12)`,
      { parse_mode:'Markdown' }
    );
    return ctx.wizard.next();
  },

  async (ctx)=>{
    const n = Number((ctx.message?.text||'').trim());
    const ev = ctx.wizard.state.offer.event_type;
    const min = MIN_RATES[ev] || {regular:1, premium:1};
    if(!Number.isInteger(n) || n < min.premium){ await ctx.reply(`❗ Введите целое число ≥ ${min.premium}`); return; }
    ctx.wizard.state.offer.premium_rate = n;
    await ctx.reply('🎯 Укажите *лимит по ЦД* (сколько действий всего нужно). Формат: `число` (например: 100). Если 0 — без лимита.', { parse_mode:'Markdown' });
    return ctx.wizard.next();
  },

  async (ctx)=>{
    const n = Number((ctx.message?.text||'').trim());
    if(!Number.isInteger(n) || n < 0){ await ctx.reply('❗ Введите целое число ≥ 0'); return; }
    ctx.wizard.state.offer.caps_total = n;
    await ctx.reply('🕒 Выберите временной таргетинг:', Markup.inlineKeyboard(timeButtons));
    return ctx.wizard.next();
  },

  async (ctx)=>{
    const cb = ctx.update?.callback_query?.data;
    if(!cb?.startsWith('tp_')){ await ctx.reply('Выберите одну из кнопок таргетинга.'); return; }
    await ctx.answerCbQuery(); await ctx.editMessageReplyMarkup();
    const preset = cb.slice(3);
    ctx.wizard.state.offer.caps_window = TIME_PRESETS[preset] || TIME_PRESETS['247'];

    const o = ctx.wizard.state.offer;
    const summary = [
      '🧾 *Сводка оффера:*',
      `• URL: ${o.target_url}`,
      `• ЦД: *${humanEvent(o.event_type)}*`,
      `• Ставка: ${fmtMoney(o.base_rate)} (обычные)`,
      `• Ставка Premium: ${fmtMoney(o.premium_rate)}`,
      `• Лимит по ЦД: ${o.caps_total===0?'без лимита':o.caps_total}`,
      `• Тайм-таргетинг: ${preset==='247'?'24/7':preset==='weekdays'?'Будни':'Выходные'}`,
      '\nСоздаём оффер?'
    ].join('\n');

    await ctx.reply(summary, {
      parse_mode:'Markdown',
      reply_markup: { inline_keyboard: [
        [Markup.button.callback('✅ Создать оффер','ads_commit')],
        [Markup.button.callback('✖️ Отмена','ads_cancel')],
      ] }
    });
    return ctx.wizard.next();
  },

  async (ctx)=>{
    const data = ctx.update?.callback_query?.data;
    if(!data) return;
    if(data==='ads_cancel'){ await ctx.answerCbQuery(); await ctx.editMessageReplyMarkup(); await ctx.reply('Ок, отмена. Можешь снова вызвать /ads.'); return ctx.scene.leave(); }
    if(data!=='ads_commit'){ await ctx.answerCbQuery(); return; }
    await ctx.answerCbQuery('Создаём оффер…');
    try{
      const o = ctx.wizard.state.offer;
      let host = ''; try{ host = new URL(o.target_url).host; }catch{}
      const name = `${humanEvent(o.event_type)} • ${host}`.slice(0,64);
      const slug = makeSlug(name);

      const sql = `
        INSERT INTO offers (
          id, advertiser_id, target_url, event_type,
          name, slug,
          base_rate, premium_rate,
          caps_total, caps_window,
          status
        )
        VALUES (
          gen_random_uuid(), gen_random_uuid(), $1, $2,
          $3, $4,
          $5, $6,
          $7, $8,
          'active'
        )
        RETURNING id
      `;
      const params = [
        o.target_url, o.event_type, name, slug,
        o.base_rate, o.premium_rate, o.caps_total,
        JSON.stringify(o.caps_window),
      ];
      const dbRes = await query(sql, params);
      const offerId = dbRes?.rows?.[0]?.id;
      if(!offerId) throw new Error('No offer id returned');

      const base = (process.env.BASE_URL || '').replace(/\/$/,'');
      const click = `${base}/click/${offerId}?uid=<UID>&sub1=<SUB1>`;
      await ctx.editMessageReplyMarkup();
      await ctx.reply(
        `🎉 *Оффер создан!*\nID: \`${offerId}\`\nSlug: \`${slug}\`\n\nСсылка для налива:\n\`${click}\`\n\n_Передай ссылку в СРА. При поступлении клика uid будет сохранён, а выполнение ЦД — постбекнуто._`,
        { parse_mode:'Markdown' }
      );
    }catch(e){
      console.error('create offer error', e);
      await ctx.reply('❌ Не удалось создать оффер. Проверьте логи сервера.');
    }finally{
      return ctx.scene.leave();
    }
  }
);

adsWizard.action('ads_cancel', async (ctx)=>{
  try{ await ctx.answerCbQuery(); await ctx.editMessageReplyMarkup(); await ctx.reply('Ок, отмена. Можешь снова вызвать /ads.'); }
  catch(e){ console.error('ads cancel error', e); }
  finally{ return ctx.scene.leave(); }
});
