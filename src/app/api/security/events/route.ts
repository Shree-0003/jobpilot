import { route } from "@/lib/http";
import { cols } from "@/lib/db";

export const GET = route({ auth: "full" }, async ({ user }) => {
  const events = await (await cols.securityEvents()).find({ userId: user._id }).sort({ ts: -1 }).limit(200).project({ _id: 0, userId: 0 }).toArray();
  const sessions = await (await cols.sessions()).find({ userId: user._id }).project({ _id: 1, ip: 1, userAgent: 1, createdAt: 1, lastSeenAt: 1, mfaVerified: 1 }).toArray();
  const ai = await (await cols.aiLog()).find({ userId: user._id }).sort({ ts: -1 }).limit(50).project({ _id: 0, userId: 0 }).toArray();
  return { events, sessions, ai };
});
