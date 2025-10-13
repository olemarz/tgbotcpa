import { query } from '../db/index.js';

function normalizeKey(key) {
  if (key === undefined || key === null) {
    return null;
  }
  const normalized = String(key).trim();
  if (!/^[0-9]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

async function safeQuery(sql, params) {
  try {
    return await query(sql, params);
  } catch (error) {
    if (error?.code === '42P01') {
      // sessions table missing — ignore to avoid crashing bot during bootstrap/migrations
      return { rowCount: 0, rows: [] };
    }
    throw error;
  }
}

export class PostgresSessionStore {
  async get(key) {
    const normalized = normalizeKey(key);
    if (!normalized) {
      return undefined;
    }
    const result = await safeQuery('SELECT data FROM sessions WHERE tg_id = $1', [normalized]);
    if (!result?.rowCount) {
      return undefined;
    }
    return result.rows[0]?.data ?? undefined;
  }

  async set(key, value) {
    const normalized = normalizeKey(key);
    if (!normalized) {
      return;
    }
    if (value === undefined || value === null) {
      await safeQuery('DELETE FROM sessions WHERE tg_id = $1', [normalized]);
      return;
    }
    await safeQuery(
      `
      INSERT INTO sessions(tg_id, data)
      VALUES ($1, $2)
      ON CONFLICT(tg_id) DO UPDATE
        SET data = $2,
            updated_at = now()
    `,
      [normalized, value]
    );
  }

  async delete(key) {
    const normalized = normalizeKey(key);
    if (!normalized) {
      return;
    }
    await safeQuery('DELETE FROM sessions WHERE tg_id = $1', [normalized]);
  }
}

export const sessionStore = new PostgresSessionStore();
