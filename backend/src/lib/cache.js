/**
 * Tiny in-memory cache used with the **cache-aside** (lazy population)
 * pattern:
 *
 *   GET list  -> cache.get(key)  -> miss -> SQL query -> cache.set(key, ttl)
 *   POST/PUT..-> cache.invalidate('roadmaps:')  -> next GET repopulates
 *
 * TTL design: short TTL for list queries (they change together), longer for
 * details. The Map is process local - in production replace it with Redis
 * (cache-aside via redis.get/SET NX EX) so all nodes share it.
 */
const store = new Map(); // key -> { value, expiresAt }
let hits = 0;
let misses = 0;

function isFresh(entry) {
  return entry && (entry.expiresAt === 0 || Date.now() < entry.expiresAt);
}

export const cache = {
  get(key) {
    const entry = store.get(key);
    if (isFresh(entry)) {
      hits += 1;
      return entry.value;
    }
    if (entry) store.delete(key);
    misses += 1;
    return undefined;
  },

  has(key) {
    return isFresh(store.get(key));
  },

  set(key, value, ttlSeconds = 60) {
    store.set(key, {
      value,
      expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0,
    });
    return value;
  },

  /** Drop every key starting with `prefix` (invalidation on write). */
  invalidate(prefix = '') {
    let removed = 0;
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) {
        store.delete(key);
        removed += 1;
      }
    }
    return removed;
  },

  /** Cache-aside helper: returns { value, hit }. */
  wrap(key, ttlSeconds, producer) {
    const cached = this.get(key);
    if (cached !== undefined) return { value: cached, hit: true };
    const value = producer();
    this.set(key, value, ttlSeconds);
    return { value, hit: false };
  },

  stats() {
    return { hits, misses, size: store.size, hitRate: hits + misses ? hits / (hits + misses) : 0 };
  },

  clear() {
    store.clear();
    hits = 0;
    misses = 0;
  },
};

export default cache;
