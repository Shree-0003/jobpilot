import { route } from "@/lib/http";
import { cols } from "@/lib/db";

export const GET = route({ auth: "none" }, async ({ user, session }) => {
  const anyUser = (await (await cols.users()).countDocuments({})) > 0;
  if (!user || !session) return { authenticated: false, registrationOpen: !anyUser };
  return { authenticated: true, mfaVerified: session.mfaVerified, mfaEnabled: user.mfaEnabled, email: user.email };
});
