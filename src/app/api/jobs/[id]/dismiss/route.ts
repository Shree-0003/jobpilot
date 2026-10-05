import { route, ApiError } from "@/lib/http";
import { cols } from "@/lib/db";
import { audit } from "@/lib/audit";

export const POST = route({ auth: "full" }, async ({ user, params }) => {
  const r = await (await cols.jobs()).updateOne({ _id: params.id, userId: user._id, status: { $ne: "Approved" } }, { $set: { status: "Dismissed" } });
  if (!r.matchedCount) throw new ApiError(404, "Job not found or already approved.");
  await audit({ userId: user._id, actor: "user", action: "job_dismissed", entity: "job", entityId: params.id });
  return { ok: true };
});
