import type { Request, Response } from 'express';
import { query } from '../db/index.js';
import { normalizeToISO2 } from '../util/geo.js';

const GEO_MODES = new Set(['any', 'whitelist', 'blacklist']);
const UUID_REGEXP = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type GeoMode = 'any' | 'whitelist' | 'blacklist';

type GeoParseResult = {
  geoMode: GeoMode;
  geoList: string[];
};

type GeoPatchResult = {
  geoMode?: GeoMode;
  geoModeProvided: boolean;
  geoList?: string[];
  geoListProvided: boolean;
};

class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function respondError(res: Response, error: unknown) {
  if (error instanceof HttpError) {
    const payload: Record<string, unknown> = { ok: false, error: error.message };
    if (error.details !== undefined) {
      payload.details = error.details;
    }
    return res.status(error.status).json(payload);
  }

  console.error('[offers] unexpected error', error);
  return res.status(500).json({ ok: false, error: 'internal_error' });
}

function ensureUuid(value: unknown) {
  if (typeof value !== 'string' || !UUID_REGEXP.test(value)) {
    throw new HttpError(400, 'offer_id must be a valid UUID');
  }
  return value;
}

function toStringOrNull(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const stringValue = String(value).trim();
  return stringValue || null;
}

function parseRequiredString(value: unknown, field: string) {
  if (typeof value !== 'string') {
    throw new HttpError(400, `${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new HttpError(400, `${field} must be a non-empty string`);
  }
  return trimmed;
}

function parseOptionalString(value: unknown, field: string) {
  const parsed = toStringOrNull(value);
  if (parsed === undefined) {
    return undefined;
  }
  return parsed;
}

function parseOptionalInteger(value: unknown, field: string) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new HttpError(400, `${field} must be a number`);
  }
  return Math.round(numeric);
}

function parseOptionalJson(value: unknown, field: string) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'object') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      throw new HttpError(400, `${field} must be valid JSON`, { cause: error instanceof Error ? error.message : error });
    }
  }
  throw new HttpError(400, `${field} must be an object`);
}

function ensureGeoMode(value: unknown, { allowDefault }: { allowDefault: boolean }) {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (GEO_MODES.has(normalized)) {
      return normalized as GeoMode;
    }
    if (!normalized && allowDefault) {
      return 'any';
    }
    throw new HttpError(400, `geo_mode must be one of: ${Array.from(GEO_MODES).join(', ')}`);
  }

  if (value === undefined || value === null) {
    if (allowDefault) {
      return 'any';
    }
    throw new HttpError(400, `geo_mode must be one of: ${Array.from(GEO_MODES).join(', ')}`);
  }

  throw new HttpError(400, `geo_mode must be one of: ${Array.from(GEO_MODES).join(', ')}`);
}

function parseGeoForCreate(body: Record<string, unknown>): GeoParseResult {
  const geoMode = ensureGeoMode(body.geo_mode, { allowDefault: true });
  const input = body.geo_input;
  let geoList: string[] = [];

  if (typeof input === 'string' && input.trim()) {
    geoList = normalizeToISO2(input);
  } else if (input === undefined || input === null || (typeof input === 'string' && !input.trim())) {
    geoList = [];
  } else if (input !== undefined) {
    throw new HttpError(400, 'geo_input must be a string');
  }

  if (geoMode !== 'any' && geoList.length === 0) {
    throw new HttpError(400, 'geo_input must contain at least one country for whitelist/blacklist geo_mode');
  }

  return { geoMode, geoList };
}

function parseGeoForPatch(body: Record<string, unknown>): GeoPatchResult {
  const result: GeoPatchResult = { geoModeProvided: false, geoListProvided: false };

  if ('geo_mode' in body) {
    result.geoModeProvided = true;
    result.geoMode = ensureGeoMode(body.geo_mode, { allowDefault: false });
  }

  if ('geo_input' in body) {
    result.geoListProvided = true;
    const rawInput = body.geo_input;
    if (typeof rawInput === 'string') {
      result.geoList = rawInput.trim() ? normalizeToISO2(rawInput) : [];
    } else if (rawInput === null) {
      result.geoList = [];
    } else {
      throw new HttpError(400, 'geo_input must be a string');
    }
  }

  if (result.geoModeProvided && result.geoMode && result.geoMode !== 'any' && result.geoListProvided) {
    if (!result.geoList || result.geoList.length === 0) {
      throw new HttpError(400, 'geo_input must contain at least one country for whitelist/blacklist geo_mode');
    }
  }

  return result;
}

function buildCreateInsert(body: Record<string, unknown>, geo: GeoParseResult) {
  const columns: string[] = [];
  const values: unknown[] = [];

  const targetUrl = parseRequiredString(body.target_url, 'target_url');
  columns.push('target_url');
  values.push(targetUrl);

  const eventType = parseRequiredString(body.event_type, 'event_type');
  columns.push('event_type');
  values.push(eventType);

  const name = parseOptionalString(body.name, 'name');
  if (name !== undefined) {
    columns.push('name');
    values.push(name);
  }

  const slug = parseOptionalString(body.slug, 'slug');
  if (slug !== undefined) {
    columns.push('slug');
    values.push(slug);
  }

  const baseRate = parseOptionalInteger(body.base_rate, 'base_rate');
  if (baseRate !== undefined) {
    columns.push('base_rate');
    values.push(baseRate);
  }

  const premiumRate = parseOptionalInteger(body.premium_rate, 'premium_rate');
  if (premiumRate !== undefined) {
    columns.push('premium_rate');
    values.push(premiumRate);
  }

  const capsTotal = parseOptionalInteger(body.caps_total, 'caps_total');
  if (capsTotal !== undefined) {
    columns.push('caps_total');
    values.push(capsTotal);
  }

  const chatRef = parseOptionalJson(body.chat_ref, 'chat_ref');
  if (chatRef !== undefined) {
    columns.push('chat_ref');
    values.push(chatRef);
  }

  columns.push('geo_mode');
  values.push(geo.geoMode);

  columns.push('geo_list');
  values.push(geo.geoList);

  return { columns, values };
}

function buildPatchUpdate(body: Record<string, unknown>, geo: GeoPatchResult) {
  const sets: string[] = [];
  const values: unknown[] = [];

  const targetUrl = parseOptionalString(body.target_url, 'target_url');
  if (targetUrl !== undefined) {
    sets.push(`target_url = $${values.length + 1}`);
    values.push(targetUrl);
  }

  const eventType = parseOptionalString(body.event_type, 'event_type');
  if (eventType !== undefined) {
    sets.push(`event_type = $${values.length + 1}`);
    values.push(eventType);
  }

  const name = parseOptionalString(body.name, 'name');
  if (name !== undefined) {
    sets.push(`name = $${values.length + 1}`);
    values.push(name);
  }

  const slug = parseOptionalString(body.slug, 'slug');
  if (slug !== undefined) {
    sets.push(`slug = $${values.length + 1}`);
    values.push(slug);
  }

  const baseRate = parseOptionalInteger(body.base_rate, 'base_rate');
  if (baseRate !== undefined) {
    sets.push(`base_rate = $${values.length + 1}`);
    values.push(baseRate);
  }

  const premiumRate = parseOptionalInteger(body.premium_rate, 'premium_rate');
  if (premiumRate !== undefined) {
    sets.push(`premium_rate = $${values.length + 1}`);
    values.push(premiumRate);
  }

  const capsTotal = parseOptionalInteger(body.caps_total, 'caps_total');
  if (capsTotal !== undefined) {
    sets.push(`caps_total = $${values.length + 1}`);
    values.push(capsTotal);
  }

  const chatRef = parseOptionalJson(body.chat_ref, 'chat_ref');
  if (chatRef !== undefined) {
    sets.push(`chat_ref = $${values.length + 1}`);
    values.push(chatRef);
  }

  if (geo.geoModeProvided && geo.geoMode) {
    sets.push(`geo_mode = $${values.length + 1}`);
    values.push(geo.geoMode);
  }

  let nextGeoList: string[] | undefined;
  if (geo.geoListProvided) {
    nextGeoList = geo.geoList ?? [];
  } else if (geo.geoModeProvided && geo.geoMode === 'any') {
    nextGeoList = [];
  }

  if (nextGeoList !== undefined) {
    sets.push(`geo_list = $${values.length + 1}`);
    values.push(nextGeoList);
  }

  sets.push(`updated_at = now()`);

  return { sets, values };
}

export async function createOffer(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const geo = parseGeoForCreate(body);
    const { columns, values } = buildCreateInsert(body, geo);

    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const text = `INSERT INTO offers (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
    const result = await query(text, values);
    return res.status(201).json({ ok: true, data: result.rows[0] ?? null });
  } catch (error) {
    return respondError(res, error);
  }
}

export async function patchOffer(req: Request, res: Response) {
  try {
    const params = req.params ?? {};
    const offerId = ensureUuid(params.offerId ?? params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const geo = parseGeoForPatch(body);
    const { sets, values } = buildPatchUpdate(body, geo);

    if (sets.length === 1 && sets[0] === 'updated_at = now()') {
      throw new HttpError(400, 'No fields to update');
    }

    const text = `UPDATE offers SET ${sets.join(', ')} WHERE id = $${values.length + 1} RETURNING *`;
    const result = await query(text, [...values, offerId]);
    if (result.rowCount === 0) {
      throw new HttpError(404, 'Offer not found');
    }
    return res.json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return respondError(res, error);
  }
}
