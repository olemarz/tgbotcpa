import pool from './pool.js';

const BASE_COLUMNS = [
  'offer_id',
  'user_id',
  'uid',
  'event_type',
  'payload',
  'tg_id',
  'chat_id',
  'message_id',
  'thread_id',
  'poll_id',
  'reaction',
  'poll_option_idx',
  'idempotency_key',
];

export async function insertEvent(event) {
  const values = [];
  const columns = [];
  const params = [];

  for (const column of BASE_COLUMNS) {
    if (event[column] === undefined) continue;
    columns.push(column);
    if (column === 'payload' && event[column] !== null) {
      values.push(JSON.stringify(event[column]));
    } else {
      values.push(event[column]);
    }
    params.push(`$${values.length}`);
  }

  const sqlParts = [
    `INSERT INTO events (id${columns.length ? `, ${columns.join(', ')}` : ''})`,
    `VALUES (gen_random_uuid()${params.length ? `, ${params.join(', ')}` : ''})`,
  ];

  let returningClause = 'RETURNING id';
  let conflictKey = null;
  if (event.idempotency_key !== undefined && event.idempotency_key !== null) {
    conflictKey = event.idempotency_key;
    sqlParts.push('ON CONFLICT (idempotency_key) DO NOTHING');
  }
  sqlParts.push(returningClause);

  const queryText = sqlParts.join(' ');
  const result = await pool.query(queryText, values);

  if (result.rowCount > 0) {
    return result.rows[0];
  }

  if (conflictKey) {
    const existing = await pool.query(`SELECT id FROM events WHERE idempotency_key = $1 LIMIT 1`, [conflictKey]);
    return existing.rows[0] ?? null;
  }

  return null;
}
