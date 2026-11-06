import { useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '../lib/api';
import { extractEmails } from '../lib/csv';
import { toLocalInputValue } from '../lib/format';
import { Button } from './ui/Button';
import { Input, Textarea } from './ui/Input';
import { Modal } from './ui/Modal';
import { useToast } from './ui/Toast';

interface Props {
  open: boolean;
  onClose: () => void;
  onScheduled: () => void;
}

export function ComposeModal({ open, onClose, onScheduled }: Props) {
  const toast = useToast();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [startTime, setStartTime] = useState(() => toLocalInputValue(new Date(Date.now() + 60_000)));
  const [delaySec, setDelaySec] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState(200);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setSubject('');
    setBody('');
    setRecipients([]);
    setFileName('');
    setStartTime(toLocalInputValue(new Date(Date.now() + 60_000)));
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const found = extractEmails(await file.text());
    setRecipients(found);
    if (!found.length) toast('No email addresses found in that file', 'error');
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!recipients.length) return toast('Upload a CSV/text file with at least one email address', 'error');
    setSubmitting(true);
    try {
      const res = await api.schedule({
        subject,
        body,
        recipients,
        startTime: new Date(startTime).toISOString(),
        delayBetweenMs: Math.round(delaySec * 1000),
        hourlyLimit,
      });
      toast(`Scheduled ${res.scheduled} email${res.scheduled === 1 ? '' : 's'}`, 'success');
      reset();
      onScheduled();
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Compose New Email">
      <form onSubmit={onSubmit} className="space-y-4">
        <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={300} placeholder="Quick question about…" />
        <Textarea label="Body" value={body} onChange={(e) => setBody(e.target.value)} required rows={5} placeholder="Hi there,…" />

        <div>
          <span className="mb-1 block text-sm font-medium text-gray-700">Email leads (CSV / text)</span>
          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-dashed border-gray-300 px-4 py-3 text-sm hover:bg-gray-50">
            <span className="truncate text-gray-600">{fileName || 'Choose a .csv or .txt file'}</span>
            <span className="ml-3 shrink-0 font-medium text-brand-600">Upload</span>
            <input type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={onFile} />
          </label>
          {fileName && (
            <p className="mt-1 text-xs text-gray-600">
              <strong>{recipients.length}</strong> unique email address{recipients.length === 1 ? '' : 'es'} detected
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input label="Start time" type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
          <Input
            label="Delay between emails (sec)"
            type="number"
            min={0}
            step={0.5}
            value={delaySec}
            onChange={(e) => setDelaySec(Number(e.target.value))}
            required
          />
          <Input
            label="Hourly limit"
            type="number"
            min={1}
            value={hourlyLimit}
            onChange={(e) => setHourlyLimit(Number(e.target.value))}
            hint="Per sender"
            required
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting} disabled={!recipients.length}>
            Schedule
          </Button>
        </div>
      </form>
    </Modal>
  );
}
