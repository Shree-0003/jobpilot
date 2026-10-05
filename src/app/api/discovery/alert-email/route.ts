import { z } from "zod";
import { route, body, ApiError } from "@/lib/http";
import { cols } from "@/lib/db";
import { parseAlertEmail } from "@/lib/jobs/sources/alertEmail";
import { ingestDrafts } from "@/lib/jobs/service";
import { audit } from "@/lib/audit";

const Schema = z.object({ text: z.string().min(20).max(500_000) });

export const POST = route({ auth: "full", limit: 20 }, async ({ req, user, cipher }) => {
  const prefs = await (await cols.prefs()).findOne({ _id: user._id });
  if (prefs?.automationState !== "running") throw new ApiError(409, "Automation is paused or stopped.");
  const { text } = await body(req, Schema);
  const drafts = parseAlertEmail(text);
  if (!drafts.length) throw new ApiError(422, "No LinkedIn or Naukri job links found in that email.");
  const r = await ingestDrafts(user, cipher, drafts);
  await audit({ userId: user._id, actor: "user", action: "alert_email_imported", details: { found: drafts.length, created: r.created.length, duplicates: r.duplicates.length } });
  return { found: drafts.length, created: r.created.length, duplicates: r.duplicates.length };
});
