import { Pool } from 'pg';
import { config } from './config';

export const pool = new Pool({ connectionString: config.databaseUrl });

export type EmailStatus = 'scheduled' | 'processing' | 'sent' | 'failed';

export interface EmailRow {
  id: string;
  user_id: number;
  sender_id: number;
  to_email: string;
  subject: string;
  body: string;
  scheduled_at: Date;
  status: EmailStatus;
  hourly_limit: number | null;
  attempts: number;
  locked_at: Date | null;
  sent_at: Date | null;
  message_id: string | null;
  preview_url: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface SenderRow {
  id: number;
  email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  google_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  avatar TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS senders (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  smtp_host TEXT NOT NULL,
  smtp_port INT NOT NULL,
  smtp_user TEXT NOT NULL,
  smtp_pass TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emails (
  id UUID PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id INT NOT NULL REFERENCES senders(id),
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  hourly_limit INT,
  attempts INT NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  message_id TEXT,
  preview_url TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emails_user_status ON emails (user_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_emails_status ON emails (status);

CREATE TABLE IF NOT EXISTS slack_installations (
  user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  team_name TEXT,
  channel TEXT,
  webhook_url TEXT NOT NULL,
  access_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export async function migrate(): Promise<void> {
  await pool.query(SCHEMA);
}
