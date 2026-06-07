// In-memory cache with TTL — survives until the process restarts.
// Keeps API usage low and responses fast for popular tabs.

const store = new Map();
const TTL_MS = (Number(process.env.CACHE_TTL_MIN) || 20) * 60 * 1000;

export function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function cacheSet(key, value) {
  store.set(key, { value, at: Date.now() });
}

export function cacheClear() {
  const size = store.size;
  store.clear();
  return size;
}

// Periodic prune
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (now - v.at > TTL_MS) store.delete(k);
  }
}, 60_000).unref?.();
