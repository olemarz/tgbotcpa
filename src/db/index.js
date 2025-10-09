import { Pool } from 'pg';
import { config } from '../config.js';
import { uuid } from '../util/id.js';

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
