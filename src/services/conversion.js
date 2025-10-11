import { db } from '../db/index.js';
import { sendPostback } from '../integrations/postback.js';

export async function approveJoin({ offer_id, tg_id, click_id }) {
  const offer = await db.one(`SELECT payout_cents, postback_url FROM offers WHERE id=$1`, [offer_id]);
  const conv = await db.one(
    `
    INSERT INTO conversions(offer_id,tg_id,amount_cents,postback_status)
    VALUES($1,$2,$3,'pending') RETURNING id
  `,
    [offer_id, tg_id, offer.payout_cents]
  );
  if (offer.postback_url) {
    const r = await sendPostback({
      template: offer.postback_url,
      vars: { offer_id, tg_id, click_id: click_id || '', amount_cents: offer.payout_cents },
    });
    await db.none(`UPDATE conversions SET postback_status=$1, postback_response=$2 WHERE id=$3`, [
      r.ok ? 'sent' : 'failed',
      `${r.status || ''} ${r.text || ''}`,
      conv.id,
    ]);
  }
  return conv;
}
