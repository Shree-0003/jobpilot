import { route } from "@/lib/http";
import { cols } from "@/lib/db";

export const GET = route({ auth: "full" }, async ({ user }) => {
  const jobs = await (await cols.jobs()).find({ userId: user._id, status: "Manual Action Required" }).sort({ discoveredAt: -1 }).limit(200)
    .project({ _id: 1, title: 1, company: 1, portal: 1, url: 1, matchScore: 1, statusReason: 1, discoveredAt: 1 }).toArray();
  const apps = await (await cols.applications()).find({ userId: user._id, status: { $in: ["Manual Action Required", "Application Failed"] } }).sort({ createdAt: -1 }).limit(200)
    .project({ notesEnc: 0, coverLetterEnc: 0, userId: 0 }).toArray();
  const enriched = apps.map((a) => {
    const qs = (a.questions ?? []) as { status: string }[];
    return { ...a, questions: undefined, pendingAnswers: qs.filter((q) => q.status !== "approved").length, reviewRequired: qs.filter((q) => q.status === "human_review_required").length };
  });
  const awaiting = await (await cols.jobs()).countDocuments({ userId: user._id, status: "Awaiting Approval" });
  return { jobs, applications: enriched, awaitingApproval: awaiting };
});
