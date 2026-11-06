import { Queue } from 'bullmq';
import { connection } from './redis';

export const QUEUE_NAME = 'email-queue';

export interface EmailJobData {
  emailId: string;
  /** Hour window already reserved in the rate limiter for this job (set once, survives retries/restarts). */
  reservedWindow?: number;
}

export const emailQueue = new Queue<EmailJobData>(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    // Keep finished jobs for a while: re-adding the same jobId is then a no-op (idempotent).
    removeOnComplete: { age: 3600, count: 5000 },
    removeOnFail: { age: 24 * 3600 },
  },
});
