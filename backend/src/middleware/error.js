import path from 'node:path';
import config from '../config.js';

/**
 * Error handling conventions (see docs/REST_API.md):
 *   - every error response body: { error: { code, message, details? } }
 *   - `code` is a stable machine readable string, `message` is human readable
 *   - 400 validation, 401 unauthenticated, 403 forbidden, 404 not found,
 *     409 conflict, 422 semantic/unprocessable, 429 rate limited, 500 server
 */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(code, message, details) {
    return new ApiError(400, code, message, details);
  }
  static unauthorized(code, message) {
    return new ApiError(401, code, message);
  }
  static forbidden(code, message) {
    return new ApiError(403, code, message);
  }
  static notFound(code, message) {
    return new ApiError(404, code, message);
  }
  static conflict(code, message, details) {
    return new ApiError(409, code, message, details);
  }
  static unprocessable(code, message, details) {
    return new ApiError(422, code, message, details);
  }
  static tooMany(code, message) {
    return new ApiError(429, code, message);
  }
  static internal(message = 'Internal server error') {
    return new ApiError(500, 'internal_error', message);
  }
}

export function apiNotFoundHandler(req, _res, next) {
  next(ApiError.notFound('route_not_found', `Cannot ${req.method} ${req.originalUrl}`));
}

export function htmlNotFoundHandler(req, res, next) {
  res.status(404);
  if (req.accepts('html')) {
    res.sendFile(path.join(config.frontendDir, '404.html'), (err) => {
      if (err) res.type('text').send('404 - Not Found');
    });
  } else {
    res.json({ error: { code: 'not_found', message: 'Resource not found' } });
  }
}

export function errorHandler(err, _req, res, _next) {
  // Malformed JSON body sent by the client
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'invalid_json', message: 'Request body is not valid JSON' },
    });
  }
  // Payload too large
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      error: { code: 'payload_too_large', message: 'Request body is too large' },
    });
  }

  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }

  // OAuth 2.0 endpoints use the RFC 6749 error envelope (docs/AUTH.md)
  if (err.oauthCode) {
    return res.status(err.status || 400).json({
      error: err.oauthCode,
      error_description: err.description || err.message,
    });
  }

  // Unknown error -> log server side, never leak stack traces to clients
  console.error('[error]', err);
  return res.status(500).json({
    error: { code: 'internal_error', message: 'Internal server error' },
  });
}
