const DEFAULT_TIMEOUT_MS = 5000;

export async function sendPostback({
  offerId,
  eventType,
  tgId,
  clickId = null,
  uid = null,
  postbackUrl,
}) {
  if (!offerId || !eventType || !tgId) {
    console.error('[POSTBACK] invalid payload', { offerId, eventType, tgId });
    return null;
  }

  if (!postbackUrl || typeof postbackUrl !== 'string' || !postbackUrl.trim()) {
    console.debug(
      '[POSTBACK] skipped',
      `${eventType} by ${tgId} for offer ${offerId}: postback_url missing`,
    );
    return { skipped: true };
  }

  const body = {
    offer_id: offerId,
    event_type: eventType,
    tg_id: tgId,
    click_id: clickId,
    uid,
  };

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(postbackUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const ms = Date.now() - startedAt;

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('[POSTBACK] failed', {
        offerId,
        eventType,
        tgId,
        status: response.status,
        ms,
        text,
      });
      throw new Error(`Postback responded with ${response.status}${text ? `: ${text}` : ''}`);
    }

    console.log(`[POSTBACK] sent {status: ${response.status}, ms: ${ms}}`);
    return { status: response.status, ms };
  } catch (error) {
    const ms = Date.now() - startedAt;
    console.error('[POSTBACK] error', {
      offerId,
      eventType,
      tgId,
      ms,
      error: error?.message || error,
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export default sendPostback;
