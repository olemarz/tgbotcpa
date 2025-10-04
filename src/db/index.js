import { Pool } from 'pg';
import { config } from '../config.js';

export const pool = new Pool({ connectionString: config.dbUrl });

export async function query(q, params) {
  const client = await pool.connect();
  try {
    const res = await client.query(q, params);
    return res;
  } finally {
    client.release();
  }
}
