import { z } from "zod";
import { route, body, ApiError } from "@/lib/http";
import { cols } from "@/lib/db";
import { ingestDrafts } from "@/lib/jobs/service";
import { portalFromUrl } from "@/lib/jobs/dedupe";

const STATUSES = ["Discovered", "Shortlisted", "Awaiting Approval", "Manual Action Required", "Low Relevance", "Skipped", "Approved", "Dismissed"] as const;

const Schema = z.object({
  title: z.string().trim().min(2).max(200),
  company: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).default(""),
  url: z.string().trim().max(2000).refine((v) => !v || /^https?:\/\//i.test(v), "Must start with http(s)://").optional().default(""),
  description: z.string().max(60_000).default(""),
  workMode: z.enum(["remote", "hybrid", "onsite", "unknown"]).default("unknown"),
  employmentType: z.enum(["full-time", "contract", "internship", "part-time", ""]).default(""),
  salaryText: z.string().trim().max(200).optional(),
  experienceText: z.string().trim().max(200).optional(),
  applyEmail: z.string().trim().max(254).optional(),
});

export const GET = route({ auth: "full" }, async ({ req, user }) => {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const q: Record<string, unknown> = { userId: user._id };
  if (status) {
    if (!(STATUSES as readonly string[]).includes(status)) throw new ApiError(400, "Unknown status.");
    q.status = status;
  }
  const jobs = await (await cols.jobs()).find(q).sort({ discoveredAt: -1 }).limit(300)
    .project({ descriptionSanitized: 0, userId: 0 }).toArray();
  const counts: Record<string, number> = {};
  for (const j of await (await cols.jobs()).find({ userId: user._id }).project<{ status: string }>({ status: 1 }).toArray()) counts[j.status] = (counts[j.status] ?? 0) + 1;
  return { jobs, counts };
});

export const POST = route({ auth: "full", limit: 30 }, async ({ req, user, cipher }) => {
  const prefs = await (await cols.prefs()).findOne({ _id: user._id });
  if (prefs?.automationState === "stopped") throw new ApiError(409, "Emergency Stop is active.");
  const v = await body(req, Schema);
  const r = await ingestDrafts(user, cipher, [{
    portal: portalFromUrl(v.url || undefined), source: "manual", url: v.url || undefined, title: v.title, company: v.company, location: v.location,
    description: v.description, workMode: v.workMode, employmentType: v.employmentType || undefined, salaryText: v.salaryText, experienceText: v.experienceText, applyEmail: v.applyEmail || undefined,
  }]);
  if (r.duplicates.length) throw new ApiError(409, "This job is already in your list.", { existingId: r.duplicates[0].existingId });
  return { id: r.created[0] };
});
