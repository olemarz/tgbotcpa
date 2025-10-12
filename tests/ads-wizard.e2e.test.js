import './setup-env.cjs';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import adsWizard, { initializeAdsWizard } from '../src/bot/adsWizard.js';
import { EVENT_TYPES } from '../src/bot/constants.js';
import { runMigrations } from '../src/db/migrate.js';
import { query } from '../src/db/index.js';

function createWizardContext() {
  const replies = [];
  const sent = [];
  const ctx = {
    replies,
    sent,
    from: { id: 5001, language_code: 'ru' },
    chat: { id: 5001, type: 'private' },
    wizard: {
      state: {},
      steps: adsWizard.steps,
      cursor: 0,
      next() {
        this.cursor += 1;
        return this.cursor;
      },
      selectStep(step) {
        this.cursor = step;
      },
    },
    reply: async (text) => {
      replies.push(text);
    },
    replyWithHTML: async (text) => {
      replies.push(text);
    },
    editMessageReplyMarkup: async () => {},
    editMessageText: async (text) => {
      replies.push(text);
    },
    answerCbQuery: async () => {},
    scene: {
      leave: async () => {
        ctx.sceneLeft = true;
      },
    },
    telegram: {
      async getChat() {
        return {
          id: -100123,
          type: 'channel',
          title: 'Example Channel',
          username: 'example_channel',
          is_forum: false,
        };
      },
      async sendMessage(chatId, text) {
        sent.push({ chatId, text });
      },
    },
  };

  return ctx;
}

describe('ads wizard flow', () => {
  before(async () => {
    await runMigrations();
  });

  it('creates offer with generated title and slug', async () => {
    await query('DELETE FROM offers');

    const ctx = createWizardContext();
    const steps = adsWizard.steps;

    let updateId = 1;
    ctx.update = { update_id: updateId++, message: { text: '/ads' } };
    await initializeAdsWizard(ctx);
    await steps[0](ctx);
    const prompts = [ctx.replies.at(-1)];

    ctx.message = { text: 'https://t.me/example_channel' };
    ctx.update = { update_id: updateId++, message: ctx.message };
    await steps[0](ctx);
    prompts.push(ctx.replies.at(-1));
    ctx.message = undefined;

    ctx.callbackQuery = { data: `event:${EVENT_TYPES.join_group}` };
    ctx.update = { update_id: updateId++, callback_query: ctx.callbackQuery };
    await steps[1](ctx);
    prompts.push(ctx.replies.at(-1));
    ctx.callbackQuery = undefined;

    ctx.message = { text: '20' };
    ctx.update = { update_id: updateId++, message: ctx.message };
    await steps[2](ctx);
    prompts.push(ctx.replies.at(-1));

    ctx.message = { text: '25' };
    ctx.update = { update_id: updateId++, message: ctx.message };
    await steps[3](ctx);
    prompts.push(ctx.replies.at(-1));

    ctx.message = { text: '100' };
    ctx.update = { update_id: updateId++, message: ctx.message };
    await steps[4](ctx);
    prompts.push(ctx.replies.at(-1));

    ctx.message = { text: '0' };
    ctx.update = { update_id: updateId++, message: ctx.message };
    await steps[5](ctx);
    prompts.push(ctx.replies.at(-1));

    ctx.message = { text: 'Example Offer' };
    ctx.update = { update_id: updateId++, message: ctx.message };
    await steps[6](ctx);
    prompts.push(ctx.replies.at(-1));

    ctx.message = { text: '-' };
    ctx.update = { update_id: updateId++, message: ctx.message };
    await steps[7](ctx);

    assert.equal(ctx.sceneLeft, true);

    const res = await query('SELECT * FROM offers LIMIT 1');
    assert.equal(res.rowCount, 1);
    const row = res.rows[0];
    assert.equal(row.target_url, 'https://t.me/example_channel');
    assert.equal(row.event_type, EVENT_TYPES.join_group);
    const title = row.title ?? row.name;
    assert.equal(title, 'Example Offer');
    assert.equal(Number(row.base_rate), 20);
    assert.equal(Number(row.premium_rate), 25);
    assert.equal(row.caps_total, 100);
    assert.ok(typeof row.slug === 'string' && /^example-offer(?:-\d+)?$/.test(row.slug));
    if ('geo_mode' in row) {
      assert.equal(row.geo_mode, 'any');
    }
    assert.equal(row.geo_input ?? null, null);
    if ('geo_list' in row) {
      const list = row.geo_list;
      if (Array.isArray(list)) {
        assert.deepEqual(list, []);
      } else {
        assert.equal(list, '{}');
      }
    }

    assert.equal(prompts.length, 8);
    const promptHeaders = prompts.map((text) => String(text).split('\n')[0]);
    promptHeaders.forEach((header, index) => {
      assert.match(header, new RegExp(`^Шаг ${index + 1}/8`));
    });
  });
});
