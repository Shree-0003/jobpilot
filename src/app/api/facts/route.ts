import { route, body } from "@/lib/http";
import { createFact, FactInput, listFacts } from "@/lib/facts";

export const GET = route({ auth: "full" }, async ({ user, cipher }) => ({ facts: await listFacts(user._id, cipher) }));

export const POST = route({ auth: "full", limit: 60 }, async ({ req, user, cipher }) => {
  const input = await body(req, FactInput);
  return { fact: await createFact(user._id, cipher, input, "user") };
});
