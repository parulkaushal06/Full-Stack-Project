import config from './config.js';
import { runSeed } from './db/seed.js';
import { createApp } from './app.js';

if (config.jwtSecret.startsWith('dev-only') && config.nodeEnv === 'production') {
  console.warn('[warn] JWT_SECRET is still the development default - set a real secret!');
}

// Auto-migrate + auto-seed on boot (seed is a no-op once data exists)
const result = runSeed();
if (!result.skipped) {
  console.log(
    `[seed] ${result.roadmaps} roadmaps, ${result.topics} topics, ${result.articles} articles`,
  );
}
if (result.adminId) {
  console.log(`[seed] created admin user "${config.adminUsername}" (${config.adminEmail})`);
}

const app = createApp();

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`roadmap API + frontend listening on http://0.0.0.0:${config.port}`);
  console.log(`  API docs:  http://localhost:${config.port}/api/docs`);
  console.log(`  Health:    http://localhost:${config.port}/api/v1/health`);
  console.log(`  Frontend:  http://localhost:${config.port}/`);
});

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));

export default server;
