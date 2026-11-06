import { migrate, pool } from './db';
import { connection } from './redis';
import { ensureSenders } from './senders';
import { ensureIndex } from './search';
import { reconcile } from './reconcile';
import { startWorker } from './processor';

/** Standalone worker process: `npm run worker`. Run N of these to scale out; limits are Redis-backed. */
async function main() {
  await migrate();
  await ensureSenders();
  await ensureIndex();
  await reconcile();
  const worker = startWorker();

  const shutdown = async () => {
    await worker.close();
    await pool.end();
    connection.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
