import type { Email, ScheduleRequest, SlackStatus, User } from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new ApiError(body.error ?? res.statusText, res.status);
  }
  return res.json() as Promise<T>;
}

const withQuery = (path: string, q?: string) => (q?.trim() ? `${path}?q=${encodeURIComponent(q.trim())}` : path);

export const api = {
  me: () => request<User>('/api/me'),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  scheduled: (q?: string) => request<Email[]>(withQuery('/api/emails/scheduled', q)),
  sent: (q?: string) => request<Email[]>(withQuery('/api/emails/sent', q)),
  schedule: (data: ScheduleRequest) =>
    request<{ scheduled: number }>('/api/emails/schedule', { method: 'POST', body: JSON.stringify(data) }),
  slackStatus: () => request<SlackStatus>('/api/slack/status'),
  slackDisconnect: () => request<{ ok: boolean }>('/api/slack', { method: 'DELETE' }),
  slackTest: () => request<{ ok: boolean }>('/api/slack/test', { method: 'POST' }),
};
