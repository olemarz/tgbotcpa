import express from 'express';
import { bot } from '../bot/telegraf.js';
import { query } from '../db/index.js';
import { verifyInitData } from '../utils/tgInitData.js';

export const waRouter = express.Router();

function toTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

waRouter.post('/claim', async (req, res) => {
  const body = req.body ?? {};
  const token = toTrimmedString(body.token);
  const initData = toTrimmedString(body.initData);

  if (!token) {
    return res.status(400).json({ ok: false, error: 'TOKEN_REQUIRED' });
  }

  if (!initData) {
    return res.status(400).json({ ok: false, error: 'INIT_DATA_REQUIRED' });
  }

  const verification = verifyInitData(initData);
  if (!verification.ok || !verification.user?.id) {
    return res.status(401).json({ ok: false, error: verification.error ?? 'INIT_DATA_INVALID' });
  }

  const startParam = verification.start_param;
  if (startParam && startParam !== token) {
    return res.status(400).json({ ok: false, error: 'TOKEN_MISMATCH' });
  }

  const tgId = verification.user.id;

  try {
    const result = await query(
      'UPDATE clicks SET tg_id = $1, used_at = COALESCE(used_at, now()) WHERE start_token = $2',
      [tgId, token],
    );

    if (result.rowCount > 0) {
      try {
        await bot.telegram.sendMessage(tgId, 'Новая задача доступна: /ads');
      } catch (notifyError) {
        console.error('[wa.claim] notify error', notifyError);
      }

      return res.json({ ok: true });
    }

    return res.status(404).json({ ok: false, error: 'TOKEN_NOT_FOUND' });
  } catch (error) {
    console.error('[wa.claim] update error', error);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

export default waRouter;
