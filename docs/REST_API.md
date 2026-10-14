# RESTful API Design

How the roadmap API applies the architectural principles of REST.

## 1. Architectural principles

| Principle | How it is applied here |
|---|---|
| **Statelessness** | Every request carries its own identity - either `Authorization: Bearer <JWT>` or the `sid` session cookie. The server keeps no per-connection state; anything needed lives in SQLite (sessions, tokens) and is looked up per request (`src/middleware/auth.js`). |
| **Uniform interface** | Resources are addressed with URIs, manipulated with the standard verbs, representations are self-describing (`Content-Type: application/json`) and responses carry hypermedia-ish `links` for pagination. |
| **Resource orientation** | Nouns, not verbs: `/roadmaps`, `/roadmaps/{slug}/topics`, `/me/progress`. Actions that are not resources are still modeled as sub-resources (`/auth/login`, `/oauth/token`). |
| **Cacheability** | Every response says how it may be cached: `Cache-Control`, `ETag`, `304 Not Modified`, plus an `X-Cache: HIT\|MISS` debug header showing the server-side cache-aside result. |
| **Layered system** | The API is mountable behind any reverse proxy (NGINX) - `trust proxy` is on so `req.ip`/protocol stay correct behind it. |

## 2. Resource naming and URI design

```
/api/v1/roadmaps                    # collection
/api/v1/roadmaps/frontend           # one item (slug = stable identifier)
/api/v1/roadmaps/frontend/topics    # sub-resource collection
/api/v1/roadmaps/frontend/topics/102-css
/api/v1/me/progress                 # private collection for the caller
/api/v1/me/progress/frontend/102-css
/api/v1/oauth/clients               # registered OAuth apps
```

Rules used:
- plural nouns (`roadmaps`, not `getRoadmaps`)
- hierarchy expresses containment (`/roadmaps/{slug}/topics`)
- query strings for **filtering/sorting/pagination**, never for changing the resource
- no verbs in paths; the HTTP method is the verb

## 3. HTTP methods and idempotency

| Method | On collection | On item | Idempotent? |
|---|---|---|---|
| `GET` | list (paginated) | fetch | yes (safe) |
| `POST` | **create** (201 + `Location`) | n/a | no - guarded with `Idempotency-Key` |
| `PUT` | 405-style `404 route_not_found` | full replace | **yes** - repeating leaves the same state |
| `PATCH` | - | partial update | no (semantically), safe to retry here |
| `DELETE` | - | remove | **yes** - repeated deletes keep returning `204` |

**Idempotency-Key**: `POST /api/v1/roadmaps` stores `(key, endpoint, user, request hash)`
in the `idempotency_keys` table. A retry with the same key + payload replays the original
response with `Idempotency-Replayed: true`; the same key with a *different* payload is a
`422 idempotency_key_conflict`. This makes network retries safe.

## 4. Status codes and error handling

Conventions (enforced by `src/middleware/error.js`):

| Code | Meaning in this API |
|---|---|
| 200 / 201 / 204 | ok / created (with `Location`) / no content |
| 304 | `If-None-Match` matched the `ETag` |
| 400 | validation failed (`validation_error` with per-field `details`) or malformed JSON (`invalid_json`) |
| 401 | no/invalid credentials (`authentication_required`, `invalid_token`, `invalid_credentials`, `refresh_token_*`) |
| 403 | authenticated but not allowed (`insufficient_role`, `cross_origin_rejected`) |
| 404 | resource missing (`roadmap_not_found`, `topic_not_found`, `route_not_found`) |
| 409 | state conflict (`slug_exists`, `email_taken`, `username_taken`) |
| 413 | body too large |
| 422 | semantic problem (`idempotency_key_conflict`) |
| 429 | rate limited (`rate_limited` + `Retry-After`) |
| 500 | `internal_error` - details are logged server-side, never leaked |

Error envelope (OAuth endpoints deliberately use the RFC 6749 shape instead):

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [{ "field": "limit", "message": "\"limit\" must be less than or equal to 100" }]
  }
}
```

Success envelope:

```json
{ "data": { "...": "resource(s)" } }
```

## 5. API versioning strategies

Three common strategies:

1. **URI versioning** - `/api/v1/...` (used here: explicit, cacheable, visible in logs)
2. **Header versioning** - e.g. `Accept: application/vnd.api.v1+json` (cleaner URLs, harder to test in a browser)
3. **Query-param versioning** - `?version=1` (easy, but pollutes the cache key)

This API uses URI versioning and additionally accepts/echoes `X-API-Version: v1` on
responses, so a header-based client can detect the served version.

## 6. Payload design: pagination, filtering, sorting

`GET /api/v1/roadmaps` supports:

```
?page=1&limit=24                 # pagination (limit capped at 100)
&search=react                    # fuzzy match on title/description
&category=framework              # exact filters: category, tag, difficulty
&sort=title&order=asc             # whitelisted sort columns only (no SQL injection)
```

Response:

```json
{
  "data": [ { "slug": "react", "title": "React Developer", "...": "..." } ],
  "meta": { "page": 2, "limit": 24, "total": 45, "totalPages": 2 },
  "links": { "self": "?page=2&limit=24", "prev": "?page=1&limit=24", "next": "?page=3&limit=24" }
}
```

- `sort` is validated against a whitelist mapped to real columns (`SORT_COLUMNS`), then the
  direction is constrained to `asc|desc` - values never reach SQL unchecked.
- Offset pagination is used for simplicity; a cursor (`WHERE id > ?`) is the natural upgrade
  for large, frequently-changing collections.

## 7. Rate limiting headers

```
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 287
X-RateLimit-Reset: 1771000000
Retry-After: 42                 # only on 429
```

## 8. API documentation (OpenAPI / Swagger)

- Spec: [`backend/src/openapi.js`](../backend/src/openapi.js) - OpenAPI **3.1**, served at `GET /api/openapi.json`
- Interactive docs: **`GET /api/docs`** - Swagger UI (Try-it-out enabled) with `cookieAuth`
  and `bearerAuth` security schemes declared
- The spec describes every endpoint, schema, parameter, status code and the two OAuth grants.

Quick test from a terminal:

```bash
curl http://localhost:3000/api/v1/roadmaps?limit=2
curl http://localhost:3000/api/v1/roadmaps/frontend
```
