import pool from './pool.js';

export async function insertPostbackLog({
  offer_id,
  event_id,
  url,
  method = 'GET',
  status_code = null,
  response_ms = null,
  response_body = null,
  attempt = 1,
}) {
  await pool.query(
    `INSERT INTO postbacks (offer_id, event_id, url, method, status_code, response_ms, response_body, attempt)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [offer_id, event_id, url, method, status_code, response_ms, response_body, attempt],
  );
}
