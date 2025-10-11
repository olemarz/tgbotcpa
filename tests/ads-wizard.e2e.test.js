import './setup-env.cjs';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import adsWizard from '../src/bot/adsWizard.js';
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

describe('ads wizard geo targeting flow', () => {
  before(async () => {
    await runMigrations();
  });

  it('creates offer with geo whitelist after geo targeting step', async () => {
    await query('DELETE FROM offers');

    const ctx = createWizardContext();
    const steps = adsWizard.steps;

    await steps[0](ctx);

    ctx.message = { text: 'https://t.me/example_channel' };
    await steps[1](ctx);
    ctx.message = undefined;

    ctx.callbackQuery = { data: `event:${EVENT_TYPES.join_group}` };
    await steps[2](ctx);
    ctx.callbackQuery = undefined;

    ctx.message = { text: '20' };
    await steps[3](ctx);

    ctx.message = { text: '25' };
    await steps[4](ctx);

    ctx.message = { text: '100' };
    await steps[5](ctx);

    ctx.message = { text: 'СНГ, DE' };
    await steps[6](ctx);

    ctx.message = { text: 'Тестовый оффер' };
    await steps[7](ctx);

    ctx.message = { text: '-' };
    await steps[8](ctx);
    ctx.message = undefined;

    ctx.callbackQuery = { data: 'confirm:create' };
    await steps[9](ctx);

    assert.equal(ctx.sceneLeft, true);

    const res = await query('SELECT geo_whitelist FROM offers LIMIT 1');
    assert.equal(res.rowCount, 1);
    const whitelist = res.rows[0].geo_whitelist;
    assert.ok(Array.isArray(whitelist));
    assert.ok(whitelist.length > 0);
    assert.deepEqual(whitelist, [
      'RU',
      'BY',
      'UA',
      'KZ',
      'KG',
      'AM',
      'AZ',
      'MD',
      'TM',
      'TJ',
      'UZ',
      'DE',
    ]);
  });
});
