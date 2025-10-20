// src/services/attribution.js
import pool from '../db/pool.js';

const query = (sql, params=[]) => pool.query(sql, params);

// upsert по композитному ключу (user_id, offer_id)
export async function upsertAttribution({ user_id, offer_id, uid=null, tg_id=null, click_id=null, state='started' }) {
  const sql = `
    INSERT INTO attribution (user_id, offer_id, uid, tg_id, click_id, state)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_id, offer_id)
    DO UPDATE
      SET uid      = COALESCE(EXCLUDED.uid, attribution.uid),
          tg_id    = COALESCE(EXCLUDED.tg_id, attribution.tg_id),
          click_id = COALESCE(EXCLUDED.click_id, attribution.click_id),
          state    = EXCLUDED.state,
          last_seen = now();
  `;
  await query(sql, [user_id, offer_id, uid, tg_id, click_id, state]);
  return { ok: true };
}

// вызывается после фиксации события: помечаем converted и подтягиваем click_id/uid если появились
export async function attachEvent({ offerId, tgId, clickId=null, uid=null }) {
  const sql = `
    UPDATE attribution
       SET state='converted',
           last_seen=now(),
           click_id = COALESCE($3, click_id),
           uid      = COALESCE($4, uid)
     WHERE user_id=$1 AND offer_id=$2
  `;
  await query(sql, [tgId, offerId, clickId, uid]);
  return { ok: true };
}