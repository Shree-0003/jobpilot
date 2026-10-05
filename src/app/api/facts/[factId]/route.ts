import { route, body, ApiError } from "@/lib/http";
import { deleteFact, FactInput, updateFact } from "@/lib/facts";

const ID = /^F\d{3,6}$/;

export const PUT = route({ auth: "full", limit: 60 }, async ({ req, user, cipher, params }) => {
  if (!ID.test(params.factId)) throw new ApiError(400, "Bad fact id.");
  const f = await updateFact(user._id, cipher, params.factId, await body(req, FactInput));
  if (!f) throw new ApiError(404, "Fact not found.");
  return { fact: f };
});

export const DELETE = route({ auth: "full", limit: 60 }, async ({ user, params }) => {
  if (!ID.test(params.factId)) throw new ApiError(400, "Bad fact id.");
  if (!(await deleteFact(user._id, params.factId))) throw new ApiError(404, "Fact not found.");
  return { ok: true };
});
