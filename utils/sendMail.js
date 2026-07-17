// utils/sendMail.js
import nodemailer from 'nodemailer';
import { google } from 'googleapis';

// 1. Declare the variable, but DO NOT create the client yet (Lazy Initialization)
let gmailClient;

export default async function sendMail({
  to,
  subject,
  html,
  text,
}) {
  try {
    // 2. Initialize the Google API client ONLY when this function runs
    // This safely avoids the Dotenv Timing Trap!
    if (!gmailClient) {
      const OAuth2 = google.auth.OAuth2;
      const oauth2Client = new OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET,
        "https://developers.google.com/oauthplayground"
      );

      oauth2Client.setCredentials({
        refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      });

      gmailClient = google.gmail({ version: 'v1', auth: oauth2Client });
    }

    const fromName = process.env.MAIL_FROM_NAME || 'JNR ERP System';
    
    // We are keeping SMTP_USER exactly as you requested!
    const fromEmail = process.env.MAIL_FROM || process.env.SMTP_USER;

    // console.log("SMTP_USER =", process.env.SMTP_USER);
    // console.log('📧 Sending email via Gmail HTTP API (Bypassing Render Port Blocks)...');

    // 3. Construct the raw MIME email message
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const messageParts = [
      `From: "${fromName}" <${fromEmail}>`,
      `To: ${to}`,
      `Subject: ${utf8Subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=utf-8`,
      ``,
      html || text || '',
    ];

    const message = messageParts.join('\n');

    // 4. Encode to Base64url (Strict requirement for the Gmail API)
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // 5. Send the email using standard web traffic (Port 443 - completely safe for Render)
    const response = await gmailClient.users.messages.send({
      userId: 'me', // 'me' automatically refers to the authenticated user (sales@orientfibertechllp.com)
      requestBody: {
        raw: encodedMessage,
      },
    });

    // console.log('✅ Email sent successfully via Google API! Message ID:', response.data.id);
    return response.data;

  } catch (err) {
    console.error('❌ Gmail API error:', err.message || err);
    throw new Error('Failed to send email');
  }
}

// 1. Declare the variable, but DO NOT create the transport yet
let transporter;

export async function sendMail__old({
  to,
  subject,
  html,
  text,
}) {
  try {

if (!transporter) {
      transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true, // true for port 465
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    }

    const fromName = process.env.MAIL_FROM_NAME || 'JNR ERP System';


    // console.log("SMTP_USER =", process.env.SMTP_USER);
    // console.log("SMTP_USER type =", typeof process.env.SMTP_USER);
    // console.log("SMTP_PASS exists =", !!process.env.SMTP_PASS);
    // console.log("SMTP_PASS type =", typeof process.env.SMTP_PASS);
    // console.log("SMTP_PASS length =", process.env.SMTP_PASS?.length);
    // console.log("SMTP_PASS length =", process.env.SMTP_PASS);

   
    const fromEmail =
      process.env.MAIL_FROM ||
      process.env.SMTP_USER;

    // console.log('📧 Sending email via Gmail SMTP...');
    // console.log({
    //   from: fromEmail,
    //   to,
    //   subject,
    // });

    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      html,
      text: text || html?.replace(/<[^>]+>/g, ''),
    });

    // console.log(
    //   '✅ Email sent:',
    //   info.messageId
    // );

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

