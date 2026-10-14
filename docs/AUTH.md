# Authentication and Authorization

Two first-class auth styles share one identity model (see
[`backend/src/middleware/auth.js`](../backend/src/middleware/auth.js)):

1. **session cookie** - used by the browser frontend
2. **Bearer JWT** - used by API clients (Postman, scripts, OAuth clients)

`attachUser()` resolves both on every request; endpoints then call `requireAuth` /
`requireRole('admin')`.

## 1. Session-based authentication + cookies

- `POST /api/v1/auth/register` / `login` insert a row into `sessions`
  (opaque 24-byte id, user agent, IP, expiry) and set the cookie:

```
Set-Cookie: sid=<opaque>; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800
```

- Every subsequent request looks the id up (`getSessionUser`) - revoking the row
  (`logout`, `logout-all`, reuse detection) instantly invalidates the cookie because
  **all state lives server side**.
- Cookies are `HttpOnly` (JavaScript cannot read them -> XSS cannot steal the session) and
  `SameSite=Lax` (not sent on cross-site POSTs -> first CSRF line of defense).

## 2. Token-based authentication with JWT

Access tokens are JWTs (`jsonwebtoken`, HS256):

```
header    {"alg":"HS256","typ":"JWT"}
payload   {"sub":"2","role":"user","username":"sara","scope":"read write",
           "type":"access","iat":...,"exp":...,"iss":"roadmap-api","aud":"roadmap-api-v1"}
signature HMAC-SHA256(base64url(header) + "." + base64url(payload), JWT_SECRET)
```

- **Structure**: three dot-separated base64url parts; the signature proves integrity -
  changing any payload claim breaks verification.
- **Expiry**: `exp` = 15 minutes (`JWT_ACCESS_TTL`). Expired -> `401 invalid_token`.
- **Refresh tokens** (7 days) carry `type: refresh` + a random `jti` that is **stored
  server-side** in `refresh_tokens`:

```
POST /api/v1/auth/refresh  ->  consumes the old token (used_at = now)
                             ->  issues a fresh access + refresh pair (rotation)
```

- **Reuse detection**: presenting an already-consumed refresh token means it was likely
  stolen -> every refresh token **and session of that user is revoked** and the client gets
  `401 refresh_token_reused` (classic rotation family rule).
- Refresh tokens are also set as an `rt` cookie scoped to `/api/v1/auth` so the browser can
  refresh silently; API clients read `refreshToken` from the JSON body.

## 3. OAuth 2.0 flows (implemented)

Register an app first (`POST /api/v1/oauth/clients` -> `clientId`, `clientSecret` shown once).

### Authorization code flow (+ PKCE)

```
1. Browser:  GET /api/v1/oauth/authorize?response_type=code&client_id=...&
                redirect_uri=https://app/cb&state=xyz&code_challenge=...&code_challenge_method=S256
             - signed out  -> 302 /login.html?next=...  (login first)
             - signed in, redirect_uri matches registration -> 302 https://app/cb?code=...&state=xyz
2. Client:   POST /api/v1/oauth/token
                grant_type=authorization_code&code=...&redirect_uri=...&
                client_id=...&client_secret=...&code_verifier=...
             - verifies the code: unused, unexpired, same client, same redirect_uri
             - PKCE: sha256(verifier).base64url == code_challenge
             -> { access_token, token_type: "Bearer", expires_in: 900, scope }
```

The authorization code is **single use** (second exchange -> `invalid_grant`).

### Client credentials flow (machine to machine)

```
POST /api/v1/oauth/token
  grant_type=client_credentials&client_id=...&client_secret=...
-> access token scoped to the client's registered scopes
```

OAuth endpoints answer with the RFC 6749 envelope
`{ "error": "invalid_grant", "error_description": "..." }`, codes 400/401.

## 4. Role-Based Access Control (RBAC)

- `users.role ∈ {user, admin}` with a `CHECK` constraint in SQL.
- `requireRole('admin')` guards all mutating roadmap endpoints
  (`POST/PUT/PATCH/DELETE /api/v1/roadmaps`); regular authenticated users get `403
  insufficient_role`, anonymous callers `401`.
- Scope: OAuth access tokens carry a `scope` claim (`read write` by default).
- Tests: `backend/tests/roadmaps.test.js` ("RBAC: normal user POST roadmap -> 403").

## 5. Securing APIs against common threats

| Threat | Defense in this codebase |
|---|---|
| **CSRF** | `SameSite=Lax` cookies + `requireSameOrigin` middleware: a mutation carrying an `Origin` that does not match `Host` is rejected with `403 cross_origin_rejected` (tested). No `GET` ever mutates state. |
| **XSS** | sessions in `HttpOnly` cookies; strict `Content-Security-Policy` (`script-src 'self'`); the frontend escapes all API-supplied text (`escapeHtml`) before `innerHTML`; only trusted, admin-controlled markdown is rendered server-side. |
| **Brute force** | fixed-window rate limiter: login = 5 attempts / 15 min per IP+identifier (`429` + `Retry-After`), register/oauth/general limits also configured. Same generic `401 invalid_credentials` for unknown user vs wrong password + a dummy scrypt run -> no user enumeration and flattened timing. |
| **Credential theft at rest** | passwords hashed with **scrypt** (N=16384, r=8, p=1, 16-byte salt, constant-time compare); client secrets hashed the same way. |
| **Token theft** | short-lived access tokens (15 min) + rotating refresh tokens with server-side revocation and reuse detection. |
| **Injection** | every SQL statement is a prepared statement with positional `?` parameters; sort columns come from a whitelist. |

Run the security tests:

```bash
cd backend && npm test -- auth.test.js roadmaps.test.js
```
