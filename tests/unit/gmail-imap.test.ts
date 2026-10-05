import { describe, expect, it, vi } from "vitest";

const state = { readOnly: undefined as boolean | undefined, query: undefined as unknown, loggedOut: false };
const mime = (subject: string, html: string) => Buffer.from(`From: LinkedIn <jobalerts-noreply@linkedin.com>\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}`);
vi.mock("imapflow", () => ({
  ImapFlow: class {
    async connect() {}
    async getMailboxLock(_p: string, o: { readOnly: boolean }) { state.readOnly = o.readOnly; return { release() {} }; }
    async search(q: unknown) { state.query = q; return [1, 2]; }
    async *fetch() {
      yield { envelope: { subject: "Senior GRC Analyst at Acme and 5 more jobs" }, source: mime("jobs", `<a href="https://www.linkedin.com/comm/jobs/view/4012345678/">Senior GRC Analyst</a><p>Acme · Bengaluru, Karnataka, India</p>`) };
      yield { envelope: { subject: "Priya wants to connect" }, source: mime("connect", `<a href="https://www.linkedin.com/comm/jobs/view/4099999999/">Should be ignored</a>`) };
    }
    async logout() { state.loggedOut = true; }
  },
}));

describe("Gmail IMAP source", () => {
  it("opens INBOX read-only, reads only alert mails, parses jobs", async () => {
    process.env.GMAIL_IMAP_USER = "me@gmail.com"; process.env.GMAIL_IMAP_APP_PASSWORD = "abcd efgh ijkl mnop";
    const { fetchAlertsViaImap } = await import("@/lib/jobs/sources/gmailImap");
    const r = await fetchAlertsViaImap(3);
    expect(state.readOnly).toBe(true);
    expect(JSON.stringify(state.query)).toContain("linkedin.com");
    expect(r.messages).toBe(1);
    expect(r.drafts.map((d) => [d.title, d.company, d.source])).toEqual([["Senior GRC Analyst", "Acme", "gmail_imap"]]);
    expect(state.loggedOut).toBe(true);
  });
});
