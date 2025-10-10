import { createHmac } from 'node:crypto';

export function hmacSHA256Hex(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('hex');
}
