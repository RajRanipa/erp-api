// utils/bounceParser.js
// Extracts failed recipient and status code from Gmail bounce (Mail Delivery Subsystem)

const FAILED_RECIPIENT_RE = /(?:^|\s)([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})(?=[\s>])/im;
const STATUS_RE = /\b(5\d{2}\s[0-9.]+\s[^\n\r]+)/i; // e.g., 550 5.1.1 ...

export function parseBounce({ from, subject, text, html }) {
  // Basic gate: check it appears to be a bounce from Gmail
  const isGmailBounce =
    /mail delivery subsystem/i.test(from || '') ||
    /delivery status notification/i.test(subject || '');

  if (!isGmailBounce) return null;

  const body = [text || '', html ? html.replace(/<[^>]+>/g, ' ') : ''].join('\n');

  // Prefer the email that appears in the “wasn't delivered to …” line
  let recipient = null;
  const addrMatch = body.match(FAILED_RECIPIENT_RE);
  if (addrMatch) recipient = (addrMatch[1] || '').trim().toLowerCase();

  // Try to capture SMTP diagnostic
  let status = null;
  const statusMatch = body.match(STATUS_RE);
  if (statusMatch) status = statusMatch[1];

  if (!recipient) return null;

  return {
    recipient,
    status,                       // e.g., "550 5.1.1 The email account that you tried to reach does not exist…"
    category: status?.startsWith('550') ? 'hard' : 'unknown', // simple classifier
  };
}