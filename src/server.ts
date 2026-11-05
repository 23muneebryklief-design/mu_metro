import { buildApp } from './app.js';
import { loadConfig } from './config.js';

try {
  const config = loadConfig();
  const app = await buildApp(config);
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, async () => {
      if (closing) return;
      closing = true;
      try { await app.close(); process.exitCode = 0; }
      catch (error) { app.log.error(error); process.exitCode = 1; }
    });
  }
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  console.error('Backend startup failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
}
