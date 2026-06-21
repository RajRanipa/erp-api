// utils/sendMail.js
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export default async function sendMail({
  to,
  subject,
  html,
  text,
}) {
  try {
    const fromName = process.env.MAIL_FROM_NAME || 'JNR ERP System';

    const fromEmail =
      process.env.MAIL_FROM ||
      process.env.SMTP_USER;

    console.log('📧 Sending email via Gmail SMTP...');
    console.log({
      from: fromEmail,
      to,
      subject,
    });

    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      html,
      text: text || html?.replace(/<[^>]+>/g, ''),
    });

    console.log(
      '✅ Email sent:',
      info.messageId
    );

    return info;
  } catch (err) {
    console.error(
      '❌ Gmail SMTP error:',
      err
    );

    throw new Error(
      'Failed to send email'
    );
  }
}

// import sgMail from '@sendgrid/mail';

/**
 * Universal sendMail helper with Render-safe fallbacks.
 * Prefers HTTP API providers (Resend / SendGrid) to avoid SMTP port blocks.
 * Falls back to SMTP (Gmail) only if no API key is configured.
 *  / app passowrd 
 * Usage:
 *   await sendMail({ to, subject, html, text })
 */
// export default async function sendMail({ to, subject, html, text }) {
//   try {
//     sgMail.setApiKey(process.env.SENDGRID_API_KEY);
//     const fromName = process.env.MAIL_FROM_NAME || 'JNR ERP System';
//     const fromEmail = process.env.MAIL_FROM || 'no-reply@orientedp.app';
//     const from = { name: fromName, email: fromEmail };
  
//     console.log('📧 Sending email via SendGrid...');
//     console.log({ from, to, subject });
  
//     const msg = {
//       to,
//       from,
//       subject,
//       html,
//       text: text || html?.replace(/<[^>]+>/g, ''),
//     };
  
//     const response = await sgMail.send(msg);
//     console.log('✅ Email sent via SendGrid:', response[0]?.statusCode);
//     return response;
//   } catch (err) {
//     console.error('❌ sendMail SendGrid error:', err);
//     throw new Error('Failed to send email via SendGrid');
//   }
// }

