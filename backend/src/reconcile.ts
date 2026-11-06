import { emailQueue } from './queue';
import { pool } from './db';

/**
 * Self-healing on boot: any email that Postgres says is still pending but has no live BullMQ job
 * (e.g. Redis was wiped, or the API crashed between the DB commit and queue.add) gets its job re-created.
 * Because jobId === emailId, this can never create duplicates.
 */
export async function reconcile(): Promise<number> {
  const { rows } = await pool.query<{ id: string; scheduled_at: Date }>(
    `SELECT id, scheduled_at FROM emails WHERE status IN ('scheduled','processing') ORDER BY scheduled_at`,
  );
  let restored = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const missing: typeof chunk = [];
    await Promise.all(
      chunk.map(async (r) => {
        const job = await emailQueue.getJob(r.id);
        if (!job) return void missing.push(r);
        const state = await job.getState();
        if (state === 'completed' || state === 'failed') {
          await job.remove();
          missing.push(r);
        }
      }),
    );
    if (missing.length) {
      const now = Date.now();
      await emailQueue.addBulk(
        missing.map((r) => ({
          name: 'send',
          data: { emailId: r.id },
          opts: { jobId: r.id, delay: Math.max(0, new Date(r.scheduled_at).getTime() - now) },
        })),
      );
      restored += missing.length;
    }
  }
  if (restored) console.log(`[reconcile] restored ${restored} missing job(s)`);
  return restored;
}
