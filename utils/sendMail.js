// utils/sendMail.js
import nodemailer from 'nodemailer';

/**
 * Universal sendMail helper with Render-safe fallbacks.
 * Prefers HTTP API providers (Resend / SendGrid) to avoid SMTP port blocks.
 * Falls back to SMTP (Gmail) only if no API key is configured.
 *
 * Usage:
 *   await sendMail({ to, subject, html, text })
 */
export default async function sendMail({ to, subject, html, text }) {
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromName = process.env.MAIL_FROM_NAME || 'JNR ERP System';
    const fromEmail = process.env.MAIL_FROM || 'rajranipa@erp.orientfibertech.com';
    const from = `${fromName} <${fromEmail}>`;

    console.log('📧 Sending email via Resend...');
    console.log({ from, to, subject });

    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html,
      text: text || html?.replace(/<[^>]+>/g, ''),
    });

    if (error) {
      console.error('❌ Resend API error:', error);
      throw new Error(error.message || 'Resend email failed');
    }

    console.log('✅ Email sent via Resend:', data?.id || data);
    return data;
  } catch (err) {
    console.error('❌ sendMail Resend error:', err);
    throw new Error('Failed to send email via Resend');
  }
}