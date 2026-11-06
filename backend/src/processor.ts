import { Job, Worker, DelayedError } from 'bullmq';
import { config } from './config';
import { connection } from './redis';
import { EmailJobData, QUEUE_NAME } from './queue';
import { EmailRow, pool } from './db';
import { HOUR_MS, reserveSlot, windowOf } from './rateLimiter';
import { getSender } from './senders';
import { sendEmail } from './mailer';
import { indexEmails } from './search';
import { notifyRateLimitHit } from './slack';

async function processEmail(job: Job<EmailJobData>, token?: string) {
  const { emailId } = job.data;
  const { rows } = await pool.query<EmailRow>('SELECT * FROM emails WHERE id=$1', [emailId]);
  const email = rows[0];

  // Idempotency guard #1: terminal rows are never processed again.
  if (!email || email.status === 'sent' || email.status === 'failed') return { skipped: true };

  const now = Date.now();
  const currentWindow = windowOf(now);
  const limit = Math.min(email.hourly_limit ?? Infinity, config.maxEmailsPerHourPerSender);

  // ---- Hourly rate limit (Redis, shared by all workers) ----
  if (job.data.reservedWindow === undefined) {
    const slot = await reserveSlot(email.sender_id, limit, now);
    await job.updateData({ ...job.data, reservedWindow: slot.window });

    if (slot.window > currentWindow) {
      // Current hour is full: push this job into the next window with capacity (never dropped/failed).
      // Offsetting by slot.index * minDelay keeps FIFO-ish order and avoids a thundering herd.
      const runAt = slot.window * HOUR_MS + slot.index * config.minDelayMs;
      await pool.query('UPDATE emails SET scheduled_at=$2, updated_at=now() WHERE id=$1', [emailId, new Date(runAt)]);
      const sender = await getSender(email.sender_id);
      void notifyRateLimitHit({
        userId: email.user_id,
        senderEmail: sender.email,
        senderId: sender.id,
        window: currentWindow,
        limit,
        resumeAt: new Date(slot.window * HOUR_MS),
      });
      await job.moveToDelayed(runAt, token);
      throw new DelayedError();
    }
  } else if (job.data.reservedWindow > currentWindow) {
    // Woken before the reserved window opened (clock skew / manual promote): go back to sleep.
    await job.moveToDelayed(job.data.reservedWindow * HOUR_MS, token);
    throw new DelayedError();
  }

  // Idempotency guard #2: atomic claim. Only one worker can flip scheduled -> processing.
  // A 'processing' row is only re-claimable after 2 minutes (crashed worker / stalled job).
  const claim = await pool.query<EmailRow>(
    `UPDATE emails SET status='processing', locked_at=now(), attempts=attempts+1, updated_at=now()
     WHERE id=$1 AND (status='scheduled' OR (status='processing' AND locked_at < now() - interval '2 minutes'))
     RETURNING *`,
    [emailId],
  );
  if (!claim.rows[0]) return { skipped: true };

  try {
    const sender = await getSender(email.sender_id);
    const result = await sendEmail(sender, claim.rows[0]);
    const done = await pool.query<EmailRow>(
      `UPDATE emails SET status='sent', sent_at=now(), message_id=$2, preview_url=$3, error=NULL, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [emailId, result.messageId, result.previewUrl],
    );
    void indexEmails(done.rows);
    return { sent: true, previewUrl: result.previewUrl };
  } catch (err) {
    const message = (err as Error).message;
    const isFinal = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    const upd = await pool.query<EmailRow>(
      `UPDATE emails SET status=$2, error=$3, updated_at=now() WHERE id=$1 RETURNING *`,
      [emailId, isFinal ? 'failed' : 'scheduled', message],
    );
    void indexEmails(upd.rows);
    throw err; // BullMQ handles backoff/retry
  }
}

export function startWorker(): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>(QUEUE_NAME, processEmail, {
    connection,
    concurrency: config.workerConcurrency,
    // Minimum delay between sends: at most 1 job per MIN_DELAY_BETWEEN_EMAILS_MS across all workers of this queue.
    limiter: { max: 1, duration: config.minDelayMs },
  });
  worker.on('completed', (job) => console.log(`[worker] job ${job.id} done`));
  worker.on('failed', (job, err) => console.warn(`[worker] job ${job?.id} failed: ${err.message}`));
  worker.on('error', (err) => console.error('[worker] error', err));
  console.log(`[worker] started (concurrency=${config.workerConcurrency}, minDelay=${config.minDelayMs}ms)`);
  return worker;
}
