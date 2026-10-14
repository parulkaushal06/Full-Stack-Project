# Syllabus -> Implementation Mapping

Where each topic of the course outline lives in this repository.
(Requirement: **frontend in plain HTML/CSS/JavaScript**, backend implementing the full
backend syllabus - frontend framework topics are therefore covered by their vanilla-JS
equivalents and by the responsive/accessibility topics.)

## Weeks 1-2: RESTful API Design

| Topic | Where |
|---|---|
| Statelessness, uniform interface, resource orientation | [`docs/REST_API.md`](./REST_API.md) §1, `backend/src/middleware/auth.js` |
| Resource naming / URI design | `backend/src/routes/v1/*`, `docs/REST_API.md` §2 |
| GET/POST/PUT/PATCH/DELETE + idempotency | `backend/src/routes/v1/roadmaps.js`, tests `roadmaps.test.js` (PUT/DELETE idempotency, `Idempotency-Key` replay) |
| Status codes + error conventions | `backend/src/middleware/error.js`, tests assert 400/401/403/404/409/422/429 |
| API versioning (URI/header/query) | `/api/v1` prefix + `X-API-Version` header echo (`docs/REST_API.md` §5) |
| Payload design, pagination/filtering/sorting | `GET /api/v1/roadmaps` (`meta`+`links`, whitelisted `sort`), tests `roadmaps.test.js` |
| OpenAPI/Swagger documentation | `backend/src/openapi.js` -> `GET /api/openapi.json`, Swagger UI at `GET /api/docs` |

## Weeks 3-4: Database Design

| Topic | Where |
|---|---|
| ER diagram, primary/foreign keys | [`docs/DATABASE_DESIGN.md`](./DATABASE_DESIGN.md) §1-2 (mermaid ERD), `migrations/001_init.sql` |
| Normalization 1NF-3NF | `docs/DATABASE_DESIGN.md` §3 |
| Indexing + query optimization basics | `docs/DATABASE_DESIGN.md` §4 (`CREATE INDEX` list, `EXPLAIN QUERY PLAN`) |
| NoSQL modeling (Mongo/Redis/Dynamo/Cassandra) | `docs/DATABASE_DESIGN.md` §5 (mapping + when each fits); in-memory key-value cache = `backend/src/lib/cache.js` |
| SQL vs NoSQL decision | `docs/DATABASE_DESIGN.md` §5 decision table |
| Schema migrations | `backend/src/db/migrate.js` (ordered, transactional, recorded) + `docs/DATABASE_DESIGN.md` §6 |

## Weeks 5-6: Authentication and Authorization

| Topic | Where |
|---|---|
| Session-based auth + cookies | `sessions` table, `sid` HttpOnly cookie (`services/tokenService.js`), tests `auth.test.js` |
| OAuth 2.0 authorization code + client credentials | `backend/src/routes/v1/oauth.js` (PKCE, single-use codes), tests `oauth.test.js` |
| JWT structure, signing, expiry, refresh tokens | `services/tokenService.js` (HS256, 15 min access, rotating refresh + reuse detection), `docs/AUTH.md` §2 |
| RBAC + permission scoping | `middleware/auth.js` `requireRole('admin')`, scope claims in OAuth tokens, tests (403 for non-admin) |
| CSRF / XSS / brute-force defense | `requireSameOrigin`, CSP + `HttpOnly` + `escapeHtml`, login rate limiter (5/15 min), `docs/AUTH.md` §5 |

## Weeks 7-8: Scalability and Caching

| Topic | Where |
|---|---|
| Horizontal vs vertical scaling | `docs/SCALING_CACHING.md` §1 |
| Load balancing (round-robin, least-connections), NGINX | `docs/SCALING_CACHING.md` §1 (architecture + algorithm table) |
| Read replicas + sharding basics | `docs/SCALING_CACHING.md` §2 |
| Redis caching, cache-aside / write-through | implemented cache-aside + invalidation in `lib/cache.js`, `docs/SCALING_CACHING.md` §3 |
| CDN for static assets | `express.static(public, maxAge)` + `docs/SCALING_CACHING.md` §4 |
| Cache invalidation + TTL design | `cache.invalidate('roadmaps:')` on writes, 60s/300s TTLs, `docs/SCALING_CACHING.md` §3 |
| Rate limiting / throttling | `middleware/rateLimit.js` (4 limiters + headers + 429), tests `auth.test.js` |

