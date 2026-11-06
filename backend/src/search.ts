import { Client } from '@elastic/elasticsearch';
import { config } from './config';
import { EmailRow, pool } from './db';

const INDEX = 'emails';
export const es = new Client({ node: config.elasticsearchUrl });

export async function ensureIndex(): Promise<void> {
  try {
    const exists = await es.indices.exists({ index: INDEX });
    if (!exists) {
      await es.indices.create({
        index: INDEX,
        mappings: {
          properties: {
            userId: { type: 'integer' },
            to: { type: 'text', fields: { keyword: { type: 'keyword' } } },
            subject: { type: 'text' },
            body: { type: 'text' },
            status: { type: 'keyword' },
            sender: { type: 'keyword' },
            scheduledAt: { type: 'date' },
            sentAt: { type: 'date' },
          },
        },
      });
    }
  } catch (err) {
    console.warn('[search] Elasticsearch unavailable, search falls back to Postgres:', (err as Error).message);
  }
}

const toDoc = (r: EmailRow) => ({
  userId: r.user_id,
  to: r.to_email,
  subject: r.subject,
  body: r.body,
  status: r.status,
  sender: String(r.sender_id),
  scheduledAt: r.scheduled_at,
  sentAt: r.sent_at,
});

/** Index failures must never break sending, so everything here is best-effort. */
export async function indexEmails(rows: EmailRow[]): Promise<void> {
  if (!rows.length) return;
  try {
    const operations = rows.flatMap((r) => [{ index: { _index: INDEX, _id: r.id } }, toDoc(r)]);
    const res = await es.bulk({ operations, refresh: false });
    if (res.errors) console.warn('[search] some documents failed to index');
  } catch (err) {
    console.warn('[search] index failed:', (err as Error).message);
  }
}

export async function searchEmailIds(userId: number, q: string, statuses: string[], size = 100): Promise<string[] | null> {
  try {
    const res = await es.search({
      index: INDEX,
      size,
      query: {
        bool: {
          filter: [{ term: { userId } }, { terms: { status: statuses } }],
          must: [{ multi_match: { query: q, fields: ['to^2', 'subject^2', 'body'], fuzziness: 'AUTO' } }],
        },
      },
    });
    return res.hits.hits.map((h) => h._id as string);
  } catch (err) {
    console.warn('[search] query failed, falling back to Postgres:', (err as Error).message);
    return null;
  }
}

/** Re-index everything in Postgres (useful after wiping Elasticsearch). */
export async function reindexAll(): Promise<number> {
  const { rows } = await pool.query<EmailRow>('SELECT * FROM emails');
  for (let i = 0; i < rows.length; i += 1000) await indexEmails(rows.slice(i, i + 1000));
  return rows.length;
}
