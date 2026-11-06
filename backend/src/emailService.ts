import { randomUUID } from 'crypto';
import { z } from 'zod';
import { config } from './config';
import { EmailRow, EmailStatus, pool } from './db';
import { emailQueue } from './queue';
import { listSenders } from './senders';
import { indexEmails, searchEmailIds } from './search';

export const scheduleSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().min(1),
  recipients: z.array(z.string().trim().toLowerCase().email()).min(1).max(50_000),
  startTime: z.coerce.date(),
  delayBetweenMs: z.number().int().min(0).default(config.minDelayMs),
  hourlyLimit: z.number().int().min(1).optional(),
});
export type ScheduleInput = z.infer<typeof scheduleSchema>;

export interface EmailDto {
  id: string;
  to: string;
  subject: string;
  scheduledAt: string;
  sentAt: string | null;
  status: EmailStatus;
  previewUrl: string | null;
  error: string | null;
}

export const toDto = (r: EmailRow): EmailDto => ({
  id: r.id,
  to: r.to_email,
  subject: r.subject,
  scheduledAt: new Date(r.scheduled_at).toISOString(),
  sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null,
  status: r.status,
  previewUrl: r.preview_url,
  error: r.error,
});

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/**
 * 1) persist rows in Postgres (source of truth, one transaction)
 * 2) enqueue one BullMQ delayed job per row (jobId = row id => idempotent)
 * 3) index into Elasticsearch (best effort)
 * Recipient i is scheduled at start + i * delayBetweenMs; senders are assigned round-robin.
 */
export async function scheduleEmails(userId: number, input: ScheduleInput): Promise<{ scheduled: number }> {
  const senders = await listSenders();
  if (!senders.length) throw new Error('No sender accounts configured');

  const recipients = [...new Set(input.recipients)];
  const startMs = Math.max(input.startTime.getTime(), Date.now());
  const rows = recipients.map((to, i) => ({
    id: randomUUID(),
    sender_id: senders[i % senders.length].id,
    to,
    scheduledAt: new Date(startMs + i * input.delayBetweenMs),
  }));

  const client = await pool.connect();
  const inserted: EmailRow[] = [];
  try {
    await client.query('BEGIN');
    for (const part of chunk(rows, 1000)) {
      const values: unknown[] = [];
      const tuples = part.map((r, idx) => {
        const o = idx * 8;
        values.push(r.id, userId, r.sender_id, r.to, input.subject, input.body, r.scheduledAt, input.hourlyLimit ?? null);
        return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8})`;
      });
      const res = await client.query<EmailRow>(
        `INSERT INTO emails (id,user_id,sender_id,to_email,subject,body,scheduled_at,hourly_limit)
         VALUES ${tuples.join(',')} RETURNING *`,
        values,
      );
      inserted.push(...res.rows);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // If this step fails the rows are still safe in Postgres and reconcile() re-creates the jobs on next boot.
  const now = Date.now();
  for (const part of chunk(inserted, 500)) {
    await emailQueue.addBulk(
      part.map((r) => ({
        name: 'send',
        data: { emailId: r.id },
        opts: { jobId: r.id, delay: Math.max(0, new Date(r.scheduled_at).getTime() - now) },
      })),
    );
  }
  void indexEmails(inserted);
  return { scheduled: inserted.length };
}

export async function listEmails(userId: number, view: 'scheduled' | 'sent', q?: string): Promise<EmailDto[]> {
  const statuses = view === 'scheduled' ? ['scheduled', 'processing'] : ['sent', 'failed'];
  const order = view === 'scheduled' ? 'scheduled_at ASC' : 'COALESCE(sent_at, updated_at) DESC';

  if (q?.trim()) {
    const ids = await searchEmailIds(userId, q.trim(), statuses);
    if (ids) {
      if (!ids.length) return [];
      const { rows } = await pool.query<EmailRow>(`SELECT * FROM emails WHERE id = ANY($1::uuid[]) AND user_id=$2 ORDER BY ${order}`, [ids, userId]);
      return rows.map(toDto);
    }
    // Elasticsearch down: fall back to Postgres
    const like = `%${q.trim()}%`;
    const { rows } = await pool.query<EmailRow>(
      `SELECT * FROM emails WHERE user_id=$1 AND status = ANY($2) AND (to_email ILIKE $3 OR subject ILIKE $3 OR body ILIKE $3)
       ORDER BY ${order} LIMIT 200`,
      [userId, statuses, like],
    );
    return rows.map(toDto);
  }

  const { rows } = await pool.query<EmailRow>(
    `SELECT * FROM emails WHERE user_id=$1 AND status = ANY($2) ORDER BY ${order} LIMIT 500`,
    [userId, statuses],
  );
  return rows.map(toDto);
}
