import { route } from "@/lib/http";
import { destroyCurrentSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export const POST = route({ auth: "pre-mfa" }, async ({ user }) => {
  await destroyCurrentSession();
  await audit({ userId: user._id, actor: "user", action: "logout" });
  return { ok: true };
});
