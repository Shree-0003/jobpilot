import { z } from "zod";
import { route, body, ApiError } from "@/lib/http";
import { cols } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { audit, securityEvent } from "@/lib/audit";

const Schema = z.object({ enabled: z.boolean(), password: z.string().max(128).optional() });

// Enabling Auto Apply requires re-entering the password. Even when enabled, the policy engine only
// lets connectors whose ToS review permits automated submission act (none in the MVP).
export const POST = route({ auth: "full", limit: 10 }, async ({ req, user, ip }) => {
  const { enabled, password } = await body(req, Schema);
  if (enabled) {
    if (!password || !(await verifyPassword(user.passwordHash, password))) {
      await securityEvent({ userId: user._id, type: "reauth_failed", severity: "medium", ip, details: { action: "enable_auto_apply" } });
      throw new ApiError(403, "Password is incorrect.");
    }
    const p = await (await cols.prefs()).findOne({ _id: user._id });
    if (p?.automationState === "stopped") throw new ApiError(409, "Clear the Emergency Stop first.");
  }
  await (await cols.prefs()).updateOne({ _id: user._id }, { $set: { autoApplyEnabled: enabled, updatedAt: new Date() } });
  await audit({ userId: user._id, actor: "user", action: enabled ? "auto_apply_enabled" : "auto_apply_disabled" });
  return { ok: true, enabled };
});
