import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { SlackStatus } from '../lib/types';
import { Button } from './ui/Button';
import { useToast } from './ui/Toast';

export function SlackConnect() {
  const toast = useToast();
  const [status, setStatus] = useState<SlackStatus | null>(null);

  const load = useCallback(() => api.slackStatus().then(setStatus).catch(() => setStatus({ connected: false })), []);

  useEffect(() => {
    void load();
    const flag = new URLSearchParams(window.location.search).get('slack');
    if (flag) {
      toast(flag === 'connected' ? 'Slack connected 🎉' : 'Slack connection failed', flag === 'connected' ? 'success' : 'error');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [load, toast]);

  if (!status) return null;

  if (!status.connected) {
    // Full-page navigation: the backend redirects to Slack's OAuth authorize screen.
    return (
      <Button variant="secondary" onClick={() => (window.location.href = '/api/slack/connect')}>
        Connect Slack
      </Button>
    );
  }

  const label = [status.team, status.channel].filter(Boolean).join(' · ');
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs text-gray-500 sm:inline">Slack: {label || 'connected'}</span>
      <Button
        variant="ghost"
        onClick={async () => {
          const r = await api.slackTest().catch(() => ({ ok: false }));
          toast(r.ok ? 'Test message sent to Slack' : 'Could not reach Slack', r.ok ? 'success' : 'error');
        }}
      >
        Send test
      </Button>
      <Button
        variant="danger"
        onClick={async () => {
          await api.slackDisconnect();
          toast('Slack disconnected', 'info');
          void load();
        }}
      >
        Disconnect
      </Button>
    </div>
  );
}
