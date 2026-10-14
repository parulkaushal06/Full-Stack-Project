import { Router } from 'express';
import crypto from 'node:crypto';
import Joi from 'joi';
import { query } from '../../db/index.js';
import { ApiError } from '../../middleware/error.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireSameOrigin } from '../../middleware/auth.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { signAccessToken } from '../../services/tokenService.js';

/**
 * Minimal but spec-shaped OAuth 2.0 authorization server.
 *
 * Flows implemented (see docs/AUTH.md):
 *   1. authorization code (+ PKCE S256) - third party apps acting on behalf
 *      of a signed in user
 *   2. client credentials - machine to machine access
 *
 * OAuth endpoints answer with the RFC 6749 error envelope
 * { error, error_description } instead of our usual { error: { ... } }.
 */
const router = Router();

const CODE_TTL_MS = 60 * 1000;

function oauthError(status, code, description) {
  const err = new Error(description);
  err.status = status;
  err.oauthCode = code;
  err.description = description;
  return err;
}

/* ====================================================== REGISTER APP ==== */
const clientSchema = Joi.object({
  name: Joi.string().trim().min(1).max(80).required(),
  redirectUri: Joi.string().uri({ scheme: ['http', 'https'] }).max(400).required(),
  grantTypes: Joi.array()
    .items(Joi.string().valid('authorization_code', 'client_credentials'))
    .min(1)
    .unique()
    .default(['authorization_code']),
  scopes: Joi.array().items(Joi.string().valid('read', 'write')).min(1).unique().default(['read']),
});

