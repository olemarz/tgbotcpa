import './setup-env.cjs';
import assert from 'node:assert/strict';
import { before, afterEach, describe, it } from 'node:test';

import { runMigrations } from '../src/db/migrate.js';
import { query } from '../src/db/index.js';
import { retryFailedPostbacksForSlug } from '../src/services/postbackRetry.js';
import { uuid } from '../src/util/id.js';

describe('retryFailedPostbacksForSlug', () => {
  const originalFetch = global.fetch;
  const originalPostbackUrl = process.env.POSTBACK_URL;
  const originalPostbackSecret = process.env.POSTBACK_SECRET;

  before(async () => {
    await runMigrations();
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    process.env.POSTBACK_URL = originalPostbackUrl;
    process.env.POSTBACK_SECRET = originalPostbackSecret;
    await query('DELETE FROM postbacks');
    await query('DELETE FROM attribution');
    await query('DELETE FROM events');
    await query('DELETE FROM clicks');
    await query('DELETE FROM offers');
  });

  it('retries failed postbacks and records a new attempt', async () => {
    const offerId = uuid();
    const eventId = uuid();
    const clickId = uuid();

    await query(
      `INSERT INTO offers (id, target_url, event_type, slug, title)
       VALUES ($1, $2, $3, $4, $5)`,
      [offerId, 'https://example.org', 'join_group', 'retry-offer', 'Retry offer'],
    );

    const postbackUrl = 'https://collector.test/postback';
    process.env.POSTBACK_URL = postbackUrl;
    process.env.POSTBACK_SECRET = 'secret';

    await query(
      `UPDATE offers
          SET postback_url = $2,
              postback_method = 'GET',
              postback_secret = $3
        WHERE id = $1`,
      [offerId, postbackUrl, 'secret'],
    ).catch(() => {});

    await query(
      `INSERT INTO events (id, offer_id, tg_id, event_type, payload)
       VALUES ($1, $2, $3, $4, '{}'::jsonb)`,
      [eventId, offerId, 123456789, 'join_group'],
    );

    await query(
      `INSERT INTO clicks (id, offer_id, click_id, uid)
       VALUES ($1, $2, $3, $4)`,
      [clickId, offerId, 'clk-1', 'uid-1'],
    );

    await query(
      `INSERT INTO attribution (id, click_id, offer_id, tg_id, state)
       VALUES ($1, $2, $3, $4, 'converted')`,
      [uuid(), clickId, offerId, 123456789],
    );

    await query(
      `UPDATE attribution SET event_id = $2 WHERE click_id = $1`,
      [clickId, eventId],
    ).catch(() => {});

    await query(
      `INSERT INTO postbacks (offer_id, event_id, url, method, status_code, response_ms, response_body, attempt, event_type, payload)
       VALUES ($1, $2, $3, 'GET', 500, 1200, 'fail', 1, 'join_group', 'offer_id=1')`,
      [offerId, eventId, `${postbackUrl}?offer_id=prev`],
    ).catch(async () => {
      await query(
        `INSERT INTO postbacks (offer_id, event_id, status, http_status, attempt, event_type, payload)
         VALUES ($1, $2, 'failed', 500, 1, 'join_group', 'offer_id=1')`,
        [offerId, eventId],
      );
    });

    const calls = [];
    global.fetch = async (url) => {
      calls.push(url);
      return {
        status: 200,
        async text() {
          return 'ok';
        },
      };
    };

    const result = await retryFailedPostbacksForSlug({ slug: 'retry-offer', limit: 5 });

    assert.equal(result.ok, true);
    assert.equal(result.retries.length, 1);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].startsWith('https://collector.test/postback'));

    const { rows } = await query(
      `SELECT attempt, event_type, payload
         FROM postbacks
        WHERE offer_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [offerId],
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].attempt, 2);
    assert.equal(rows[0].event_type, 'join_group');
    assert.match(rows[0].payload || '', /offer_id=/);
  });
});
