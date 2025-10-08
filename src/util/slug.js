// src/util/slug.js
import { randomUUID } from 'node:crypto';

export function slugifyBase(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);
}

export function makeSlug(name) {
  const base = slugifyBase(name || 'offer');
  const tail = randomUUID().slice(0, 5);
  return `${base}-${tail}`;
}
