import { ApiError } from './error.js';
import { query } from '../db/index.js';
import { verifyAccessToken, getSessionUser } from '../services/tokenService.js';
import config from '../config.js';

/**
 * Resolves the caller on every request (never rejects - just sets req.user):
 *   1. Authorization: Bearer <access JWT>  -> token-based auth (API clients)
 *   2. sid session cookie                  -> session-based auth (browser)
 */
export function attachUser(req, _res, next) {
  req.user = null;
  req.authType = null;

  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    const payload = verifyAccessToken(header.slice(7));
    if (payload) {
      const user = query.get(
        'SELECT id, email, username, role FROM users WHERE id = ?',
        Number(payload.sub),
      );
      if (user) {
        req.user = user;
        req.authType = 'jwt';
        req.scope = payload.scope || 'read write';
        return next();
      }
    }
    // Invalid/expired bearer token: do not fall back silently to cookies -
    // the client explicitly tried token auth and must refresh.
    return next(ApiError.unauthorized('invalid_token', 'Access token is invalid or expired'));
  }

  const sessionId = req.cookies?.[config.sessionCookieName];
  const row = getSessionUser(sessionId);
  if (row) {
    req.user = { id: row.id, email: row.email, username: row.username, role: row.role };
    req.sessionId = row.session_id;
    req.authType = 'session';
  }
  return next();
}

/** 401 unless a valid identity was resolved. */
export function requireAuth(req, _res, next) {
  if (!req.user) {
    return next(
      ApiError.unauthorized('authentication_required', 'You must be signed in to do this'),
    );
  }
  return next();
}

/** Role based access control (RBAC). requireRole('admin') -> 403 otherwise. */
export function requireRole(role) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('authentication_required', 'You must be signed in to do this'));
    }
    if (req.user.role !== role) {
      return next(
        ApiError.forbidden('insufficient_role', `This action requires the "${role}" role`),
      );
    }
    return next();
  };
}

/**
 * CSRF protection for state changing requests.
 *
 * Browsers always attach `Origin` on cross-origin (and same-origin POST)
 * fetches. Non-browser clients (curl, Postman, tests) send no Origin and are
 * allowed; if an Origin IS present it must match the Host. Combined with
 * SameSite=Lax session cookies this blocks classic CSRF.
 */
export function requireSameOrigin(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const origin = req.headers.origin;
  if (!origin) return next(); // non-browser client

  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return next(ApiError.forbidden('invalid_origin', 'Malformed Origin header'));
  }

  const host = req.headers.host;
  const forwardedHost = req.headers['x-forwarded-host'];

  if (originHost !== host && (!forwardedHost || originHost !== forwardedHost)) {
    return next(
      ApiError.forbidden('cross_origin_rejected', 'Cross-origin requests are not allowed'),
    );
  }
  return next();
}
