import type { Email } from '../lib/types';
import { formatDateTime } from '../lib/format';
import { Spinner } from './ui/Spinner';
import { EmptyState } from './ui/EmptyState';
import { StatusBadge } from './ui/StatusBadge';

interface Props {
  emails: Email[];
  loading: boolean;
  error: string | null;
  mode: 'scheduled' | 'sent';
  emptyTitle: string;
  emptyDescription: string;
  emptyAction?: React.ReactNode;
}

export function EmailTable({ emails, loading, error, mode, emptyTitle, emptyDescription, emptyAction }: Props) {
  const timeLabel = mode === 'scheduled' ? 'Scheduled time' : 'Sent time';

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-gray-500">
        <Spinner /> Loading emails…
      </div>
    );
  }
  if (error) return <div className="px-6 py-10 text-center text-sm text-red-600">Could not load emails: {error}</div>;
  if (!emails.length) return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3">Subject</th>
            <th className="px-4 py-3">{timeLabel}</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {emails.map((e) => (
            <tr key={e.id} className="hover:bg-gray-50">
              <td className="whitespace-nowrap px-4 py-3 font-medium">{e.to}</td>
              <td className="max-w-xs truncate px-4 py-3 text-gray-600" title={e.subject}>
                {e.subject}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                {formatDateTime(mode === 'scheduled' ? e.scheduledAt : e.sentAt)}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <div className="flex items-center gap-2">
                  <StatusBadge status={e.status} />
                  {e.previewUrl && (
                    <a href={e.previewUrl} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline">
                      preview
                    </a>
                  )}
                  {e.status === 'failed' && e.error && (
                    <span className="max-w-[12rem] truncate text-xs text-red-500" title={e.error}>
                      {e.error}
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
