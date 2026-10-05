import type { Portal } from "../types";
import type { ConnectorPolicy } from "../policy/engine";

/**
 * Connector ToS register. A connector's capabilities are capped by its recorded terms review.
 * When `reviewExpires` passes, the policy engine stops treating the connector as auto-capable.
 */
export interface ConnectorInfo {
  portal: Portal;
  name: string;
  discovery: string;
  apply: "human_submit" | "auto_email";
  autoSubmitAllowed: boolean;
  reviewedAt: string;
  reviewExpires: string;
  evidence: string;
  note: string;
}

export const CONNECTORS: Record<Portal, ConnectorInfo> = {
  linkedin: {
    portal: "linkedin", name: "LinkedIn", discovery: "Job-alert emails (Gmail MCP or paste) and pasted job text",
    apply: "human_submit", autoSubmitAllowed: false, reviewedAt: "2026-10-01", reviewExpires: "2027-04-01",
    evidence: "https://www.linkedin.com/legal/user-agreement",
    note: "User Agreement §8.2 prohibits bots, scrapers and browser add-ons. No job-seeker API. Never stores your LinkedIn login.",
  },
  naukri: {
    portal: "naukri", name: "Naukri", discovery: "Job-alert emails (Gmail MCP or paste) and pasted job text",
    apply: "human_submit", autoSubmitAllowed: false, reviewedAt: "2026-10-01", reviewExpires: "2027-04-01",
    evidence: "https://www.naukri.com/termsconditions",
    note: "Terms prohibit automated crawling/scraping and circumventing anti-robot measures. No public API.",
  },
  greenhouse: {
    portal: "greenhouse", name: "Greenhouse job boards", discovery: "Public read-only Job Board API for companies you list",
    apply: "human_submit", autoSubmitAllowed: false, reviewedAt: "2026-10-01", reviewExpires: "2027-04-01",
    evidence: "https://developers.greenhouse.io/job-board.html",
    note: "Reading public boards is the documented use. Submitting needs the employer's key, so you apply on the form.",
  },
  lever: {
    portal: "lever", name: "Lever job boards", discovery: "Public read-only Postings API for companies you list",
    apply: "human_submit", autoSubmitAllowed: false, reviewedAt: "2026-10-01", reviewExpires: "2027-04-01",
    evidence: "https://github.com/lever/postings-api",
    note: "Postings are public; apply on the hosted form yourself.",
  },
  adzuna: {
    portal: "adzuna", name: "Adzuna (India job search API)", discovery: "Official Adzuna search API for your target roles in India",
    apply: "human_submit", autoSubmitAllowed: false, reviewedAt: "2026-10-05", reviewExpires: "2027-04-05",
    evidence: "https://developer.adzuna.com/",
    note: "Official API for job search. Listings link to the original employer or job site, where you apply yourself.",
  },
  company: {
    portal: "company", name: "Company career sites", discovery: "Pasted job text",
    apply: "human_submit", autoSubmitAllowed: false, reviewedAt: "2026-10-01", reviewExpires: "2027-04-01",
    evidence: "", note: "Each site has its own terms; treated as human submit.",
  },
  email: {
    portal: "email", name: "Email to recruiter", discovery: "Postings that list an application email",
    apply: "auto_email", autoSubmitAllowed: true, reviewedAt: "2026-10-01", reviewExpires: "2027-04-01",
    evidence: "", note: "Sending your own application from your own mailbox. Sender not built in the MVP, so it stays manual.",
  },
  other: {
    portal: "other", name: "Other", discovery: "Pasted job text", apply: "human_submit", autoSubmitAllowed: false,
    reviewedAt: "2026-10-01", reviewExpires: "2027-04-01", evidence: "", note: "Human submit.",
  },
};

/** The email sender is a post-MVP feature; until configured, nothing is auto-capable. */
export const EMAIL_SENDER_CONFIGURED = false;

export function connectorPolicy(portal: Portal, applyEmail?: string): ConnectorPolicy {
  const c = applyEmail ? CONNECTORS.email : CONNECTORS[portal] ?? CONNECTORS.other;
  return { portal: c.name, autoSubmitAllowed: c.autoSubmitAllowed, reviewExpires: c.reviewExpires, configured: c.portal === "email" ? EMAIL_SENDER_CONFIGURED : true };
}
