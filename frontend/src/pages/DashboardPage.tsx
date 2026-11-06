import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ComposeModal } from '../components/ComposeModal';
import { EmailTable } from '../components/EmailTable';
import { Header } from '../components/Header';
import { Button } from '../components/ui/Button';
import { Tabs } from '../components/ui/Tabs';
import { Spinner } from '../components/ui/Spinner';
import { useAuth } from '../hooks/useAuth';
import { useEmails } from '../hooks/useEmails';

type TabId = 'scheduled' | 'sent';

export function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>('scheduled');
  const [composeOpen, setComposeOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { emails, loading, error, refresh } = useEmails(tab, debounced);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-500">
        <Spinner size={28} />
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;

  const composeButton = <Button onClick={() => setComposeOpen(true)}>Compose New Email</Button>;

  return (
    <div className="min-h-screen">
      <Header onLoggedOut={() => navigate('/', { replace: true })} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Emails</h1>
          {composeButton}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3 px-6 pt-4">
            <Tabs<TabId>
              tabs={[
                { id: 'scheduled', label: 'Scheduled Emails' },
                { id: 'sent', label: 'Sent Emails' },
              ]}
              active={tab}
              onChange={setTab}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search emails…"
              aria-label="Search emails"
              className="mb-2 w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </div>

          {tab === 'scheduled' ? (
            <EmailTable
              mode="scheduled"
              emails={emails}
              loading={loading}
              error={error}
              emptyTitle={debounced ? 'No matches' : 'No scheduled emails'}
              emptyDescription={debounced ? 'Try a different search term.' : 'Compose a new email to schedule your first campaign.'}
              emptyAction={debounced ? undefined : composeButton}
            />
          ) : (
            <EmailTable
              mode="sent"
              emails={emails}
              loading={loading}
              error={error}
              emptyTitle={debounced ? 'No matches' : 'No sent emails yet'}
              emptyDescription={debounced ? 'Try a different search term.' : 'Emails will show up here once they have been sent.'}
            />
          )}
        </div>
      </main>

      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} onScheduled={() => void refresh()} />
    </div>
  );
}
