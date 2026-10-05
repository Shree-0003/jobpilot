import "server-only";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { env } from "../../env";
import { parseAlertEmail } from "./alertEmail";
import type { JobDraft } from "./types";

/**
 * Reads your LinkedIn and Naukri job-alert emails from Gmail over IMAP with a Google app password.
 *  - The mailbox is opened READ-ONLY (IMAP EXAMINE): nothing is marked read, moved or deleted.
 *  - Only messages from linkedin.com / naukri.com in the last N days are fetched.
 *  - Email bodies are untrusted: they go through the same parser and sanitiser as a pasted email.
 *  - LinkedIn and Naukri are never contacted — only your own mailbox.
 */
const MAX_MESSAGES = 40;

export function imapConfigured() {
  const e = env();
  return !!(e.GMAIL_IMAP_USER && e.GMAIL_IMAP_APP_PASSWORD);
}

export async function fetchAlertsViaImap(sinceDays = 3): Promise<{ drafts: JobDraft[]; messages: number }> {
  const e = env();
  if (!imapConfigured()) throw new Error("Gmail is not configured (GMAIL_IMAP_USER / GMAIL_IMAP_APP_PASSWORD).");
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: e.GMAIL_IMAP_USER, pass: e.GMAIL_IMAP_APP_PASSWORD.replace(/\s+/g, "") },
    logger: false,
    socketTimeout: 60_000,
  });
  await client.connect();
  const drafts: JobDraft[] = [];
  let messages = 0;
  try {
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const since = new Date(Date.now() - sinceDays * 86_400_000);
      const found = await client.search({ since, or: [{ from: "linkedin.com" }, { from: "naukri.com" }] }, { uid: true });
      const uids = (Array.isArray(found) ? found : []).slice(-MAX_MESSAGES);
      if (uids.length) {
        for await (const msg of client.fetch(uids, { source: true, envelope: true }, { uid: true })) {
          const subject = msg.envelope?.subject ?? "";
          // Skip non-alert mail (connection requests, messages, newsletters).
          if (!/job|alert|recommend|match|opening|hiring|apply/i.test(subject)) continue;
          if (!msg.source) continue;
          const parsed = await simpleParser(msg.source);
          const body = typeof parsed.html === "string" && parsed.html ? parsed.html : parsed.text ?? "";
          drafts.push(...parseAlertEmail(body, "gmail_imap"));
          messages++;
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return { drafts, messages };
}
