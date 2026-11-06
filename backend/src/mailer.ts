import nodemailer, { Transporter } from 'nodemailer';
import { SenderRow, EmailRow } from './db';

const transports = new Map<number, Transporter>();

function transportFor(sender: SenderRow): Transporter {
  let t = transports.get(sender.id);
  if (!t) {
    t = nodemailer.createTransport({
      host: sender.smtp_host,
      port: sender.smtp_port,
      secure: false,
      auth: { user: sender.smtp_user, pass: sender.smtp_pass },
    });
    transports.set(sender.id, t);
  }
  return t;
}

export interface SendResult {
  messageId: string;
  previewUrl: string | null;
}

export async function sendEmail(sender: SenderRow, email: EmailRow): Promise<SendResult> {
  const info = await transportFor(sender).sendMail({
    from: `"ReachInbox" <${sender.email}>`,
    to: email.to_email,
    subject: email.subject,
    text: email.body,
    // Stable Message-ID derived from our row id: a duplicate send would be detectable downstream.
    messageId: `<${email.id}@reachinbox.local>`,
  });
  const preview = nodemailer.getTestMessageUrl(info);
  return { messageId: info.messageId, previewUrl: preview || null };
}
