import { ApiError } from './error.js';

/**
 * Fixed-window in-memory rate limiter / throttle.
 *
 * Demonstrates the concepts behind API throttling: a counter per key inside
 * a sliding window, Retry-After for clients and X-RateLimit-* headers.
 * The store is a plain Map - in production swap it for Redis (INCR + EXPIRE)
 * so the limit is shared across processes. See docs/SCALING_CACHING.md.
 */
export function createRateLimiter({ windowMs, max, keyFn, name = 'api' }) {
  const buckets = new Map(); // key -> { count, resetAt }

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
  }, Math.max(windowMs, 30_000));
  sweeper.unref?.();

  function middleware(req, res, next) {
    const key = keyFn ? keyFn(req) : req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return next(
        ApiError.tooMany(
          'rate_limited',
          `Too many requests. Try again in ${retryAfter} second${retryAfter === 1 ? '' : 's'}.`,
        ),
      );
    }
    return next();
  }

  middleware._limiterName = name;
  middleware._reset = () => buckets.clear(); // exposed for tests
  return middleware;
}

/** e.g. login: 5 attempts / 15 min per ip+identifier -> brute-force protection */
export function createLoginLimiter(config) {
  return createRateLimiter({
    windowMs: config.loginRateLimitWindowMs,
    max: config.loginRateLimitMax,
    name: 'login',
    keyFn: (req) => {
      const id =
        (req.body && (req.body.identifier || req.body.email)) || 'unknown';
      return `login:${req.ip}:${String(id).toLowerCase()}`;
    },
  });
}
