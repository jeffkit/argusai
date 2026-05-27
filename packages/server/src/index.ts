import { loadServerConfig } from './config.js';
import { createServerApp } from './app.js';

async function main() {
  const config = loadServerConfig();
  const app = await createServerApp(config);

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    app.log.info(`ArgusAI Server listening on ${config.HOST}:${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
