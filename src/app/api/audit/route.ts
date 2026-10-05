import { route } from "@/lib/http";
import { cols } from "@/lib/db";

export const GET = route({ auth: "full" }, async ({ req, user }) => {
  const page = Math.max(0, Math.min(1000, Number(req.nextUrl.searchParams.get("page") ?? 0) || 0));
  const c = await cols.audit();
  const total = await c.countDocuments({ userId: user._id });
  const rows = await c.find({ userId: user._id }).sort({ seq: -1 }).skip(page * 50).limit(50).project({ _id: 0, userId: 0 }).toArray();
  return { rows, total, page };
});