## Weeks 9-10: Hands-on - Building APIs with Node.js

| Topic | Where |
|---|---|
| Project structure + routing | `backend/src/{routes,middleware,services,lib,db}` |
| CRUD endpoints | `routes/v1/roadmaps.js` |
| Request validation (Joi = JS Pydantic) | `middleware/validate.js` + Joi schemas per route, 400 with per-field details |
| ORM/ODM -> database | data access via a typed query layer over SQLite prepared statements (`db/index.js`); rationale + migration tooling in `docs/DATABASE_DESIGN.md` (raw SQL chosen for teaching clarity; swap-in point is a single module) |
| Authentication middleware | `middleware/auth.js` |
| Automated API tests (Postman/pytest equivalent) | **vitest + supertest: 50 tests, 4 suites** (`backend/tests/`) |
| Interactive API documentation | `GET /api/docs` (Swagger UI, Try-it-out) |

## Weeks 11-12: Modern Web Frameworks (requirement: plain HTML/CSS/JS)

| Topic (React/Vue) | Vanilla equivalent in this build |
|---|---|
| Component-based architecture | page modules with focused render functions (`js/home.js` `renderCards`, `js/roadmap.js` `renderTopics`) |
| JSX/templates | template literals + `escapeHtml` (`js/util.js`) |
| Virtual DOM / efficient updates | small, targeted DOM writes (render only the affected list); `details` elements for cheap state |
| Props and composition | data passed as function arguments; `data-*` attributes as component inputs |
| Lifecycle / hooks (useState, useEffect) | `DOMContentLoaded` module boot + `details.addEventListener('toggle')` for lazy loads |
| Conditional rendering, lists and keys | ternaries + `key`-like `data-topic`/`data-*` attributes on generated lists |
| Scaffolding with Vite/CRA | **not needed** - no build step; plain files served by Express |

## Weeks 13-14: State Management and Data Fetching

| Topic | Where |
|---|---|
| Local vs global state | URL query params = global view state (`js/util.js` `setParams`), component-local state in closures |
| Context/Redux (actions, reducers, store) | `js/state.js` `createStore` + `authStore` (subscribe/set pattern) |
| React Query/SWR (caching, revalidation) | server-side cache-aside + `ETag/304` revalidation; client fetch wrappers in `js/api.js` |
| Loading / error / optimistic UI states | status lines with `aria-live`, skeleton grid, retry buttons, **optimistic progress toggle with rollback** (`js/roadmap.js` `toggleTopic`) |
| Async side effects | `async/await` event handlers with try/catch + typed `ApiError` |

## Weeks 15-16: Responsive Design and Accessibility

| Topic | Where |
|---|---|
| Mobile-first + breakpoints | `frontend/css/styles.css` (base styles + `@media (max-width: 640px/800px)`) |
| CSS Grid + Flexbox | `.grid` auto-fill cards, `.toolbar/.site-nav/.account-grid` flex layouts |
| Semantic HTML + ARIA | `header/nav/main/section/article/footer`, `aria-live` status regions, `role="progressbar"`, `aria-pressed` chips, `aria-expanded`-style `details`, labels on every control, skip-link |
| WCAG 2.1 (perceivable/operable/understandable/robust) | AA contrast palette, visible `:focus-visible` outlines, `prefers-reduced-motion` support, descriptive titles/placeholders, error text linked to fields |
| Keyboard + screen-reader testing | all controls native (`button/input/a/details`), `.visually-hidden` labels, `role="status"` async announcements |
| Color contrast / inclusive design | muted text `#a7b4c8` on `#0d1117` (>7:1), state never conveyed by color alone (badges carry text) |

## Running everything

```bash
npm run install:backend   # once
npm start                 # http://localhost:3000  (frontend + API)
npm test                  # 50 backend tests
```
