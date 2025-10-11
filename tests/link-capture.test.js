import './setup-env.cjs';
import assert from 'node:assert/strict';
import { before, afterEach, describe, it } from 'node:test';

import { createLinkCaptureMiddleware } from '../src/bot/link-capture.js';
import { runMigrations } from '../src/db/migrate.js';
import { handleAdsUserCommand } from '../src/bot/adsUserFlow.js';

describe('link capture middleware', () => {
  it('handles only messages when awaiting target link', async () => {
    const captured = [];
    const middleware = createLinkCaptureMiddleware(async (ctx, next) => {
      captured.push(ctx.message?.text || ctx.message?.caption || '');
      if (next) {
        await next();
      }
    });

    const baseMessage = {
      text: 'https://t.me/example_channel',
      entities: [
        {
          type: 'url',
          offset: 0,
          length: 'https://t.me/example_channel'.length,
        },
      ],
    };

    let nextCalls = 0;
    await middleware({ message: baseMessage, session: {} }, async () => {
      nextCalls += 1;
    });
    assert.equal(captured.length, 0);
    assert.equal(nextCalls, 1);

    nextCalls = 0;
    await middleware(
      {
        message: {
          text: '/ads https://t.me/example_channel',
          entities: [
            { type: 'bot_command', offset: 0, length: 4 },
            {
              type: 'url',
              offset: 5,
              length: 'https://t.me/example_channel'.length,
            },
          ],
        },
        session: { mode: 'offer:create', awaiting: 'target_link' },
      },
      async () => {
        nextCalls += 1;
      },
    );
    assert.equal(captured.length, 0);
    assert.equal(nextCalls, 1);

    nextCalls = 0;
    await middleware(
      {
        message: baseMessage,
        session: { mode: 'offer:create', awaiting: 'target_link' },
      },
      async () => {
        nextCalls += 1;
      },
    );
    assert.equal(captured.length, 1);
    assert.equal(nextCalls, 1);
  });
});

describe('/ads command guard', () => {
  before(async () => {
    await runMigrations();
  });

  it('responds to /ads even if message contains a telegram link', async () => {
    const middleware = createLinkCaptureMiddleware(async () => {
      throw new Error('link capture should not run for command messages');
    });

    const replies = [];
    const ctx = {
      message: {
        text: '/ads https://t.me/example_channel',
        entities: [
          { type: 'bot_command', offset: 0, length: 4 },
          {
            type: 'url',
            offset: 5,
            length: 'https://t.me/example_channel'.length,
          },
        ],
      },
      from: { id: 501, language_code: 'ru' },
      chat: { id: 501, type: 'private' },
      session: {},
      reply: async (...args) => {
        replies.push(args);
      },
    };

    await middleware(ctx, async () => {
      await handleAdsUserCommand(ctx);
    });

    assert.ok(replies.length >= 1);
    const [text] = replies[0];
    assert.equal(text, 'Пока нет подходящих офферов. Попробуйте позже.');
  });
});

