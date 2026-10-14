import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import { query } from '../db/index.js';

const ISSUER = 'roadmap-api';
const AUDIENCE = 'roadmap-api-v1';

/* ------------------------------------------------------------- access ---- */

export function signAccessToken(user, scope = 'read write') {
  return jwt.sign(
    {
      sub: String(user.id),
      role: user.role,
      username: user.username,
      scope,
      type: 'access',
    },
    config.jwtSecret,
    { expiresIn: config.jwtAccessTtl, issuer: ISSUER, audience: AUDIENCE },
  );
}

/** Returns the decoded payload or null when the token is invalid/expired. */
export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret, { issuer: ISSUER, audience: AUDIENCE });
    if (payload.type !== 'access') return null;
    return payload;
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------- refresh ---- */

export function createRefreshToken(userId) {
  const jti = crypto.randomUUID();
  const expiresAt = Date.now() + config.jwtRefreshTtlSeconds * 1000;
  query.run(
    'INSERT INTO refresh_tokens (jti, user_id, expires_at) VALUES (?, ?, ?)',
    jti,
    userId,
    expiresAt,
  );
  const token = jwt.sign(
    { sub: String(userId), jti, type: 'refresh' },
    config.jwtSecret,
    { expiresIn: config.jwtRefreshTtlSeconds, issuer: ISSUER, audience: AUDIENCE },
  );
  return token;
}

/**
 * Validates + consumes a refresh token (rotation).
 * Re-using an already consumed token revokes every token of that user
 * (token theft detection - the classic refresh token rotation rule).
 * Returns { userId, refreshToken } (the fresh token) or throws ApiError-ish
 * object { status, code, message }.
 */
export function rotateRefreshToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { issuer: ISSUER, audience: AUDIENCE });
  } catch {
    throw { status: 401, code: 'invalid_refresh_token', message: 'Refresh token is invalid or expired' };
  }
  if (payload.type !== 'refresh') {
    throw { status: 401, code: 'invalid_refresh_token', message: 'Not a refresh token' };
  }

  const row = query.get('SELECT * FROM refresh_tokens WHERE jti = ?', payload.jti);
  if (!row || row.revoked_at || row.expires_at < Date.now()) {
    throw { status: 401, code: 'invalid_refresh_token', message: 'Refresh token is invalid or expired' };
  }
  if (row.used_at) {
    // REUSE DETECTED -> assume theft, revoke all sessions + tokens of user
    revokeAllUserTokens(row.user_id);
    throw {
      status: 401,
      code: 'refresh_token_reused',
      message: 'Refresh token reuse detected; all sessions revoked',
    };
  }

  query.run('UPDATE refresh_tokens SET used_at = ? WHERE jti = ?', Date.now(), row.jti);
  const nextToken = createRefreshToken(row.user_id);
  return { userId: row.user_id, refreshToken: nextToken };
}

export function revokeRefreshToken(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret, { issuer: ISSUER, audience: AUDIENCE, ignoreExpiration: true });
    if (payload.type === 'refresh') {
      query.run('UPDATE refresh_tokens SET revoked_at = ? WHERE jti = ? AND revoked_at IS NULL', Date.now(), payload.jti);
    }
  } catch {
    /* already invalid -> nothing to do */
  }
}

export function revokeAllUserTokens(userId) {
  const now = Date.now();
  query.run('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', now, userId);
  query.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', now, userId);
}

/* ----------------------------------------------------------- sessions ---- */
/* Database backed sessions: the sid cookie holds an opaque id, all state
   lives server side (classic session-based authentication + cookies). */

export function createSession(userId, { userAgent, ip } = {}) {
  const id = crypto.randomBytes(24).toString('base64url');
  const expiresAt = Date.now() + config.sessionTtlMs;
  query.run(
    'INSERT INTO sessions (id, user_id, user_agent, ip, expires_at) VALUES (?, ?, ?, ?, ?)',
    id,
    userId,
    userAgent ? String(userAgent).slice(0, 255) : null,
    ip || null,
    expiresAt,
  );
  return { id, maxAge: config.sessionTtlMs };
}

export function getSessionUser(sessionId) {
  if (!sessionId) return null;
  return query.get(
    `SELECT u.id, u.email, u.username, u.role, s.id AS session_id, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ?
        AND s.revoked_at IS NULL
        AND s.expires_at > ?`,
    sessionId,
    Date.now(),
  );
}

export function revokeSession(sessionId) {
  if (!sessionId) return false;
  const { changes } = query.run(
    'UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
    Date.now(),
    sessionId,
  );
  return changes > 0;
}

export function revokeAllSessions(userId) {
  query.run(
    'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
    Date.now(),
    userId,
  );
}

/* ------------------------------------------------------------- cookies ---- */

export function setSessionCookie(res, session) {
  res.cookie(config.sessionCookieName, session.id, {
    httpOnly: true, // JS can't read it -> XSS mitigation
    sameSite: 'lax', // CSRF mitigation for cross-site POSTs
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: session.maxAge,
  });
}

export function setRefreshCookie(res, token) {
  res.cookie(config.refreshCookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/v1/auth', // only sent to the auth endpoints
    maxAge: config.jwtRefreshTtlSeconds * 1000,
  });
}

export function clearAuthCookies(res) {
  res.clearCookie(config.sessionCookieName, { path: '/' });
  res.clearCookie(config.refreshCookieName, { path: '/api/v1/auth' });
}
