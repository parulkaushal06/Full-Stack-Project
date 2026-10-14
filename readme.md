# roadmap.sh - rebuilt

The [RoboSchmied/kamranahmedse-developer-roadmap](https://github.com/RoboSchmied/kamranahmedse-developer-roadmap)
content (45 roadmaps, 556 topics, 2263 resource articles) with a **completely new frontend in
plain HTML, CSS and JavaScript** and a **full REST API backend** (Node.js + Express + SQLite).

No framework, no build step - one Node server serves the API and the static site.

## Quick start

```bash
npm run install:backend    # installs backend dependencies (once)
npm start                  # http://localhost:3000
```

First boot automatically runs migrations, seeds all roadmap content from `src/data/roadmaps`
and creates the dev admin: **admin / Admin@12345** (`admin@roadmap.local`).

| URL | What |
|---|---|
| http://localhost:3000/ | frontend (home: search, filters, sort, pagination) |
| http://localhost:3000/roadmap.html?slug=frontend | roadmap detail with topic-by-topic content + progress |
| http://localhost:3000/register.html · `/login.html` | accounts (session cookie + JWT pair) |
| http://localhost:3000/account.html | per-user progress dashboard |
| http://localhost:3000/api/docs | **interactive Swagger UI** |
| http://localhost:3000/api/v1/health | health + cache stats |

```bash
npm test          # 50 API tests (vitest + supertest), 4 suites
npm run dev       # server with --watch
npm run migrate   # apply pending SQL migrations
npm run seed      # --force to re-seed content
```

## Project structure

```
├── frontend/                 # NEW - plain HTML/CSS/JS, no build step
│   ├── index.html            #   home: search / category chips / sort / pagination
│   ├── roadmap.html          #   detail: diagram, topics, progress tracking
│   ├── login.html, register.html, account.html, 404.html
│   ├── css/styles.css        #   mobile-first design system, WCAG AA, dark theme
│   └── js/
│       ├── api.js            #   fetch wrapper + typed ApiError
│       ├── state.js          #   tiny observable store (Redux/Pinia pattern)
│       ├── util.js           #   escaping, query-string, debounce helpers
│       ├── nav.js            #   shared header: session state, logout
│       ├── home.js           #   list view: filters, sort, pagination, retry
│       ├── roadmap.js        #   topic accordion, optimistic progress sync
│       ├── auth.js           #   login/register validation + errors
│       └── account.js        #   profile + progress dashboard
├── backend/                  # NEW - REST API
│   ├── src/
│   │   ├── server.js         #   entry: migrate -> seed -> listen :3000
│   │   ├── app.js            #   express app, security headers, static, docs
│   │   ├── openapi.js        #   OpenAPI 3.1 spec -> /api/openapi.json
│   │   ├── config.js         #   env config (backend/.env)
│   │   ├── routes/v1/        #   roadmaps, auth, me/progress, oauth, health
│   │   ├── middleware/       #   auth+RBAC+CSRF, validation (Joi), rate limit, errors
│   │   ├── services/         #   JWT access/refresh, sessions, cookie handling
│   │   ├── lib/              #   cache (cache-aside), scrypt, frontmatter parser
│   │   └── db/               #   node:sqlite connection, SQL migrations, seed
│   └── tests/                #   50 tests: CRUD, RBAC, auth, OAuth, progress
├── docs/                     # design documentation (syllabus aligned)
│   ├── REST_API.md           #   REST principles, versioning, pagination, errors
│   ├── DATABASE_DESIGN.md    #   ERD, 1NF-3NF, indexes, SQL vs NoSQL, migrations
│   ├── AUTH.md               #   sessions, JWT, OAuth2 flows, RBAC, threats
│   ├── SCALING_CACHING.md    #   scaling, LB, cache-aside, TTL, rate limiting
│   └── SYLLABUS_MAPPING.md   # course topic -> file/endpoint index
├── src/data/                 # original roadmap content (markdown + JSON), unchanged
├── public/                   # original images/diagrams, served as static assets
└── scripts/                  # legacy data tooling (optional; needs extra deps)
```

## API at a glance

```bash
# collection: paginate, filter, sort, search (ETag + X-Cache headers)
curl 'http://localhost:3000/api/v1/roadmaps?category=framework&sort=title&limit=5'

# detail + topics (markdown rendered to HTML server-side)
curl http://localhost:3000/api/v1/roadmaps/frontend
curl http://localhost:3000/api/v1/roadmaps/frontend/topics/102-css

# auth: register/login issue a session cookie + JWT pair (15 min access, rotating refresh)
curl -c jar -X POST http://localhost:3000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"identifier":"admin","password":"Admin@12345"}'

# admin-only CRUD with Idempotency-Key (401/403/RBAC for everyone else)
curl -b jar -X POST http://localhost:3000/api/v1/roadmaps \
  -H 'content-type: application/json' -H 'Idempotency-Key: demo-1' \
  -d '{"slug":"demo","title":"Demo Roadmap","category":"concept"}'

# OAuth 2.0: authorization code (+PKCE) and client credentials
curl -X POST http://localhost:3000/api/v1/oauth/token \
  -H 'content-type: application/json' \
  -d '{"grant_type":"client_credentials","client_id":"...","client_secret":"..."}'
```

## Highlights

- **Frontend**: plain HTML/CSS/JS, mobile-first responsive grid, WCAG 2.1 AA
  (skip-link, ARIA live regions, focus styles, reduced-motion), loading/error/retry states,
  optimistic progress updates with rollback, local progress for signed-out visitors.
- **Backend**: 23 versioned endpoints, Joi validation, consistent error envelope,
  `ETag/304` + cache-aside (`X-Cache`), `Idempotency-Key` replay protection,
  4 rate limiters with `X-RateLimit-*`, scrypt passwords, sessions + JWT + OAuth2,
  RBAC, CSRF origin checks, OpenAPI/Swagger docs, SQL migrations and seed tooling.
- **Tests**: 50 automated API tests (`npm test`).

Configuration lives in `backend/.env` (see [`backend/.env.example`](backend/.env.example)) -
set a real `JWT_SECRET` before any real deployment.

The original Astro/React frontend was removed as part of the rebuild; roadmap content in
`src/data` and assets in `public` are untouched. Docs: [`docs/`](docs/SYLLABUS_MAPPING.md).
