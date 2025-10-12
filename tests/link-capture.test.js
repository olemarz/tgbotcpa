import './setup-env.cjs';
import assert from 'node:assert/strict';
import { before, afterEach, describe, it } from 'node:test';

import { createLinkCaptureMiddleware } from '../src/bot/link-capture.js';
import { runMigrations } from '../src/db/migrate.js';
import { handleAdsUserCommand } from '../src/bot/adsUserFlow.js';

describe('link capture middleware', () => {
  const originalDisableEnv = process.env.DISABLE_LINK_CAPTURE;

  afterEach(() => {
    process.env.DISABLE_LINK_CAPTURE = originalDisableEnv;
  });

  it('handles only messages when awaiting target link', async () => {
    const middleware = createLinkCaptureMiddleware();

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
    const sessionA = {};
    await middleware({ updateType: 'message', message: baseMessage, session: sessionA }, async () => {
      nextCalls += 1;
    });
    assert.equal(nextCalls, 1);
    assert.equal(sessionA.target_link, undefined);

    nextCalls = 0;
    const sessionB = { mode: 'offer:create', awaiting: 'target_link' };
    await middleware(
      {
        updateType: 'message',
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
        session: sessionB,
      },
      async () => {
        nextCalls += 1;
      },
    );
    assert.equal(nextCalls, 1);
    assert.equal(sessionB.target_link, undefined);

    nextCalls = 0;
    const sessionC = { mode: 'offer:create', awaiting: 'target_link' };
    await middleware(
      {
        updateType: 'message',
        message: baseMessage,
        session: sessionC,
        reply: async () => {},
      },
      async () => {
        nextCalls += 1;
      },
    );
    assert.equal(nextCalls, 1);
    assert.equal(sessionC.target_link, 'https://t.me/example_channel');
    assert.equal(sessionC.raw_target_link, 'https://t.me/example_channel');
  });

  it('respects DISABLE_LINK_CAPTURE env flag', async () => {
    process.env.DISABLE_LINK_CAPTURE = 'true';
    const middleware = createLinkCaptureMiddleware();

    const session = { mode: 'offer:create', awaiting: 'target_link' };
    let nextCalls = 0;
    await middleware(
      {
        updateType: 'message',
        message: {
          text: 'https://t.me/example_channel',
          entities: [
            {
              type: 'url',
              offset: 0,
              length: 'https://t.me/example_channel'.length,
            },
          ],
        },
        session,
        reply: async () => {
          throw new Error('should not reply when disabled');
        },
      },
      async () => {
        nextCalls += 1;
      },
    );

    assert.equal(nextCalls, 1);
    assert.equal(session.target_link, undefined);
  });
});

describe('/ads command guard', () => {
  before(async () => {
    await runMigrations();
  });

  it('responds to /ads even if message contains a telegram link', async () => {
    const middleware = createLinkCaptureMiddleware();

    const replies = [];
    const ctx = {
      updateType: 'message',
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
      reply: async (...args) => {
        replies.push(args);
      },
      session: { mode: 'offer:create', awaiting: 'target_link' },
    };

    await middleware(ctx, async () => {
      await handleAdsUserCommand(ctx);
    });

    assert.ok(replies.length >= 1);
    const [text] = replies[0];
    assert.equal(text, 'На сейчас задач нет');
  });
});

