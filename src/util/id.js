import { randomUUID } from 'crypto';

export function uuid() { return randomUUID(); }

export function shortToken() {
  // 16 base62-ish chars
  const buf = Buffer.alloc(12);
  for (let i=0;i<12;i++) buf[i] = Math.floor(Math.random()*256);
  return buf.toString('base64url');
}
