import { z } from "zod";
import { route, body } from "@/lib/http";
import { cols } from "@/lib/db";
import { audit } from "@/lib/audit";

const list = z.array(z.string().trim().min(1).max(80)).max(50).default([]);
const Schema = z.object({
  targetTitles: list,
  keywords: list,
  excludedKeywords: list,
  preferredIndustries: list,
  preferredCompanies: list,
  excludedCompanies: list,
  preferredLocations: list,
  workModes: z.array(z.enum(["remote", "hybrid", "onsite"])).min(1),
  experienceMin: z.number().int().min(0).max(50),
  experienceMax: z.number().int().min(0).max(50),
  salaryMinLpa: z.number().min(0).max(1000),
  salaryPreferredLpa: z.number().min(0).max(1000),
  employmentTypes: z.array(z.enum(["full-time", "contract", "internship", "part-time"])).min(1),
  careerBoards: z.array(z.object({ vendor: z.enum(["greenhouse", "lever"]), token: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,62}$/i, "Board token: letters, digits, hyphens") })).max(30).default([]),
  excludePreviouslyRejected: z.boolean(),
  limits: z.object({
    maxPerDay: z.number().int().min(1).max(100),
    maxPerHour: z.number().int().min(1).max(30),
    maxPerCompanyPerDay: z.number().int().min(1).max(10),
    minMatchScore: z.number().int().min(0).max(100),
  }),
  notifications: z.object({ browser: z.boolean(), highMatchThreshold: z.number().int().min(0).max(100) }),
}).refine((v) => v.experienceMin <= v.experienceMax, { message: "Minimum experience must not exceed maximum", path: ["experienceMin"] });

export const GET = route({ auth: "full" }, async ({ user }) => {
  const p = await (await cols.prefs()).findOne({ _id: user._id });
  return p;
});

export const PUT = route({ auth: "full", limit: 30 }, async ({ req, user }) => {
  const v = await body(req, Schema);
  await (await cols.prefs()).updateOne({ _id: user._id }, { $set: { ...v, updatedAt: new Date() } });
  await audit({ userId: user._id, actor: "user", action: "preferences_updated", details: { limits: v.limits, minScore: v.limits.minMatchScore } });
  return { ok: true };
});
