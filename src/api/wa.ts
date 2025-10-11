import { Router, type Request, type Response } from 'express';

import { query } from '../db/index.js';
import { bot } from '../bot/telegraf.js';
import { verifyInitData } from '../utils/tgInitData.js';

interface ClaimRequestBody {
  token?: unknown;
  initData?: unknown;
}

export const waRouter = Router();

function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function respond(res: Response, status: number, payload: Record<string, unknown>) {
  res.status(status).json(payload);
}

waRouter.post('/claim', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as ClaimRequestBody;
  const token = toTrimmedString(body.token);
  const initData = typeof body.initData === 'string' ? body.initData : '';

  if (!token) {
    respond(res, 400, { ok: false, error: 'TOKEN_REQUIRED' });
    return;
  }

  if (!initData) {
    respond(res, 400, { ok: false, error: 'INIT_DATA_REQUIRED' });
    return;
  }

  const verification = verifyInitData(initData);
  if (!verification.ok || !verification.user?.id) {
    respond(res, 401, { ok: false, error: verification.error ?? 'INIT_DATA_INVALID' });
    return;
  }

  const startParam = verification.start_param;
  if (startParam && startParam !== token) {
    respond(res, 400, { ok: false, error: 'TOKEN_MISMATCH' });
    return;
  }

  const tgId = verification.user.id;

  try {
    const result = await query(
      'UPDATE clicks SET tg_id = $1, used_at = COALESCE(used_at, now()) WHERE start_token = $2',
      [tgId, token],
    );

    if (result.rowCount && result.rowCount > 0) {
      try {
        await bot.telegram.sendMessage(tgId, 'Новая задача доступна: /ads');
      } catch (notifyError) {
        console.error('[wa.claim] notify error', notifyError);
      }
      respond(res, 200, { ok: true });
      return;
    }

    respond(res, 200, { ok: false, error: 'TOKEN_NOT_FOUND' });
  } catch (error) {
    console.error('[wa.claim] update error', error);
    respond(res, 500, { ok: false, error: 'INTERNAL_ERROR' });
  }
});

export default waRouter;
