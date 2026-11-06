import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { Email } from '../lib/types';

/** Loads a list of emails, polls for live status changes, and re-queries (Elasticsearch) when `query` changes. */
export function useEmails(view: 'scheduled' | 'sent', query: string, pollMs = 5000) {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const load = useCallback(
    async (showSpinner: boolean) => {
      const ticket = ++latest.current;
      if (showSpinner) setLoading(true);
      try {
        const data = view === 'scheduled' ? await api.scheduled(query) : await api.sent(query);
        if (ticket !== latest.current) return; // a newer request superseded this one
        setEmails(data);
        setError(null);
      } catch (err) {
        if (ticket === latest.current) setError((err as Error).message);
      } finally {
        if (ticket === latest.current) setLoading(false);
      }
    },
    [view, query],
  );

  useEffect(() => {
    void load(true);
    const t = setInterval(() => void load(false), pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);

  return { emails, loading, error, refresh: () => load(false) };
}
