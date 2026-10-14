import { Router } from 'express';
import { query } from '../../db/index.js';
import { cache } from '../../lib/cache.js';
import config from '../../config.js';
import roadmaps from './roadmaps.js';
import auth from './auth.js';
import me from './me.js';
import oauth from './oauth.js';

const router = Router();

/**
 * GET /api/v1/health - liveness/readiness style endpoint.
 * The /api/v1 prefix in the URL is the API versioning strategy; a client
 * may also send `X-API-Version: v1` (echoed back in responses).
 */
router.get('/health', (req, res) => {
  let dbStatus = 'up';
  try {
    query.get('SELECT 1 AS ok');
  } catch {
    dbStatus = 'down';
  }
  res.setHeader('X-API-Version', config.apiVersion);
  res.json({
    status: dbStatus === 'up' ? 'ok' : 'degraded',
    version: config.apiVersion,
    uptimeSeconds: Math.round(process.uptime()),
    database: dbStatus,
    cache: cache.stats(),
    timestamp: new Date().toISOString(),
  });
});

router.use('/roadmaps', roadmaps);
router.use('/auth', auth);
router.use('/me', me);
router.use('/oauth', oauth);

export default router;
