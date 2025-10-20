import pool from './pool.js';
import { propagateSuspectAttributionMeta } from '../services/antifraud.js';

const UPDATE_COLUMNS = ['uid', 'tg_id'];

export async function upsertAttribution({ user_id, offer_id, uid, tg_id = null, click_id = null }) {
  const values = [user_id, offer_id, uid, tg_id, click_id];
  const result = await pool.query(
    `INSERT INTO attribution (user_id, offer_id, uid, tg_id, click_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, offer_id)
     DO UPDATE
        SET ${UPDATE_COLUMNS.map((column) => `${column} = EXCLUDED.${column}`).join(', ')},
            click_id = COALESCE(EXCLUDED.click_id, attribution.click_id),
            last_seen = now()
      RETURNING user_id, offer_id, uid, tg_id, is_premium, first_seen, last_seen, click_id, state, created_at`,
    values,
  );
  const row = result.rows[0] ?? null;
  await propagateSuspectAttributionMeta({ clickId: click_id, offerId: offer_id, tgId: tg_id });
  return row;
}

export async function attachEvent({ user_id, offer_id }) {
  await pool.query(
    `UPDATE attribution
        SET last_seen = now()
      WHERE user_id = $1 AND offer_id = $2`,
    [user_id, offer_id],
  );
}

export async function getLastAttributionByOfferAndUser(offer_id, tg_id) {
  const result = await pool.query(
    `SELECT user_id, offer_id, uid, tg_id, is_premium, first_seen, last_seen, click_id, state, created_at
       FROM attribution
      WHERE offer_id = $1 AND tg_id = $2
      ORDER BY last_seen DESC
      LIMIT 1`,
    [offer_id, tg_id],
  );
  return result.rows[0] ?? null;
}
