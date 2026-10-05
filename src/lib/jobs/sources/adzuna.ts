import "server-only";
import { z } from "zod";
import { env } from "../../env";
import { safeFetchJson } from "../ssrf";
import { sanitizeLine, sanitizeText } from "../sanitize";
import { inferEmploymentType, inferWorkMode, type JobDraft } from "./types";

// Official Adzuna job search API (India). Free keys: https://developer.adzuna.com/
// Returns listings from Indian job sites and employers; the description is a snippet.

const Result = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string(),
  description: z.string().optional().default(""),
  redirect_url: z.string().url(),
  company: z.object({ display_name: z.string().optional() }).partial().optional(),
  location: z.object({ display_name: z.string().optional() }).partial().optional(),
  salary_min: z.number().optional(),
  salary_max: z.number().optional(),
  contract_type: z.string().optional(),
  contract_time: z.string().optional(),
}).passthrough();
const Response = z.object({ results: z.array(Result) });

export function adzunaConfigured() {
  const e = env();
  return !!(e.ADZUNA_APP_ID && e.ADZUNA_APP_KEY);
}

const lpa = (n?: number) => (n ? Math.round((n / 1e5) * 10) / 10 : undefined);

export async function fetchAdzuna(queries: string[], where: string, fetchImpl?: typeof fetch): Promise<JobDraft[]> {
  const e = env();
  if (!adzunaConfigured()) throw new Error("Adzuna is not configured (ADZUNA_APP_ID / ADZUNA_APP_KEY).");
  const drafts: JobDraft[] = [];
  for (const q of queries.slice(0, 8)) {
    const p = new URLSearchParams({
      app_id: e.ADZUNA_APP_ID,
      app_key: e.ADZUNA_APP_KEY,
      results_per_page: "20",
      what_phrase: q,
      max_days_old: "7",
      sort_by: "date",
      "content-type": "application/json",
    });
    if (where) p.set("where", where);
    const data = Response.parse(await safeFetchJson(`https://api.adzuna.com/v1/api/jobs/in/search/1?${p}`, fetchImpl));
    for (const r of data.results) {
      const desc = sanitizeText(r.description ?? "");
      const lo = lpa(r.salary_min), hi = lpa(r.salary_max);
      drafts.push({
        portal: "adzuna",
        source: "adzuna",
        url: r.redirect_url,
        externalJobId: `adz-${r.id}`,
        title: sanitizeLine(r.title),
        company: sanitizeLine(r.company?.display_name ?? "Unknown company"),
        location: sanitizeLine(r.location?.display_name ?? ""),
        description: desc,
        workMode: inferWorkMode(`${r.location?.display_name ?? ""} ${desc}`),
        employmentType: r.contract_type === "contract" ? "contract" : r.contract_time === "part_time" ? "part-time" : inferEmploymentType(desc),
        salaryText: lo && hi ? `${lo}-${hi} LPA` : undefined,
      });
    }
  }
  return drafts;
}
