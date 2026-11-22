import http from 'node:http';
import { config, assertProductionSafety, ensureDirs } from './config.js';
import { createApp } from './app.js';
import { migrate } from './db/index.js';
import { initRealtime, closeRealtime } from './lib/realtime.js';
import { seedIfEmpty } from './db/seed.js';

async function main() {
  assertProductionSafety();
  ensureDirs();

  const migration = await migrate();
  console.log(`[db] schema ready (driver: ${migration.driver})`);

  if (process.env.AUTO_SEED !== 'false') {
    await seedIfEmpty();
  }

  const app = createApp();
  const server = http.createServer(app);
  initRealtime(server);

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`[api] listening on http://0.0.0.0:${config.port} (env: ${config.env})`);
    console.log(`[api] analytics service: ${config.analyticsUrl}`);
  });

  const shutdown = async (signal) => {
    console.log(`[api] ${signal} received, shutting down`);
    await closeRealtime();
    server.close(async () => {
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[api] failed to start', err);
  process.exit(1);
});
