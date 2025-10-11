import express from 'express';
import crypto from 'crypto';
import { db } from '../db/index.js';

export const waRouter = express.Router();

function verifyInitData(initData) {
  const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
  if (!BOT_TOKEN || !initData) return { ok: false, error: 'NO_TOKEN_OR_INITDATA' };
  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get('hash'); urlParams.delete('hash');
  const dataCheckString = Array.from(urlParams.entries())
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([k,v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const check = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (check !== hash) return { ok: false, error: 'BAD_SIGNATURE' };
  const user = JSON.parse(urlParams.get('user') || '{}');
  const start_param = urlParams.get('start_param') || '';
  return { ok: true, user, start_param };
}

waRouter.post('/claim', async (req, res) => {
  try {
    const { token = '', initData = '' } = req.body || {};
    const v = verifyInitData(initData);
    if (!v.ok) return res.status(401).json({ ok: false, error: v.error });
    const tgId = v.user?.id;
    const effectiveToken = token || v.start_param || '';
    if (!effectiveToken) return res.status(400).json({ ok: false, error: 'NO_TOKEN' });
    const result = await db.result(
      'UPDATE clicks SET tg_id=$1, used_at=COALESCE(used_at, now()) WHERE start_token=$2',
      [tgId, effectiveToken]
    );
    if (result.rowCount > 0) return res.json({ ok: true });
    return res.status(404).json({ ok: false, error: 'TOKEN_NOT_FOUND' });
  } catch (e) {
    console.error('wa/claim error', e); return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});
