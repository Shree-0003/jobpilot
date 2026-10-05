import { z } from "zod";
import { route, body } from "@/lib/http";
import { cols } from "@/lib/db";
import { audit, securityEvent } from "@/lib/audit";

const Schema = z.object({ state: z.enum(["running", "paused", "stopped"]) });

export const GET = route({ auth: "full" }, async ({ user }) => {
  const p = await (await cols.prefs()).findOne({ _id: user._id });
  return { state: p?.automationState ?? "running", autoApplyEnabled: !!p?.autoApplyEnabled };
});

// Emergency Stop takes effect immediately: every approval and discovery path re-reads this flag.
export const POST = route({ auth: "full", limit: 30 }, async ({ req, user, ip }) => {
  const { state } = await body(req, Schema);
  const set: Record<string, unknown> = { automationState: state, updatedAt: new Date() };
  if (state === "stopped") set.autoApplyEnabled = false;
  await (await cols.prefs()).updateOne({ _id: user._id }, { $set: set });
  await audit({ userId: user._id, actor: "user", action: state === "stopped" ? "emergency_stop" : `automation_${state}` });
  if (state === "stopped") await securityEvent({ userId: user._id, type: "emergency_stop", severity: "info", ip });
  return { ok: true, state };
});
