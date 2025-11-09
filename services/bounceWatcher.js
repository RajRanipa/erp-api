// services/bounceWatcher.js
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser'; // npm i imapflow mailparser
import { parseBounce } from '../utils/bounceParser.js';
import { handleBounce } from './handleBounce.js'; // our DB updater

export async function startBounceWatcher(log = console) {
    // Build IMAP config at runtime (after dotenv is loaded)
    const CONFIG = {
        host: process.env.IMAP_HOST || 'imap.gmail.com',
        port: Number(process.env.IMAP_PORT || 993),
        secure: String(process.env.IMAP_SECURE ?? 'true') === 'true',
        auth: {
            user: process.env.IMAP_USER || process.env.MAIL_FROM,
            pass: process.env.SMTP_PASS || process.env.SMTP_PASS
        },
    };
    const redactedPassLen = (CONFIG.auth.pass || '').length;
    const redactedUser = CONFIG.auth.user || 'N/A';

    //   log.info(
    //     `IMAP: connecting host=${CONFIG.host} port=${CONFIG.port} secure=${CONFIG.secure} mailbox=${process.env.IMAP_MAILBOX || 'INBOX'} user=${redactedUser} passLen=${redactedPassLen}`
    //   );
    const client = new ImapFlow({
        ...CONFIG,
        logger: false, // 🚫 disables all ImapFlow internal logging
    });

    async function openMailbox() {
        const lock = await client.getMailboxLock(process.env.IMAP_MAILBOX || 'INBOX');
        lock.release(); // we just make sure it exists; we’ll open on-demand
    }

    client.on('error', (err) => log.error('IMAP error:', err));
    client.on('close', () => log.warn('IMAP connection closed'));

    await client.connect();
    await openMailbox();

    // 1) Real-time push (new messages)
    client.on('exists', async () => {
        try {
            const mailbox = await client.mailboxOpen(process.env.IMAP_MAILBOX || 'INBOX');
            // Fetch the last message only (newly added)
            const seq = String(mailbox.exists);
            for await (const msg of client.fetch(seq, { envelope: true, source: true })) {
                await processMessage(msg, log);
            }
        } catch (e) {
            log.error('exists handler fail:', e);
        }
    });

    // 2) Initial scan (optional): look for recent “Mail Delivery Subsystem”
    await client.mailboxOpen(process.env.IMAP_MAILBOX || 'INBOX');
    const since = new Date(Date.now() - 1000 * 60 * 60 * 24); // last 24h
    const uids = await client.search({ since, from: 'mailer-daemon@googlemail.com' }); // Gmail bounce sender
    if (uids?.length) {
        for await (const msg of client.fetch(uids, { envelope: true, source: true })) {
            await processMessage(msg, log);
        }
    }

    log.info('Bounce watcher ready');
    return client;
}

async function processMessage(msg, log) {
    try {
        const parsed = await simpleParser(msg.source);
        const bounce = parseBounce({
            from: parsed.from?.text,
            subject: parsed.subject,
            text: parsed.text,
            html: parsed.html,
        });
        if (!bounce) return;

        await handleBounce(bounce); // ← move to DB layer
        log.info('Bounce processed:', bounce);
    } catch (e) {
        log.error('processMessage error:', e);
    }
}