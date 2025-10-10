const store = new Map();
const MAX_SIZE = 5000;

function cleanup(now = Date.now()) {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(key);
    } else {
      break;
    }
  }
}

export function isDupe(key) {
  if (!key) return false;
  const now = Date.now();
  cleanup(now);
  const entry = store.get(key);
  if (!entry) return false;
  if (entry.expiresAt <= now) {
    store.delete(key);
    return false;
  }
  entry.hits = (entry.hits || 0) + 1;
  return true;
}

export function remember(key, ttlSec = 600) {
  if (!key) return;
  const now = Date.now();
  cleanup(now);
  const expiresAt = now + Math.max(1, ttlSec) * 1000;
  store.delete(key);
  store.set(key, { expiresAt, createdAt: now });
  if (store.size > MAX_SIZE) {
    const excess = store.size - MAX_SIZE;
    const keys = Array.from(store.keys());
    for (let i = 0; i < excess; i += 1) {
      store.delete(keys[i]);
    }
  }
}

export function _reset() {
  store.clear();
}
