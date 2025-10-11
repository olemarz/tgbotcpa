import pg from 'pg';
const { Pool } = pg;
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { uuid } from '../util/id.js';

let pool;

if (config.dbUrl.startsWith('pgmem://')) {
  const { newDb } = await import('pg-mem');
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: 'uuid',
    implementation: () => randomUUID(),
  });
  const adapter = db.adapters.createPg();
  pool = new adapter.Pool();
} else {
  pool = new Pool({ connectionString: config.dbUrl });
}

export async function query(q, params) {
  const client = await pool.connect();
  try {
    return await client.query(q, params);
  } finally {
    client.release();
  }
}

export { pool };

export async function insertOfferAuditLog({ offerId, action, userId, chatId, details }) {
  const columns = ['id', 'offer_id', 'action'];
  const values = [uuid(), offerId, action];

  if (typeof userId === 'number') {
    columns.push('user_id');
    values.push(userId);
  }

  if (typeof chatId === 'number') {
    columns.push('chat_id');
    values.push(chatId);
  }

  if (details && Object.keys(details).length > 0) {
    columns.push('details');
    values.push(details);
  }

  const placeholders = columns.map((_, idx) => `$${idx + 1}`);
  try {
    await query(
      `INSERT INTO offer_audit_log (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
      values
    );
  } catch (error) {
    if (error?.code === '42P01') {
      console.warn('[adsWizard:audit] offer_audit_log table missing, skipping audit insert');
      return;
    }
    throw error;
  }
}
