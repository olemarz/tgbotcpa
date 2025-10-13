import './setup-env.cjs';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { createLinkCaptureMiddleware } from '../src/bot/link-capture.js';
import { runMigrations } from '../src/db/migrate.js';
import { handleAdsUserCommand } from '../src/bot/adsUserFlow.js';

describe('link capture middleware', () => {
  it('passes through commands without capturing', async () => {
    const middleware = createLinkCaptureMiddleware();

    const session = { mode: 'offer:create', awaiting: 'target_link' };
    let nextCalls = 0;
    await middleware(
      {
        updateType: 'message',
        update: {
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
        },
        session,
      },
      async () => {
        nextCalls += 1;
      },
    );

    assert.equal(nextCalls, 1);
    assert.equal(session.target_link, undefined);
    assert.equal(session.raw_target_link, undefined);
  });

  it('skips when a scene is active', async () => {
    const middleware = createLinkCaptureMiddleware();

    const session = { mode: 'offer:create', awaiting: 'target_link' };
    let nextCalls = 0;
    await middleware(
      {
        updateType: 'message',
        update: {
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
        },
        session,
        scene: { current: 'ads-wizard' },
      },
      async () => {
        nextCalls += 1;
      },
    );

    assert.equal(nextCalls, 1);
    assert.equal(session.target_link, undefined);
    assert.equal(session.raw_target_link, undefined);
  });

  it('captures links when awaiting target link', async () => {
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
        update: {
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
        },
        session,
        reply: async () => {},
      },
      async () => {
        nextCalls += 1;
      },
    );

    assert.equal(nextCalls, 1);
    assert.equal(session.target_link, 'https://t.me/example_channel');
    assert.equal(session.raw_target_link, 'https://t.me/example_channel');
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

