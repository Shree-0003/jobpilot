import { route, ApiError } from "@/lib/http";
import { verifyFact } from "@/lib/facts";

export const POST = route({ auth: "full" }, async ({ user, params }) => {
  if (!/^F\d{3,6}$/.test(params.factId)) throw new ApiError(400, "Bad fact id.");
  if (!(await verifyFact(user._id, params.factId))) throw new ApiError(404, "Fact not found.");
  return { ok: true };
});
