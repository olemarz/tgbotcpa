import { query } from '../db/index.js';

let attributionColumnsPromise;

async function loadAttributionColumns() {
  if (!attributionColumnsPromise) {
    attributionColumnsPromise = query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'attribution'`,
    )
      .then((res) => new Set(res.rows.map((row) => row.column_name)))
      .catch((error) => {
        console.error('[attribution] failed to load columns', error?.message || error);
        return new Set();
      });
  }
  return attributionColumnsPromise;
}

function buildInsertStatement({ columns, values }) {
  const placeholders = columns.map((_, idx) => `$${idx + 1}`);
  return {
    sql: `INSERT INTO attribution (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
    placeholders,
    values,
  };
}

export async function upsertAttribution({
  user_id,
  offer_id,
  uid,
  tg_id,
  click_id,
  event_id,
}) {
  const columns = await loadAttributionColumns();

  if (!columns.has('click_id') || !columns.has('offer_id') || !columns.has('tg_id')) {
    console.warn('[attribution] required columns missing, skipping upsert');
    return;
  }

  const normalized = {
    userId: user_id ?? null,
    offerId: offer_id ?? null,
    uid: uid ?? null,
    tgId: tg_id ?? null,
    clickId: click_id ?? null,
    eventId: event_id ?? null,
  };

  const insertColumns = ['click_id', 'offer_id', 'tg_id'];
  const insertValues = [normalized.clickId, normalized.offerId, normalized.tgId];

  if (columns.has('uid')) {
    insertColumns.push('uid');
    insertValues.push(normalized.uid);
  }

  if (columns.has('user_id')) {
    insertColumns.push('user_id');
    insertValues.push(normalized.userId);
  }

  if (columns.has('event_id')) {
    insertColumns.push('event_id');
    insertValues.push(normalized.eventId);
  }

  if (columns.has('state')) {
    insertColumns.push('state');
    insertValues.push('started');
  }

  const baseInsert = buildInsertStatement({ columns: insertColumns, values: insertValues });

  const updateAssignments = [];
  if (columns.has('offer_id')) {
    updateAssignments.push('offer_id = EXCLUDED.offer_id');
  }
  if (columns.has('uid')) {
    updateAssignments.push('uid = EXCLUDED.uid');
  }
  if (columns.has('user_id')) {
    updateAssignments.push('user_id = EXCLUDED.user_id');
  }
  if (columns.has('event_id')) {
    updateAssignments.push('event_id = EXCLUDED.event_id');
  }
  if (columns.has('state')) {
    updateAssignments.push('state = EXCLUDED.state');
  }
  if (columns.has('created_at')) {
    updateAssignments.push('created_at = NOW()');
  }

  const conflictTarget = columns.has('tg_id') ? '(click_id, tg_id)' : '(click_id)';
  const upsertSql =
    updateAssignments.length > 0
      ? `${baseInsert.sql} ON CONFLICT ${conflictTarget} DO UPDATE SET ${updateAssignments.join(', ')}`
      : `${baseInsert.sql} ON CONFLICT ${conflictTarget} DO NOTHING`;

  try {
    await query(upsertSql, baseInsert.values);
  } catch (error) {
    if (error?.code !== '42P10' && error?.code !== '42704') {
      throw error;
    }

    const updateParams = [];
    const updateAssignmentsFallback = [];

    if (columns.has('offer_id')) {
      updateParams.push(normalized.offerId);
      updateAssignmentsFallback.push(`offer_id=$${updateParams.length}`);
    }
    if (columns.has('uid')) {
      updateParams.push(normalized.uid);
      updateAssignmentsFallback.push(`uid=$${updateParams.length}`);
    }
    if (columns.has('user_id')) {
      updateParams.push(normalized.userId);
      updateAssignmentsFallback.push(`user_id=$${updateParams.length}`);
    }
    if (columns.has('event_id')) {
      updateParams.push(normalized.eventId);
      updateAssignmentsFallback.push(`event_id=$${updateParams.length}`);
    }
    if (columns.has('state')) {
      updateAssignmentsFallback.push(`state='started'`);
    }
    if (columns.has('created_at')) {
      updateAssignmentsFallback.push('created_at=NOW()');
    }

    const whereClauses = [];
    if (columns.has('click_id')) {
      updateParams.push(normalized.clickId);
      whereClauses.push(`click_id=$${updateParams.length}`);
    }
    if (columns.has('tg_id')) {
      updateParams.push(normalized.tgId);
      whereClauses.push(`tg_id=$${updateParams.length}`);
    }

    let updated = false;
    if (updateAssignmentsFallback.length && whereClauses.length) {
      const updateSql = `UPDATE attribution SET ${updateAssignmentsFallback.join(', ')} WHERE ${whereClauses.join(' AND ')}`;
      const result = await query(updateSql, updateParams);
      updated = result.rowCount > 0;
    }

    if (!updated) {
      try {
        await query(baseInsert.sql, baseInsert.values);
      } catch (insertError) {
        if (insertError?.code !== '23505') {
          throw insertError;
        }
      }
    }
  }

  console.log('[ATTR] upserted', {
    click_id: normalized.clickId,
    offer_id: normalized.offerId,
    tg_id: normalized.tgId,
    uid: normalized.uid,
    user_id: normalized.userId,
  });
}

export function resetCache() {
  attributionColumnsPromise = null;
}
