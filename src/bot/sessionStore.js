import { query } from '../db/pool.js';

export default {
  async get(key) {
    const res = await query('SELECT v FROM bot_sessions WHERE k=$1 LIMIT 1', [key]);
    return res.rowCount ? res.rows[0].v : undefined;
  },
  async set(key, value) {
    await query(
      `INSERT INTO bot_sessions(k, v) VALUES ($1,$2)
       ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v`,
      [key, value]
    );
  },
  async delete(key) {
    await query('DELETE FROM bot_sessions WHERE k=$1', [key]);
  },
};
