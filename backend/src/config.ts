
import 'dotenv/config';

const str = (key: string, fallback = ''): string =>
  process.env[key] ?? fallback;

const num = (key: string, fallback: number): number => {
  const v = process.env[key];
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const bool = (key: string, fallback: boolean): boolean => {
  const v = process.env[key];
  return v === undefined
    ? fallback
    : ['1', 'true', 'yes'].includes(v.toLowerCase());
};

export const config = {
  port: num('PORT', 4000),

  appUrl: str('APP_URL', 'http://localhost:5173').replace(/\/$/, ''),

  jwtSecret: str('JWT_SECRET', 'dev-secret-change-me'),

  databaseUrl: str(
    'DATABASE_URL',
    'postgres://reachinbox:reachinbox@localhost:5432/reachinbox'
  ),

  redisUrl: str('REDIS_URL', 'redis://localhost:6379'),

  elasticsearchUrl: str(
    'ELASTICSEARCH_URL',
    'http://localhost:9200'
  ),

  google: {
    clientId: str('GOOGLE_CLIENT_ID'),
    clientSecret: str('GOOGLE_CLIENT_SECRET'),
  },

  slack: {
    clientId: str('SLACK_CLIENT_ID'),
    clientSecret: str('SLACK_CLIENT_SECRET'),
  },

  workerConcurrency: num('WORKER_CONCURRENCY', 5),
  minDelayMs: num('MIN_DELAY_BETWEEN_EMAILS_MS', 2000),
  maxEmailsPerHourPerSender: num('MAX_EMAILS_PER_HOUR_PER_SENDER', 200),
  senderCount: num('SENDER_COUNT', 3),
  runWorkerInApi: bool('RUN_WORKER_IN_API', true),

  adminUser: str('ADMIN_USER', 'admin'),
  adminPass: str('ADMIN_PASS', 'admin'),
};
