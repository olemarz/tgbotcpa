import { Pool } from 'pg';
import { config } from '../config.js';

const pool = new Pool({ connectionString: config.dbUrl });

export async function query(q, params) {
  const client = await pool.connect();
  try {
    return await client.query(q, params);
  } finally {
    client.release();
  }
}

export { pool };
