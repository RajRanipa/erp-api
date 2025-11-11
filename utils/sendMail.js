// utils/sendMail.js
import sgMail from '@sendgrid/mail';

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
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    const fromName = process.env.MAIL_FROM_NAME || 'JNR ERP System';
    const fromEmail = process.env.MAIL_FROM || 'no-reply@orientedp.app';
    const from = { name: fromName, email: fromEmail };
  
    console.log('📧 Sending email via SendGrid...');
    console.log({ from, to, subject });
  
    const msg = {
      to,
      from,
      subject,
      html,
      text: text || html?.replace(/<[^>]+>/g, ''),
    };
  
    const response = await sgMail.send(msg);
    console.log('✅ Email sent via SendGrid:', response[0]?.statusCode);
    return response;
  } catch (err) {
    console.error('❌ sendMail SendGrid error:', err);
    throw new Error('Failed to send email via SendGrid');
  }
}