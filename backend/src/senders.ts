import nodemailer from 'nodemailer';
import { pool, SenderRow } from './db';
import { config } from './config';

/** Create Ethereal (fake SMTP) sender accounts on first boot so multiple senders are available. */
export async function ensureSenders(): Promise<void> {
  const { rows } = await pool.query<{ count: string }>('SELECT count(*) FROM senders');
  const existing = Number(rows[0].count);
  for (let i = existing; i < config.senderCount; i++) {
    const acc = await nodemailer.createTestAccount();
    await pool.query(
      `INSERT INTO senders (email, smtp_host, smtp_port, smtp_user, smtp_pass)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (email) DO NOTHING`,
      [acc.user, acc.smtp.host, acc.smtp.port, acc.user, acc.pass],
    );
    console.log(`[senders] created Ethereal sender ${acc.user}`);
  }
}

export async function listSenders(): Promise<SenderRow[]> {
  const { rows } = await pool.query<SenderRow>('SELECT * FROM senders ORDER BY id');
  return rows;
}

export async function getSender(id: number): Promise<SenderRow> {
  const { rows } = await pool.query<SenderRow>('SELECT * FROM senders WHERE id=$1', [id]);
  if (!rows[0]) throw new Error(`Sender ${id} not found`);
  return rows[0];
}
