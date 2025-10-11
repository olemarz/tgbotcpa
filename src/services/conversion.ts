import { db } from '../db/index.js';
import { sendPostback } from '../integrations/postback.js';

type CreateConversionArgs = {
  offer_id: string;
  tg_id: number;
  amount_cents: number;
};

export async function createConversion({ offer_id, tg_id, amount_cents }: CreateConversionArgs) {
  return db.one(
    `
    INSERT INTO conversions(offer_id, tg_id, amount_cents)
    VALUES($1,$2,$3)
    RETURNING id
  `,
    [offer_id, tg_id, amount_cents]
  );
}

type ApproveJoinArgs = {
  offer_id: string;
  tg_id: number;
  click_id?: string | number | null;
  amount_cents?: number | null;
};

export type ConversionRecord = {
  id: string;
  offer_id: string;
  tg_id: number;
  amount_cents: number;
  postback_status: string | null;
  postback_response: string | null;
  created_at: string;
};

const DEFAULT_POSTBACK_MISSING_MESSAGE = 'postback_url missing';

type OfferDetails = {
  payout_cents: number | null;
  postback_url: string | null;
};

function buildPostbackResponse(status?: number | null, text?: string | null) {
  const parts = [status?.toString() ?? '', text?.trim() ?? ''].map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

async function fetchOfferDetails(offerId: string): Promise<OfferDetails> {
  const row = await db.one(
    `SELECT payout_cents, postback_url FROM offers WHERE id=$1`,
    [offerId]
  );
  return row as OfferDetails;
}

function resolveAmount(provided: number | null | undefined, fallback: number | null) {
  if (typeof provided === 'number' && Number.isFinite(provided)) {
    return Math.round(provided);
  }
  if (typeof fallback === 'number' && Number.isFinite(fallback)) {
    return Math.round(fallback);
  }
  return 0;
}

export async function createConversion({ offer_id, tg_id, click_id, amount_cents }: CreateConversionArgs) {
  const offer = await fetchOfferDetails(offer_id);
  const amount = resolveAmount(amount_cents, offer.payout_cents);
  const hasPostbackUrl = typeof offer.postback_url === 'string' && offer.postback_url.trim().length > 0;

  const conversion = (await db.one(
    `
    INSERT INTO conversions(offer_id, tg_id, amount_cents, postback_status, postback_response)
    VALUES($1, $2, $3, $4, $5)
    RETURNING id, offer_id, tg_id, amount_cents, postback_status, postback_response, created_at
  `,
    [offer_id, tg_id, amount, hasPostbackUrl ? 'pending' : 'skipped', hasPostbackUrl ? null : DEFAULT_POSTBACK_MISSING_MESSAGE]
  )) as ConversionRecord;

  if (!hasPostbackUrl) {
    return conversion;
  }

  const result = await sendPostback({
    template: offer.postback_url,
    vars: {
      offer_id,
      tg_id,
      click_id: click_id ?? '',
      amount_cents: amount,
    },
  });

  const postbackStatus = result.ok ? 'sent' : 'failed';
  const postbackResponse = buildPostbackResponse(result.status, result.text);

  await db.none(`UPDATE conversions SET postback_status=$1, postback_response=$2 WHERE id=$3`, [
    postbackStatus,
    postbackResponse,
    conversion.id,
  ]);

  return {
    ...conversion,
    postback_status: postbackStatus,
    postback_response: postbackResponse,
  };
}

type ApproveJoinArgs = {
  offer_id: string;
  tg_id: number;
  click_id?: string | number | null;
};

export async function approveJoin({ offer_id, tg_id, click_id }: ApproveJoinArgs) {
  return createConversion({ offer_id, tg_id, click_id });
}
