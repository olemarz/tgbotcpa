import './setup-env.js';
import assert from 'node:assert/strict';
import { before, afterEach, describe, it } from 'node:test';

import { handleStart } from '../src/bot/telegraf.js';
import { runMigrations } from '../src/db/migrate.js';
import { query } from '../src/db/index.js';
import { uuid } from '../src/util/id.js';

const OFFER_URL = 'https://t.me/joinchat/example';

before(async () => {
  await runMigrations();
});

afterEach(async () => {
  await query('DELETE FROM postbacks');
  await query('DELETE FROM events');
  await query('DELETE FROM attribution');
  await query('DELETE FROM clicks');
  await query('DELETE FROM offers');
});

describe('bot.start', () => {
  it('sends join group button for join_group offers', async () => {
    const offerId = uuid();
    const clickId = uuid();
    const startToken = 'start-token-1';

    await query(
      `INSERT INTO offers (id, target_url, event_type, name) VALUES ($1, $2, $3, $4)`,
      [offerId, OFFER_URL, 'join_group', 'Test offer']
    );

    await query(
      `INSERT INTO clicks (id, offer_id, uid, click_id, start_token) VALUES ($1, $2, $3, $4, $5)`,
      [clickId, offerId, 'user-1', 'click-1', startToken]
    );

    const replies = [];
    const ctx = {
      startPayload: startToken,
      from: { id: 555 },
      reply: async (...args) => {
        replies.push(args);
      },
    };

    await handleStart(ctx);

    assert.equal(replies.length, 1);

    const [text, extra] = replies[0];
    assert.equal(text, 'Нажмите, чтобы вступить в группу:');
    const button = extra?.reply_markup?.inline_keyboard?.[0]?.[0];
    assert.equal(button?.text, 'Вступить в группу');
    assert.equal(button?.url, OFFER_URL);

    const { rows: attributionRows } = await query('SELECT state FROM attribution WHERE tg_id = $1', [ctx.from.id]);
    assert.equal(attributionRows.length, 1);
    assert.equal(attributionRows[0].state, 'started');
  });
});
