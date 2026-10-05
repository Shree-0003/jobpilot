import crypto from "node:crypto";
import type { Portal } from "../types";

const TRACKING = /^(utm_|ref|refid|trk|trackingid|src|source|lipi|from|origin|gh_src|lever-source)/i;

export function canonicalUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (!/^https?:$/.test(u.protocol)) return undefined;
  u.protocol = "https:";
  u.hostname = u.hostname.toLowerCase().replace(/^(www\.|m\.|in\.)/, "");
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  // LinkedIn: /jobs/view/<slug>-<id>/ and ?currentJobId=<id> both collapse to /jobs/view/<id>
  if (u.hostname.endsWith("linkedin.com")) {
    const id = linkedinJobId(u.toString());
    if (id) return `https://linkedin.com/jobs/view/${id}`;
  }
  const s = u.toString().replace(/\/+$/, "").replace(/\?$/, "");
  return s;
}

export function linkedinJobId(url: string): string | undefined {
  const m = url.match(/linkedin\.com\/(?:comm\/)?jobs\/view\/(?:[^/?#]*?-)?(\d{6,})/i) ?? url.match(/[?&]currentJobId=(\d{6,})/i);
  return m?.[1];
}

export function naukriJobId(url: string): string | undefined {
  const m = url.match(/naukri\.com\/job-listings-[^?#]*?-(\d{9,})/i);
  return m?.[1];
}

export function portalFromUrl(url?: string): Portal {
  if (!url) return "other";
  const h = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } })();
  if (h.endsWith("linkedin.com")) return "linkedin";
  if (h.endsWith("naukri.com")) return "naukri";
  if (h.endsWith("greenhouse.io")) return "greenhouse";
  if (h.endsWith("lever.co")) return "lever";
  return h ? "company" : "other";
}

export function externalJobId(url?: string): string | undefined {
  if (!url) return undefined;
  return linkedinJobId(url) ?? naukriJobId(url);
}

const STOP = /\b(the|a|an|and|of|for|in|at|pvt|ltd|limited|private|inc|llc|llp|technologies|technology|solutions|services|india)\b/g;
export function normalizeName(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(STOP, " ").replace(/\s+/g, " ").trim();
}

/** company + title fingerprint used when URLs differ (same job posted on two portals). */
export function dedupeHash(company: string, title: string): string {
  return crypto.createHash("sha256").update(`${normalizeName(company)}|${normalizeName(title)}`).digest("hex").slice(0, 32);
}
