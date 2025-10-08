import { createHmac } from 'node:crypto';

export function hmacSHA256Hex(secret, payload) {
  return createHmac('sha256', secret).update(payload).digest('hex');
}
