export function buildTrackingUrl({ baseUrl, offerId, uid, source, sub1, sub2 }) {
  const normalizedBase = (baseUrl || '').replace(/\/$/, '');
  const u = new URL(`${normalizedBase}/click/${offerId}`);
  if (uid) u.searchParams.set('uid', String(uid));
  if (source) u.searchParams.set('source', String(source));
  if (sub1) u.searchParams.set('sub1', String(sub1));
  if (sub2) u.searchParams.set('sub2', String(sub2));
  return u.toString();
}

export function buildStartDeepLink({ botUsername, token }) {
  const u = new URL(`https://t.me/${botUsername}`);
  u.searchParams.set('start', token);
  return u.toString();
}
