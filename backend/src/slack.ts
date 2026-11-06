import jwt from 'jsonwebtoken';
import { config } from './config';
import { pool } from './db';
import { connection } from './redis';

const redirectUri = () => `${config.appUrl}/auth/slack/callback`;

export function slackAuthorizeUrl(userId: number): string {
  const state = jwt.sign({ uid: userId, purpose: 'slack' }, config.jwtSecret, { expiresIn: '10m' });
  const p = new URLSearchParams({
    client_id: config.slack.clientId,
    scope: 'incoming-webhook',
    redirect_uri: redirectUri(),
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${p.toString()}`;
}

interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  team?: { name?: string };
  incoming_webhook?: { url: string; channel?: string };
}

/** Exchange the OAuth code and persist the webhook for the user encoded in `state`. */
export async function handleSlackCallback(code: string, state: string): Promise<void> {
  const payload = jwt.verify(state, config.jwtSecret) as { uid: number; purpose: string };
  if (payload.purpose !== 'slack') throw new Error('Invalid state');

  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.slack.clientId,
      client_secret: config.slack.clientSecret,
      code,
      redirect_uri: redirectUri(),
    }),
  });
  const data = (await res.json()) as SlackOAuthResponse;
  if (!data.ok || !data.incoming_webhook?.url) throw new Error(`Slack OAuth failed: ${data.error ?? 'no webhook returned'}`);

  await pool.query(
    `INSERT INTO slack_installations (user_id, team_name, channel, webhook_url, access_token)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id) DO UPDATE SET team_name=$2, channel=$3, webhook_url=$4, access_token=$5, created_at=now()`,
    [payload.uid, data.team?.name ?? null, data.incoming_webhook.channel ?? null, data.incoming_webhook.url, data.access_token ?? null],
  );
}

export async function slackStatus(userId: number): Promise<{ connected: boolean; team?: string; channel?: string }> {
  const { rows } = await pool.query('SELECT team_name, channel FROM slack_installations WHERE user_id=$1', [userId]);
  if (!rows[0]) return { connected: false };
  return { connected: true, team: rows[0].team_name ?? undefined, channel: rows[0].channel ?? undefined };
}

export async function disconnectSlack(userId: number): Promise<void> {
  await pool.query('DELETE FROM slack_installations WHERE user_id=$1', [userId]);
}

/** Post to the user's webhook. Returns false (never throws) when Slack isn't connected or the call fails. */
export async function postToSlack(userId: number, text: string): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ webhook_url: string }>('SELECT webhook_url FROM slack_installations WHERE user_id=$1', [userId]);
    if (!rows[0]) return false; // not connected: silently skip
    const res = await fetch(rows[0].webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.warn(`[slack] webhook responded ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[slack] notify failed:', (err as Error).message);
    return false;
  }
}

/** Notify once per (user, sender, hour window) so a 1000-email burst doesn't spam the channel. */
export async function notifyRateLimitHit(opts: {
  userId: number;
  senderEmail: string;
  senderId: number;
  window: number;
  limit: number;
  resumeAt: Date;
}): Promise<void> {
  const key = `slack:notified:${opts.userId}:${opts.senderId}:${opts.window}`;
  const first = await connection.set(key, '1', 'EX', 3700, 'NX');
  if (!first) return;
  const sent = await postToSlack(
    opts.userId,
    `:warning: *ReachInbox rate limit reached* for sender \`${opts.senderEmail}\` (${opts.limit} emails/hour). ` +
      `Remaining emails were rescheduled and will resume at ${opts.resumeAt.toISOString()}.`,
  );
  // If Slack wasn't connected (or failed) don't hold the dedupe key, so a later connect still notifies.
  if (!sent) await connection.del(key);
}
