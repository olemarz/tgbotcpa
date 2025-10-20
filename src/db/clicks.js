import pool from './pool.js';

export async function insertClick({
  offer_id,
  uid = null,
  click_id = null,
  start_token,
  ip = null,
  ua = null,
  ref = null,
  tg_id = null,
}) {
  const result = await pool.query(
    `INSERT INTO clicks (id, offer_id, uid, click_id, start_token, tg_id, user_ip, user_agent, referer)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, start_token`,
    [offer_id, uid, click_id, start_token, tg_id, ip, ua, ref],
  );
  return result.rows[0] ?? null;
}

export async function getClickByStartToken(token) {
  const result = await pool.query(
    `SELECT id, offer_id, uid, click_id, start_token, tg_id, user_ip, user_agent, referer, created_at, used_at
       FROM clicks
      WHERE start_token = $1
      LIMIT 1`,
    [token],
  );
  return result.rows[0] ?? null;
}

export async function linkClickToUser({ id, tg_id }) {
  const result = await pool.query(
    `UPDATE clicks
        SET tg_id = $2,
            used_at = COALESCE(used_at, now())
      WHERE id = $1
      RETURNING id, offer_id, uid, click_id, start_token, tg_id, user_ip, user_agent, referer, created_at, used_at`,
    [id, tg_id],
  );
  return result.rows[0] ?? null;
}

export async function getClickById(id) {
  const result = await pool.query(
    `SELECT id, offer_id, uid, click_id, start_token, tg_id, user_ip, user_agent, referer, created_at, used_at
       FROM clicks
      WHERE id = $1
      LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}
