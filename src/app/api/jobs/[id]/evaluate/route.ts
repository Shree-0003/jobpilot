import { route, ApiError } from "@/lib/http";
import { evaluateJob } from "@/lib/jobs/service";

export const POST = route({ auth: "full", limit: 20 }, async ({ user, cipher, params }) => {
  const ev = await evaluateJob(user, cipher, params.id);
  if (!ev) throw new ApiError(404, "Job not found.");
  return { evaluation: ev };
});
