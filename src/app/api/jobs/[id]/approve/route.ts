import { z } from "zod";
import { route, body } from "@/lib/http";
import { approveJob } from "@/lib/applications";

const Schema = z.object({ resumeId: z.string().uuid().optional(), acknowledgeRisk: z.boolean().optional() });

export const POST = route({ auth: "full", limit: 30 }, async ({ req, user, cipher, params, ip }) => {
  const v = await body(req, Schema);
  const app = await approveJob(user, cipher, params.id, { ...v, ip });
  return { applicationId: app._id, appId: app.appId };
});
