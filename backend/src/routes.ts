import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from './auth';
import { config } from './config';
import { pool } from './db';
import { listEmails, scheduleEmails, scheduleSchema } from './emailService';
import { disconnectSlack, handleSlackCallback, postToSlack, slackAuthorizeUrl, slackStatus } from './slack';

export const apiRouter = Router();
export const slackCallbackRouter = Router();

// Slack redirects the browser here; it carries our signed `state` (user id), no cookie needed.
slackCallbackRouter.get('/slack/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string | undefined>;
  try {
    if (error || !code || !state) throw new Error(error ?? 'Missing code');
    await handleSlackCallback(code, state);
    res.redirect(`${config.appUrl}/dashboard?slack=connected`);
  } catch (err) {
    console.error('[slack] callback failed:', (err as Error).message);
    res.redirect(`${config.appUrl}/dashboard?slack=error`);
  }
});

// Browser navigation (full page redirect) – needs the session cookie.
apiRouter.get('/slack/connect', requireAuth, (req: AuthedRequest, res) => {
  if (!config.slack.clientId) return res.status(500).json({ error: 'SLACK_CLIENT_ID is not configured' });
  res.redirect(slackAuthorizeUrl(req.userId!));
});

apiRouter.use(requireAuth);

apiRouter.get('/me', async (req: AuthedRequest, res) => {
  const { rows } = await pool.query('SELECT id, email, name, avatar FROM users WHERE id=$1', [req.userId]);
  if (!rows[0]) return res.status(401).json({ error: 'User not found' });
  res.json(rows[0]);
});

apiRouter.post('/emails/schedule', async (req: AuthedRequest, res) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
  }
  const result = await scheduleEmails(req.userId!, parsed.data);
  res.status(201).json(result);
});

const listQuery = z.object({ q: z.string().optional() });

apiRouter.get('/emails/scheduled', async (req: AuthedRequest, res) => {
  const { q } = listQuery.parse(req.query);
  res.json(await listEmails(req.userId!, 'scheduled', q));
});

apiRouter.get('/emails/sent', async (req: AuthedRequest, res) => {
  const { q } = listQuery.parse(req.query);
  res.json(await listEmails(req.userId!, 'sent', q));
});

apiRouter.get('/slack/status', async (req: AuthedRequest, res) => res.json(await slackStatus(req.userId!)));

apiRouter.delete('/slack', async (req: AuthedRequest, res) => {
  await disconnectSlack(req.userId!);
  res.json({ ok: true });
});

// Handy for demos: proves the live Slack link works without having to hit the limit.
apiRouter.post('/slack/test', async (req: AuthedRequest, res) => {
  const ok = await postToSlack(req.userId!, ':white_check_mark: ReachInbox Slack notifications are connected.');
  res.status(ok ? 200 : 400).json({ ok });
});
