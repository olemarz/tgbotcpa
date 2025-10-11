import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import geoip from 'geoip-lite';
import requestIp from 'request-ip';

import { config } from '../config.js';
import { query } from '../db/index.js';
import { uuid } from '../util/id.js';
import { isAllowedByGeo } from '../utils/geo.js';

const UUID_REGEXP = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface OfferGeoRow {
  id: string;
  geo_mode: string | null;
  geo_list: string[] | string | null;
}

function isUUID(value: string): boolean {
  return UUID_REGEXP.test(value);
}

function generateStartToken(): string {
  const length = 6 + Math.floor(Math.random() * 7);
  return randomBytes(length).toString('base64url').slice(0, length);
}

function normalizeIp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice('::ffff:'.length);
  }
  return trimmed;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

async function getOfferGeo(offerId: string): Promise<OfferGeoRow | null> {
  try {
    const result = await query<OfferGeoRow>(
      'SELECT id, geo_mode, geo_list FROM offers WHERE id = $1 LIMIT 1',
      [offerId],
    );
    return result.rowCount > 0 ? result.rows[0] : null;
  } catch (error: any) {
    const errorCode = error?.code;
    const message: string = typeof error?.message === 'string' ? error.message : '';
    if (
      errorCode === '42703' ||
      errorCode === '42P01' ||
      message.includes('geo_mode') ||
      message.includes('geo_list')
    ) {
      console.warn('geo columns missing, skipping geo filter', { code: errorCode });
      return null;
    }
    throw error;
  }
}

function buildUnavailableRedirect(): string {
  const base = trimTrailingSlash(config.baseUrl || process.env.BASE_URL || '');
  if (!base) {
    return '/unavailable?reason=geo';
  }
  return `${base}/unavailable?reason=geo`;
}

export async function handleClick(req: Request, res: Response): Promise<void> {
  const { offerId } = req.params;
  if (!isUUID(offerId)) {
    res.status(400).json({ ok: false, error: 'offer_id must be UUID' });
    return;
  }

  const botUsername = config.botUsername || process.env.BOT_USERNAME || '';
  if (!botUsername) {
    res
      .status(500)
      .json({ ok: false, error: 'BOT_USERNAME is required. Please set BOT_USERNAME in the environment.' });
    return;
  }

  const offer = await getOfferGeo(offerId);
  const geoMode = offer?.geo_mode ?? null;
  const geoList = offer?.geo_list ?? null;

  const uidParam = req.query?.uid ?? req.query?.sub;
  const clickIdParam = req.query?.click_id ?? req.query?.clickId;
  const uid = uidParam !== undefined ? String(uidParam) : undefined;
  const clickId = clickIdParam !== undefined ? String(clickIdParam) : undefined;

  const ipRaw = requestIp.getClientIp(req);
  const ip = normalizeIp(ipRaw);
  const lookup = ip ? geoip.lookup(ip) : null;
  const country = lookup?.country ?? null;

  if (!isAllowedByGeo(country, geoMode, geoList)) {
    console.info('click blocked by geo', {
      offer_id: offerId,
      ip,
      country,
      geo_mode: geoMode,
      geo_list: geoList,
    });
    res.redirect(buildUnavailableRedirect());
    return;
  }

  const startToken = generateStartToken();
  const ua = req.get('user-agent') || null;

  try {
    await query(
      `INSERT INTO clicks (id, offer_id, uid, click_id, start_token, ip, ua)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uuid(), offerId, uid ?? null, clickId ?? null, startToken, ip ?? null, ua],
    );
  } catch (error: any) {
    if (error?.code === '23505') {
      res.status(503).json({ ok: false, error: 'temporary token collision, retry' });
      return;
    }
    console.error('click insert error', { error });
    res.status(500).json({ ok: false, error: 'failed to store click' });
    return;
  }

  console.log('click captured', {
    offer_id: offerId,
    uid,
    click_id: clickId,
    start_token: startToken,
    country,
  });

  const redirectUrl = `https://t.me/${botUsername}?startapp=${encodeURIComponent(startToken)}`;
  res.redirect(302, redirectUrl);
}