router.post('/clients', requireAuth, requireSameOrigin, validate({ body: clientSchema }), (req, res, next) => {
  try {
    const clientId = `cli_${crypto.randomBytes(12).toString('hex')}`;
    const clientSecret = crypto.randomBytes(24).toString('base64url');

    query.run(
      `INSERT INTO oauth_clients
         (client_id, client_secret_h, name, owner_user_id, redirect_uri, grant_types, scopes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      clientId,
      hashPassword(clientSecret),
      req.body.name,
      req.user.id,
      req.body.redirectUri,
      req.body.grantTypes.join(','),
      req.body.scopes.join(','),
    );

    res.setHeader('Location', `/api/v1/oauth/clients/${clientId}`);
    return res.status(201).json({
      data: {
        clientId,
        clientSecret, // shown exactly once - only its hash is stored
        name: req.body.name,
        redirectUri: req.body.redirectUri,
        grantTypes: req.body.grantTypes,
        scopes: req.body.scopes,
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/clients', requireAuth, (req, res, next) => {
  try {
    const rows = query.all(
      `SELECT client_id AS clientId, name, redirect_uri AS redirectUri, grant_types, scopes, created_at AS createdAt
         FROM oauth_clients WHERE owner_user_id = ? ORDER BY created_at DESC`,
      req.user.id,
    );
    return res.json({
      data: rows.map((r) => ({
        clientId: r.clientId,
        name: r.name,
        redirectUri: r.redirectUri,
        grantTypes: r.grant_types.split(','),
        scopes: r.scopes.split(','),
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    return next(err);
  }
});

/* ========================================================== AUTHORIZE ==== */
/* GET /api/v1/oauth/authorize?response_type=code&client_id=...&redirect_uri=...
 *      &state=...&code_challenge=...&code_challenge_method=S256            */
const authorizeSchema = Joi.object({
  response_type: Joi.string().valid('code').required(),
  client_id: Joi.string().max(80).required(),
  redirect_uri: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
  state: Joi.string().max(200).allow(''),
  code_challenge: Joi.string().max(200).allow(''),
  code_challenge_method: Joi.string().valid('S256', 'plain').default('S256'),
});

router.get('/authorize', (req, res, next) => {
  // Manual validation so redirect_uri mismatch cannot be used to bounce
  // users to arbitrary sites (validated BEFORE any redirect happens).
  const { error, value } = authorizeSchema.validate(req.query, { abortEarly: false, stripUnknown: true });
  if (error) {
    return next(oauthError(400, 'invalid_request', error.details.map((d) => d.message).join('; ')));
  }

  const client = query.get('SELECT * FROM oauth_clients WHERE client_id = ?', value.client_id);
  if (!client) return next(oauthError(400, 'invalid_client', 'Unknown client_id'));
  if (client.redirect_uri !== value.redirect_uri) {
    return next(oauthError(400, 'invalid_request', 'redirect_uri does not match the registered URI'));
  }
  if (!client.grant_types.split(',').includes('authorization_code')) {
    return next(oauthError(400, 'unauthorized_client', 'Client may not use the authorization_code grant'));
  }

  // The user must be signed in with a *session* (browser flow).
  if (!req.user) {
    const nextUrl = encodeURIComponent(req.originalUrl);
    return res.redirect(302, `/login.html?next=${nextUrl}`);
  }

  try {
    const code = crypto.randomBytes(32).toString('base64url');
    query.run(
      `INSERT INTO oauth_codes
         (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      code,
      client.client_id,
      req.user.id,
      value.redirect_uri,
      client.scopes.split(',').join(' '), // OAuth scopes are space-delimited
      value.code_challenge || null,
      value.code_challenge ? value.code_challenge_method : null,
      Date.now() + CODE_TTL_MS,
    );

    const url = new URL(value.redirect_uri);
    url.searchParams.set('code', code);
    if (value.state) url.searchParams.set('state', value.state);
    return res.redirect(302, url.toString());
  } catch (err) {
    return next(err);
  }
});

/* ============================================================== TOKEN ==== */
const tokenSchema = Joi.object({
  grant_type: Joi.string().valid('authorization_code', 'client_credentials').required(),
  code: Joi.string().max(200).allow('', null),
  redirect_uri: Joi.string().uri({ scheme: ['http', 'https'] }).allow('', null),
  client_id: Joi.string().max(80).required(),
  client_secret: Joi.string().max(300).allow('', null),
  code_verifier: Joi.string().max(200).allow('', null),
  scope: Joi.string().max(100).allow('', null),
});

router.post('/token', validate({ body: tokenSchema }), (req, res, next) => {
  try {
    const body = req.body;
    const client = query.get('SELECT * FROM oauth_clients WHERE client_id = ?', body.client_id);
    if (!client) return next(oauthError(401, 'invalid_client', 'Unknown or invalid client credentials'));

    const secretOk = body.client_secret ? verifyPassword(body.client_secret, client.client_secret_h) : false;

    /* ------------------------------------------- authorization_code ----- */
    if (body.grant_type === 'authorization_code') {
      if (!client.grant_types.split(',').includes('authorization_code')) {
        return next(oauthError(400, 'unauthorized_client', 'Client may not use this grant'));
      }
      const codeRow = body.code
        ? query.get('SELECT * FROM oauth_codes WHERE code = ?', body.code)
        : null;
      if (!codeRow || codeRow.used_at || codeRow.expires_at < Date.now()) {
        return next(oauthError(400, 'invalid_grant', 'Authorization code is invalid, expired or already used'));
      }
      if (codeRow.client_id !== body.client_id) {
        return next(oauthError(400, 'invalid_grant', 'Code was issued to a different client'));
      }
      if (body.redirect_uri !== codeRow.redirect_uri) {
        return next(oauthError(400, 'invalid_grant', 'redirect_uri does not match the code'));
      }
      // PKCE
      if (codeRow.code_challenge) {
        if (!body.code_verifier) {
          return next(oauthError(400, 'invalid_grant', 'code_verifier is required (PKCE)'));
        }
        const computed = crypto
          .createHash('sha256')
          .update(body.code_verifier)
          .digest('base64url');
        const expected =
          codeRow.code_challenge_method === 'plain' ? body.code_verifier : computed;
        if (expected !== codeRow.code_challenge) {
          return next(oauthError(400, 'invalid_grant', 'PKCE verification failed'));
        }
      }
      // Confidential clients must also present their secret
      if (!secretOk) {
        return next(oauthError(401, 'invalid_client', 'Invalid client credentials'));
      }

      query.run('UPDATE oauth_codes SET used_at = ? WHERE code = ?', Date.now(), codeRow.code);

      const user = query.get('SELECT id, username, role FROM users WHERE id = ?', codeRow.user_id);
      const accessToken = signAccessToken(user, codeRow.scope);
      return res.status(200).json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 900,
        scope: codeRow.scope,
      });
    }

    /* ------------------------------------------- client_credentials ------ */
    if (!client.grant_types.split(',').includes('client_credentials')) {
      return next(oauthError(400, 'unauthorized_client', 'Client may not use this grant'));
    }
    if (!secretOk) {
      return next(oauthError(401, 'invalid_client', 'Invalid client credentials'));
    }

    const machineUser = query.get(
      'SELECT id, username, role FROM users WHERE id = ?',
      client.owner_user_id,
    );
    const accessToken = signAccessToken(machineUser, client.scopes.split(',').join(' '));
    return res.status(200).json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 900,
      scope: client.scopes.split(',').join(' '),
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
