import express from 'express';
import cookieParser from 'cookie-parser';
import config from './config.js';
import { attachUser, requireSameOrigin } from './middleware/auth.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import { apiNotFoundHandler, htmlNotFoundHandler, errorHandler } from './middleware/error.js';
import v1Router from './routes/v1/index.js';
import { openApiSpec } from './openapi.js';

const DOCS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>roadmap.sh API docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style>body { margin: 0; background: #fafafa; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/api/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        tryItOutEnabled: true,
        presets: [SwaggerUIBundle.presets.apis],
        layout: 'BaseLayout'
      });
    };
  </script>
</body>
</html>`;

export function createApp() {
  const app = express();
  app.set('trust proxy', true); // correct req.ip behind a reverse proxy
  app.disable('x-powered-by');

  /* ------------------------------------------------- security headers --- */
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-API-Version', config.apiVersion);
    // XSS mitigation for the plain HTML/JS frontend (scripts/styles from self)
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; " +
        "object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
    );
    next();
  });

  app.use(cookieParser());

  /* ------------------------------------------------------ body parser --- */
  app.use('/api', express.json({ limit: '1mb' }));

  /* -------------------------------------------- throttling + CSRF ------ */
  const apiLimiter = createRateLimiter({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
    name: 'api',
  });
  if (!config.isTest) app.use('/api', apiLimiter);
  app.use('/api', requireSameOrigin);

  /* ------------------------------------------------ identity resolution - */
  app.use(attachUser);

  /* ------------------------------------------------- OpenAPI + docs ---- */
  app.get('/api', (_req, res) => {
    res.json({
      name: 'roadmap.sh API',
      version: config.apiVersion,
      documentation: '/api/docs',
      openapi: '/api/openapi.json',
      health: '/api/v1/health',
    });
  });

  app.get('/api/openapi.json', (_req, res) => {
    res.json(openApiSpec);
  });

  app.get('/api/docs', (_req, res) => {
    // Swagger UI is loaded from a CDN -> relax the CSP only for this page
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https:; " +
        "connect-src 'self'; font-src 'self' data:",
    );
    res.type('html').send(DOCS_HTML);
  });

  /* --------------------------------------------------- versioned API --- */
  app.use('/api/v1', v1Router);
  app.use('/api', apiNotFoundHandler); // unknown /api/* -> JSON 404

  /* --------------------------------------- static frontend + assets ---- */
  app.use(express.static(config.frontendDir, { extensions: ['html'] }));
  app.use(express.static(config.publicDir, { maxAge: '1d' }));

  app.use(htmlNotFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
