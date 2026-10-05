import { z } from "zod";
import { route, body } from "@/lib/http";
import { cols } from "@/lib/db";

export const GET = route({ auth: "full" }, async ({ user }) => {
  const c = await cols.notifications();
  const items = await c.find({ userId: user._id }).sort({ ts: -1 }).limit(30).project({ userId: 0 }).toArray();
  return { items, unread: await c.countDocuments({ userId: user._id, read: false }) };
});

const Schema = z.object({ ids: z.array(z.string().uuid()).max(100).optional(), all: z.boolean().optional() });
export const POST = route({ auth: "full" }, async ({ req, user }) => {
  const v = await body(req, Schema);
  const c = await cols.notifications();
  await c.updateMany({ userId: user._id, ...(v.all ? {} : { _id: { $in: v.ids ?? [] } }) }, { $set: { read: true } });
  return { ok: true };
});
