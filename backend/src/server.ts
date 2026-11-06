import 'express-async-errors'; // forward rejected promises in async handlers to the error middleware
import express, { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import type { BaseAdapter } from '@bull-board/api/dist/src/queueAdapters/base';
import { ExpressAdapter } from '@bull-board/express';
import { config } from './config';
import { migrate, pool } from './db';
import { connection } from './redis';
import { emailQueue } from './queue';
import { ensureSenders } from './senders';
import { ensureIndex } from './search';
import { reconcile } from './reconcile';
import { startWorker } from './processor';
import { authRouter } from './auth';
import { apiRouter, slackCallbackRouter } from './routes';

function basicAuth(req: Request, res: Response, next: NextFunction) {
  const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, ...rest] = Buffer.from(encoded, 'base64').toString().split(':');
    if (user === config.adminUser && rest.join(':') === config.adminPass) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Bull Board"').status(401).send('Authentication required');
}

async function main() {
  await migrate();
  await ensureSenders();
  await ensureIndex();
  await reconcile();

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  // Live BullMQ dashboard
  const boardAdapter = new ExpressAdapter();
  boardAdapter.setBasePath('/admin/queues');
  // Cast: bull-board's bundled types lag behind the installed bullmq's JobProgress type (runtime is compatible).
  createBullBoard({ queues: [new BullMQAdapter(emailQueue) as unknown as BaseAdapter], serverAdapter: boardAdapter });
  app.use('/admin/queues', basicAuth, boardAdapter.getRouter());

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/auth', authRouter);
  app.use('/auth', slackCallbackRouter);
  app.use('/api', apiRouter);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[api] unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  const server = app.listen(config.port, () => console.log(`[api] listening on :${config.port}`));
  const worker = config.runWorkerInApi ? startWorker() : null;

  const shutdown = async () => {
    server.close();
    await worker?.close();
    await emailQueue.close();
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
