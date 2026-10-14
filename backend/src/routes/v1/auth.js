import { Router } from 'express';
import Joi from 'joi';
import config from '../../config.js';
import { query } from '../../db/index.js';
import { ApiError } from '../../middleware/error.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireSameOrigin } from '../../middleware/auth.js';
import { createLoginLimiter } from '../../middleware/rateLimit.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import {
  signAccessToken,
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllSessions,
  createSession,
  setSessionCookie,
  setRefreshCookie,
  clearAuthCookies,
} from '../../services/tokenService.js';

const router = Router();

const registerSchema = Joi.object({
  email: Joi.string().email().max(254).required(),
  username: Joi.string()
    .pattern(/^[a-zA-Z0-9_-]{3,30}$/)
    .message('username must be 3-30 chars: letters, numbers, _ or -')
    .required(),
  password: Joi.string()
    .min(8)
    .max(72)
    .pattern(/[a-zA-Z]/)
    .pattern(/[0-9]/)
    .message('password must be at least 8 characters and contain a letter and a number')
    .required(),
});

const loginSchema = Joi.object({
  identifier: Joi.string().trim().min(1).max(254).required(),
  password: Joi.string().min(1).max(72).required(),
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().allow('', null),
});

function publicUser(user) {
  return { id: user.id, email: user.email, username: user.username, role: user.role };
}

/** Issue session cookie + access/refresh token pair (both auth styles). */
function issueAuth(req, res, user) {
  const session = createSession(user.id, {
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });
  const accessToken = signAccessToken(user);
  const refreshToken = createRefreshToken(user.id);

  setSessionCookie(res, session);
  setRefreshCookie(res, refreshToken);

  return {
    user: publicUser(user),
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: 900, // seconds; matches config.jwtAccessTtl ('15m')
    sessionExpiresAt: Date.now() + session.maxAge,
  };
}

/* =========================================================== REGISTER ==== */
router.post(
  '/register',
  requireSameOrigin,
  createLoginLimiter({ ...config, loginRateLimitMax: config.registerRateLimitMax, loginRateLimitWindowMs: config.rateLimitWindowMs * 60 }),
  validate({ body: registerSchema }),
  (req, res, next) => {
    try {
      const { email, username, password } = req.body;

      if (query.get('SELECT id FROM users WHERE email = ?', email)) {
        return next(ApiError.conflict('email_taken', 'An account with this email already exists'));
      }
      if (query.get('SELECT id FROM users WHERE username = ?', username)) {
        return next(ApiError.conflict('username_taken', 'This username is already taken'));
      }

      const { lastInsertRowid } = query.run(
        'INSERT INTO users (email, username, password_hash, role) VALUES (?, ?, ?, ?)',
        email,
        username,
        hashPassword(password),
        'user',
      );
      const user = query.get('SELECT id, email, username, role FROM users WHERE id = ?', lastInsertRowid);

      const data = issueAuth(req, res, user);
      res.setHeader('Location', '/api/v1/auth/me');
      return res.status(201).json({ data });
    } catch (err) {
      return next(err);
    }
  },
);

/* ============================================================== LOGIN ==== */
router.post(
  '/login',
  requireSameOrigin,
  createLoginLimiter(config),
  validate({ body: loginSchema }),
  (req, res, next) => {
    try {
      const { identifier, password } = req.body;
      const user = query.get(
        'SELECT * FROM users WHERE email = ? OR username = ?',
        identifier,
        identifier,
      );

      // Same generic error for unknown user and wrong password (no user
      // enumeration) and always run the KDF to keep timing similar.
      const stored = user
        ? user.password_hash
        : hashPassword(password);
      const ok = verifyPassword(password, stored) && Boolean(user);

      if (!ok || !user) {
        return next(
          ApiError.unauthorized('invalid_credentials', 'Incorrect email/username or password'),
        );
      }

      const data = issueAuth(req, res, user);
      return res.status(200).json({ data });
    } catch (err) {
      return next(err);
    }
  },
);

/* ============================================================ REFRESH ==== */
/* Rotating refresh tokens: the presented token is consumed and a brand new
   one is issued. Presenting a consumed token revokes the whole family.      */
router.post(
  '/refresh',
  requireSameOrigin,
  validate({ body: refreshSchema }),
  (req, res, next) => {
    try {
      const token = req.body.refreshToken || req.cookies?.[config.refreshCookieName];
      if (!token) {
        return next(ApiError.unauthorized('refresh_token_missing', 'No refresh token supplied'));
      }

      let rotated;
      try {
        rotated = rotateRefreshToken(token);
      } catch (err) {
        clearAuthCookies(res);
        return next(ApiError.unauthorized(err.code || 'invalid_refresh_token', err.message || 'Invalid refresh token'));
      }

      const user = query.get('SELECT id, email, username, role FROM users WHERE id = ?', rotated.userId);
      if (!user) {
        return next(ApiError.unauthorized('invalid_refresh_token', 'User no longer exists'));
      }

      const accessToken = signAccessToken(user);
      setRefreshCookie(res, rotated.refreshToken);
      return res.status(200).json({
        data: {
          user: publicUser(user),
          accessToken,
          refreshToken: rotated.refreshToken,
          tokenType: 'Bearer',
          expiresIn: 900,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

/* ============================================================= LOGOUT ==== */
router.post('/logout', requireSameOrigin, (req, res, next) => {
  try {
    if (req.authType === 'session' && req.sessionId) {
      // delete the server side session -> cookie becomes useless
      query.run('UPDATE sessions SET revoked_at = ? WHERE id = ?', Date.now(), req.sessionId);
    }
    const refreshToken = req.body?.refreshToken || req.cookies?.[config.refreshCookieName];
    if (refreshToken) revokeRefreshToken(refreshToken);

    clearAuthCookies(res);
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
});

/* =============================================================== ME ====== */
router.get('/me', requireAuth, (req, res) => {
  res.json({
    data: {
      user: publicUser(req.user),
      authType: req.authType,
    },
  });
});

/* Revoke every session/token of the current user (account wide logout). */
router.post('/logout-all', requireSameOrigin, requireAuth, (req, res, next) => {
  try {
    revokeAllSessions(req.user.id);
    clearAuthCookies(res);
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
});

export default router;
