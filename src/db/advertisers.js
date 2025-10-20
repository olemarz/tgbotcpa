import pool from './pool.js';

function buildInsertParts(data) {
  const columns = ['tg_id'];
  const values = [data.tgId];
  const params = ['$1'];
  const updates = ['updated_at = NOW()'];
  let index = 2;

  const push = (column, value) => {
    if (value === undefined) return;
    columns.push(column);
    values.push(value);
    params.push(`$${index}`);
    updates.push(`${column} = COALESCE(EXCLUDED.${column}, advertisers.${column})`);
    index += 1;
  };

  push('username', data.username);
  push('first_name', data.firstName);
  push('last_name', data.lastName);
  push('contact', data.contact);

  return { columns, values, params, updates };
}

export async function upsertAdvertiser(profile = {}) {
  const tgId = profile?.tgId;
  if (!tgId) return null;

  const { columns, values, params, updates } = buildInsertParts({
    tgId,
    username: profile.username ?? undefined,
    firstName: profile.firstName ?? undefined,
    lastName: profile.lastName ?? undefined,
    contact: profile.contact ?? undefined,
  });

  const sql = `
    INSERT INTO advertisers (${columns.join(', ')})
    VALUES (${params.join(', ')})
    ON CONFLICT (tg_id) DO UPDATE SET ${updates.join(', ')}
    RETURNING tg_id, username, first_name, last_name, contact, blocked, blocked_at, created_at, updated_at
  `;

  const result = await pool.query(sql, values);
  return result.rows[0] ?? null;
}

export async function setAdvertiserBlocked(tgId, blocked = true) {
  if (!tgId) return null;

  const sql = `
    INSERT INTO advertisers (tg_id, blocked, blocked_at, updated_at)
    VALUES ($1, $2, CASE WHEN $2 THEN NOW() ELSE NULL END, NOW())
    ON CONFLICT (tg_id) DO UPDATE SET
      blocked = EXCLUDED.blocked,
      blocked_at = CASE WHEN EXCLUDED.blocked THEN NOW() ELSE NULL END,
      updated_at = NOW()
    RETURNING tg_id, blocked, blocked_at
  `;

  const result = await pool.query(sql, [tgId, blocked]);
  return result.rows[0] ?? null;
}

export async function getAdvertiser(tgId) {
  if (!tgId) return null;
  const result = await pool.query(
    `SELECT tg_id, username, first_name, last_name, contact, blocked, blocked_at, created_at, updated_at
       FROM advertisers
      WHERE tg_id = $1
      LIMIT 1`,
    [tgId],
  );
  return result.rows[0] ?? null;
}

export async function listAdvertisersByIds(ids = []) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return [];
  }
  const deduped = Array.from(new Set(ids.filter((id) => id != null)));
  if (!deduped.length) return [];

  const placeholders = deduped.map((_, idx) => `$${idx + 1}`);
  const result = await pool.query(
    `SELECT tg_id, username, first_name, last_name, contact, blocked, blocked_at
       FROM advertisers
      WHERE tg_id IN (${placeholders.join(', ')})`,
    deduped,
  );
  return result.rows;
}
