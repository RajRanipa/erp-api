// utils/sendMail.js
import nodemailer from 'nodemailer';

/**
 * Universal sendMail helper
 * 
 * Usage:
 *   await sendMail({
 *     to: 'user@example.com',  
 *     subject: 'Welcome!',
 *     html: '<p>Hello!</p>',
 *   });
 */
export default async function sendMail({ to, subject, html, text }) {
  try {
    // === Configure transport ===
    // These should come from .env for security.
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false, // true for 465, false for 587 465
      auth: {
        user: process.env.MAIL_FROM, // full email address
        pass: process.env.SMTP_PASS, // app password or smtp token
      },
    });

    // === Mail options ===
    const mailOptions = {
      from: {
        name: process.env.MAIL_FROM_NAME || 'JNR ERP System',
        address: process.env.MAIL_FROM || process.env.MAIL_FROM,
      },
      to,
      subject,
      text: text || html?.replace(/<[^>]+>/g, ''), // fallback to plain text
      html,
    };

    // === Send email ===
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent:', info, info.messageId);
    return info;
  } catch (err) {
    console.error('❌ sendMail error:', err);
    throw new Error('Failed to send email');
  }
}