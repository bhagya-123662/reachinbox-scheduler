import type { EmailStatus } from '../../lib/types';

const styles: Record<EmailStatus, string> = {
  scheduled: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  processing: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  sent: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  failed: 'bg-red-50 text-red-700 ring-red-600/20',
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${styles[status]}`}>
      {status}
    </span>
  );
}
