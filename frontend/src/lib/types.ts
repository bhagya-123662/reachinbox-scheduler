export type EmailStatus = 'scheduled' | 'processing' | 'sent' | 'failed';

export interface Email {
  id: string;
  to: string;
  subject: string;
  scheduledAt: string;
  sentAt: string | null;
  status: EmailStatus;
  previewUrl: string | null;
  error: string | null;
}

export interface User {
  id: number;
  email: string;
  name: string;
  avatar: string | null;
}

export interface SlackStatus {
  connected: boolean;
  team?: string;
  channel?: string;
}

export interface ScheduleRequest {
  subject: string;
  body: string;
  recipients: string[];
  startTime: string;
  delayBetweenMs: number;
  hourlyLimit?: number;
}
