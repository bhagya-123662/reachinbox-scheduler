import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

const base =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm placeholder-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export function Input({ label, hint, className = '', ...rest }: InputProps) {
  return (
    <Field label={label} hint={hint}>
      <input {...rest} className={`${base} ${className}`} />
    </Field>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
}

export function Textarea({ label, hint, className = '', ...rest }: TextareaProps) {
  return (
    <Field label={label} hint={hint}>
      <textarea {...rest} className={`${base} ${className}`} />
    </Field>
  );
}
