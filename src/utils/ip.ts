// src/utils/ip.ts

import type { IncomingMessage } from 'http';

export function getClientIp(req: IncomingMessage & { headers: any; socket?: any }): string | null {
  const h = req.headers?.['x-forwarded-for'];
  if (typeof h === 'string' && h.length > 0) {
    // берём первый адрес из цепочки
    return h.split(',')[0].trim();
  }
  if (Array.isArray(h) && h.length > 0) {
    return h[0];
  }
  return req.socket?.remoteAddress || null;
}
