# Scalability and Caching Strategies

Split into **implemented in this codebase** (run it, observe it) and **architecture
notes for scale-out** (documented decisions, swap points marked in code).

## 1. Scaling: horizontal vs vertical

- **Vertical scaling** (bigger machine) is the default for SQLite - simple, but has a ceiling.
- **Horizontal scaling** (more nodes) requires shared state to move out of the process:
  - sessions/refresh tokens already live in the **database**, not in process memory ->
    any node with the same DB can serve the request (statelessness preserved).
  - the two in-process stores (HTTP cache, rate-limit counters) are the swap points - both
    are isolated in `src/lib/cache.js` and `src/middleware/rateLimit.js` and documented
    as "replace Map with Redis" for multi-node deployments.

### Load balancing algorithms

| Algorithm | Behavior | Trade-off |
|---|---|---|
| **Round-robin** | requests rotate across nodes in order | simple, ignores node load |
| **Least-connections** | pick the node with fewest active requests | better under uneven request cost; needs connection tracking |

Both live in the reverse proxy in front of the app (NGINX `upstream` blocks). A typical
production shape:

```
Internet -> CDN -> NGINX (TLS, static assets, rate limit) -> LB -> N x app nodes -> SQLite(file)/Postgres
                                                        \-> Redis (cache + counters shared)
```

## 2. Database scaling

- **Read replicas**: classic primary/replica split - writes hit the primary, reads are
  distributed to replicas (eventual consistency lag is acceptable for roadmap *content*,
  not for "did my progress save" - that reads-your-writes).
- **Sharding**: split data by key (`user_id` range/hash) across databases when one node
  cannot hold the write load; cost: cross-shard joins and transactions disappear, so
  schemas are denormalized around access patterns first.
- This project's seed dataset (~45 roadmaps, ~2.8k markdown articles, few thousand rows of
  runtime data) fits comfortably on one node - replicas/shards are documented as the next
  step, not implemented.

## 3. In-memory caching with Redis (patterns)

Implemented in [`backend/src/lib/cache.js`](../backend/src/lib/cache.js) with an in-process
Map; the semantics match a Redis deployment one-to-one:

| Pattern | Where |
|---|---|
| **Cache-aside (lazy population)** | `cache.wrap(key, ttl, producer)` - `GET list` first checks the cache, on miss runs SQL and stores the result. See `routes/v1/roadmaps.js`. |
| **Write-through / invalidation** | every `POST/PUT/PATCH/DELETE` calls `cache.invalidate('roadmaps:')` so the next read repopulates (stale entries can never be served after a write). |
| **TTL design** | short TTL for the volatile list view (`CACHE_LIST_TTL=60s`), longer for immutable-ish detail pages (`CACHE_DETAIL_TTL=300s`). TTL is also the safety net if an invalidation is ever missed. |
| **Observability** | `X-Cache: HIT|MISS` response header, `GET /api/v1/health` reports `{hits, misses, size, hitRate}`. |

Redis production mapping:

```
cache-aside:  const v = await redis.get(key)  ...  await redis.set(key, json, 'EX', ttl)
rate limit:   INCR key + EXPIRE key window   (instead of an in-memory counter)
```

## 4. CDN for static assets

- Roadmap diagrams, fonts and images under `public/` are served with
  `Cache-Control: public, max-age=86400` by Express - a CDN (Cloudflare/CloudFront) can sit
  in front and cache them at the edge unchanged (immutable fingerprinting would allow
  `max-age=1y, immutable`).
- API list/detail responses ship `Cache-Control: public, max-age=<ttl>` + `ETag` so
  browsers/proxies may revalidate (`304`) - CDN caching of JSON is safe *because* writes
  invalidate the origin cache and TTLs are short.

## 5. Rate limiting and throttling

[`backend/src/middleware/rateLimit.js`](../backend/src/middleware/rateLimit.js) - fixed
window per key with headers:

| Limiter | Key | Default |
|---|---|---|
| general API | IP | 300 / min (`RATE_LIMIT_MAX`) |
| login | IP + identifier | 5 / 15 min (brute-force guard) |
| register | IP + email | 10 / hour |
| OAuth token | IP | 30 / min |

Responses carry `X-RateLimit-Limit/Remaining/Reset`, and `429` adds `Retry-After`.
Sliding-window or token-bucket (Redis Lua) are the usual upgrades; the middleware
signature (`keyFn`, `windowMs`, `max`) is designed so only the store changes.

## 6. Quick experiments

```bash
# observe cache-aside
curl -sD - http://localhost:3000/api/v1/roadmaps?limit=2 | grep -i x-cache   # MISS
curl -sD - http://localhost:3000/api/v1/roadmaps?limit=2 | grep -i x-cache   # HIT

# observe ETag revalidation
ET=$(curl -sD - -o /dev/null http://localhost:3000/api/v1/roadmaps?limit=2 | grep -i etag | cut -d' ' -f2)
curl -s -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $ET" http://localhost:3000/api/v1/roadmaps?limit=2   # 304

# observe rate limiting
for i in $(seq 1 6); do
  curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3000/api/v1/auth/login \
    -H 'content-type: application/json' -d '{"identifier":"x@y.z","password":"nope123"}'
done   # 401 x5 then 429
```
