import { route } from "@/lib/http";
import { cols } from "@/lib/db";
import { destroyCurrentSession } from "@/lib/auth/session";
import { audit, securityEvent } from "@/lib/audit";

export const POST = route({ auth: "full" }, async ({ user, ip }) => {
  const r = await (await cols.sessions()).deleteMany({ userId: user._id });
  await destroyCurrentSession();
  await audit({ userId: user._id, actor: "user", action: "logout_all_sessions", details: { revoked: r.deletedCount } });
  await securityEvent({ userId: user._id, type: "all_sessions_revoked", severity: "info", ip });
  return { ok: true };
});
