export function buildTrackingUrl(offerId, extra = {}) {
  const base = (process.env.BASE_URL || '').replace(/\/$/, '');
  const useStartApp = String(process.env.USE_STARTAPP || 'true').toLowerCase() === 'true';
  const q = new URLSearchParams();
  Object.entries(extra).forEach(([k, v]) => q.append(k, String(v)));
  // сервер при клике создаёт start_token и редиректит:
  const url = `${base}/click/${offerId}${q.toString() ? `?${q}` : ''}`;
  return { url, mode: useStartApp ? 'startapp' : 'start' };
}
