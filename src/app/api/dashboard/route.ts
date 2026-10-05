import { route } from "@/lib/http";
import { cols } from "@/lib/db";

const DAY = 86_400_000;

export const GET = route({ auth: "full" }, async ({ user }) => {
  const now = Date.now();
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const jobs = await (await cols.jobs()).find({ userId: user._id }).project<{ status: string; discoveredAt: Date; matchScore?: number; decision?: string }>({ status: 1, discoveredAt: 1, matchScore: 1, decision: 1 }).toArray();
  const apps = await (await cols.applications()).find({ userId: user._id }).project<{ _id: string; appId: string; jobTitle: string; company: string; portal: string; status: string; matchScore: number; createdAt: Date; submittedAt?: Date }>({ notesEnc: 0, coverLetterEnc: 0, questions: 0 }).toArray();
  const today = jobs.filter((j) => new Date(j.discoveredAt) >= startOfDay);
  const appliedStatuses = new Set(["Applied", "Interview", "Offer", "Rejected", "Closed"]);
  const submitted = apps.filter((a) => a.submittedAt);
  const responded = submitted.filter((a) => ["Interview", "Offer", "Rejected"].includes(a.status));
  const interviews = submitted.filter((a) => ["Interview", "Offer"].includes(a.status));
  const scored = jobs.filter((j) => typeof j.matchScore === "number");
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  return {
    today: {
      discovered: today.length,
      matched: today.filter((j) => j.decision && !["SKIP", "LOW_RELEVANCE"].includes(j.decision)).length,
      submitted: submitted.filter((a) => new Date(a.submittedAt!) >= startOfDay).length,
      pending: jobs.filter((j) => j.status === "Awaiting Approval").length,
      manual: jobs.filter((j) => j.status === "Manual Action Required").length + apps.filter((a) => a.status === "Manual Action Required").length,
      failed: apps.filter((a) => a.status === "Application Failed").length,
    },
    stats: {
      totalApplications: submitted.length,
      week: submitted.filter((a) => now - new Date(a.submittedAt!).getTime() < 7 * DAY).length,
      month: submitted.filter((a) => now - new Date(a.submittedAt!).getTime() < 30 * DAY).length,
      avgMatch: scored.length ? Math.round(scored.reduce((n, j) => n + (j.matchScore ?? 0), 0) / scored.length) : 0,
      successRate: pct(apps.filter((a) => appliedStatuses.has(a.status)).length, apps.length),
      interviewRate: pct(interviews.length, submitted.length),
      responseRate: pct(responded.length, submitted.length),
    },
    breakdown: {
      strong: jobs.filter((j) => (j.matchScore ?? 0) >= 80).length,
      review: jobs.filter((j) => j.status === "Awaiting Approval" || j.status === "Manual Action Required").length,
      low: jobs.filter((j) => j.status === "Low Relevance" || j.status === "Skipped").length,
      total: jobs.length,
    },
    recent: apps.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 8),
  };
});
