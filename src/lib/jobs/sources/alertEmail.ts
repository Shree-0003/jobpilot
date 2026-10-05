import { sanitizeLine, sanitizeText, stripHtml } from "../sanitize";
import { linkedinJobId, naukriJobId, portalFromUrl } from "../dedupe";
import type { JobDraft } from "./types";
import type { JobSource } from "../../types";

/**
 * Parses LinkedIn and Naukri job-alert emails that the user already receives.
 * This reads the user's own mailbox content; it never contacts LinkedIn or Naukri.
 * Alert emails carry title/company/location/link, not the full description, so drafts
 * created here are marked as needing the description pasted before final scoring.
 */
const JOB_URL = /https?:\/\/(?:[a-z]+\.)?(?:linkedin\.com\/(?:comm\/)?jobs\/view\/[^\s"'<>)]+|naukri\.com\/job-listings-[^\s"'<>)]+)/gi;

const NOISE = /^(view job|your job alert.*|jobs? matching.*|\d+ new jobs?.*|recommended jobs?.*|apply now|see (more )?jobs?|easy apply|actively recruiting|promoted|new|be an early applicant|\d+ (applicants?|connections?)|.*school alumni.*|unsubscribe.*|https?:\/\/.*)$/i;

function slugTitle(url: string): string | undefined {
  const m = url.match(/job-listings-([a-z0-9-]+?)-\d{9,}/i);
  if (!m) return undefined;
  const words = m[1].split("-");
  const cut = words.findIndex((w) => /^\d+$/.test(w));
  return (cut > 0 ? words.slice(0, cut) : words).join(" ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const ANCHOR = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
const EXP = /(\d+\s*-\s*\d+\s*yrs?|\d+\+?\s*years?)/i;

/**
 * HTML alert emails (LinkedIn, Naukri): the job title is the link text, and the company,
 * location and experience follow the link, before the next job's link.
 */
export function parseAlertHtml(html: string, source: JobSource = "alert_email"): JobDraft[] {
  const anchors: { id: string; url: string; text: string; start: number; end: number }[] = [];
  for (const m of html.matchAll(ANCHOR)) {
    const url = m[1].replace(/&amp;/g, "&");
    if (!new RegExp(JOB_URL.source, "i").test(url)) continue;
    const portal = portalFromUrl(url);
    const id = (portal === "linkedin" ? linkedinJobId(url) : naukriJobId(url)) ?? url;
    anchors.push({ id, url, text: sanitizeLine(stripHtml(m[2])), start: m.index!, end: m.index! + m[0].length });
  }
  const order: string[] = [];
  const byId = new Map<string, { url: string; title: string; afterStart: number }>();
  for (const a of anchors) {
    const cur = byId.get(a.id);
    const usable = a.text && !NOISE.test(a.text) && a.text.length >= 3;
    if (!cur) {
      order.push(a.id);
      byId.set(a.id, { url: a.url, title: usable ? a.text : "", afterStart: a.end });
    } else if (!cur.title && usable) {
      cur.title = a.text;
      cur.afterStart = a.end;
    } else if (cur.title) {
      cur.afterStart = Math.max(cur.afterStart, a.end);
    }
  }
  const drafts: JobDraft[] = [];
  order.forEach((id, idx) => {
    const j = byId.get(id)!;
    const nextId = order[idx + 1];
    const nextStart = nextId ? anchors.find((a) => a.id === nextId)!.start : html.length;
    const after = stripHtml(html.slice(j.afterStart, Math.max(j.afterStart, nextStart)))
      .split(/\r?\n/).map((l) => sanitizeLine(l)).filter((l) => l && !NOISE.test(l)).slice(0, 4);
    let company = "", location = "", exp: string | undefined;
    for (const l of after) {
      if (!exp && EXP.test(l)) {
        exp = l.match(EXP)![1];
        const loc = l.split("|").map((x) => x.trim()).find((x) => !/yrs?|years?/i.test(x));
        if (loc && !location) location = loc;
        continue;
      }
      if (!company) {
        const parts = l.split(/\s+[·•|]\s+/);
        company = parts[0];
        if (parts[1] && !location) location = parts.slice(1).join(", ");
      } else if (!location) location = l;
    }
    const portal = portalFromUrl(j.url);
    drafts.push({
      portal, source, url: j.url, externalJobId: id === j.url ? undefined : id,
      title: sanitizeLine(j.title || slugTitle(j.url) || "Untitled role"),
      company: sanitizeLine(company || "Unknown company"),
      location: sanitizeLine(location),
      experienceText: exp ? sanitizeLine(exp) : undefined,
      description: "",
    });
  });
  return drafts;
}

export function parseAlertEmail(raw: string, source: JobSource = "alert_email"): JobDraft[] {
  if (/<a\b[^>]*href/i.test(raw)) {
    const fromHtml = parseAlertHtml(raw, source);
    if (fromHtml.length) return fromHtml;
  }
  const text = /<[a-z][\s\S]*>/i.test(raw) ? stripHtml(raw.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi, " $1 ")) : raw;
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const drafts: JobDraft[] = [];
  const seen = new Set<string>();
  let blockStart = 0;

  lines.forEach((line, i) => {
    const urls = line.match(JOB_URL);
    if (!urls) return;
    for (const rawUrl of urls) {
      const url = rawUrl.replace(/&amp;/g, "&");
      const portal = portalFromUrl(url);
      const id = portal === "linkedin" ? linkedinJobId(url) : naukriJobId(url);
      const key = id ?? url;
      if (seen.has(key)) continue;
      seen.add(key);
      const context = lines
        .slice(blockStart, i)
        .concat(line.replace(JOB_URL, "").trim())
        .map((l) => l.replace(/^[-*•\s]+/, "").replace(/^view job:?\s*/i, "").trim())
        .filter((l) => l && !NOISE.test(l))
        .slice(-4);
      const expLine = context.find((l) => /\d+\s*-\s*\d+\s*yrs?|\d+\+?\s*years?/i.test(l));
      const rest = context.filter((l) => l !== expLine);
      const expMatch = expLine?.match(/(\d+\s*-\s*\d+\s*yrs?|\d+\+?\s*years?)/i)?.[1];
      const locFromExp = expLine?.split("|").map((s) => s.trim()).find((s) => !/yrs?|years?/i.test(s));
      // Naukri style: title / company / "3-6 Yrs | City". LinkedIn style: title / company / location.
      const [title, company, location] = locFromExp
        ? [...(rest.length >= 2 ? rest.slice(-2) : [rest[0] ?? "", ""]), ""]
        : rest.length >= 3 ? rest.slice(-3) : rest.length === 2 ? [rest[0], rest[1], ""] : [rest[0] ?? "", "", ""];
      drafts.push({
        portal,
        source,
        url,
        externalJobId: id,
        title: sanitizeLine(title || slugTitle(url) || "Untitled role"),
        company: sanitizeLine(company || "Unknown company"),
        location: sanitizeLine(location || locFromExp || ""),
        experienceText: expMatch ? sanitizeLine(expMatch) : undefined,
        description: "",
      });
    }
    blockStart = i + 1;
  });
  return drafts.map((d) => ({ ...d, description: sanitizeText(d.description) }));
}
