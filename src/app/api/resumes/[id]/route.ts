import { z } from "zod";
import { route, body, ApiError } from "@/lib/http";
import { cols } from "@/lib/db";
import { audit } from "@/lib/audit";
import { deleteObject } from "@/lib/resumes";

const Schema = z.object({
  approved: z.boolean().optional(),
  label: z.string().trim().min(1).max(80).optional(),
  focusKeywords: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export const PATCH = route({ auth: "full" }, async ({ req, user, params }) => {
  const v = await body(req, Schema);
  const c = await cols.resumes();
  const r = await c.findOne({ _id: params.id, userId: user._id });
  if (!r) throw new ApiError(404, "Resume not found.");
  const set: Record<string, unknown> = {};
  if (v.label) set.label = v.label;
  if (v.focusKeywords) set.focusKeywords = v.focusKeywords;
  if (v.approved !== undefined) {
    if (v.approved && r.scanStatus !== "clean") throw new ApiError(409, "Only clean files can be approved.");
    set.approved = v.approved;
    set.approvedAt = v.approved ? new Date() : null;
  }
  await c.updateOne({ _id: r._id }, { $set: set });
  await audit({ userId: user._id, actor: "user", action: v.approved === undefined ? "resume_updated" : v.approved ? "resume_approved" : "resume_unapproved", entity: "resume", entityId: r._id });
  return { ok: true };
});

export const DELETE = route({ auth: "full" }, async ({ user, params }) => {
  const c = await cols.resumes();
  const r = await c.findOne({ _id: params.id, userId: user._id });
  if (!r) throw new ApiError(404, "Resume not found.");
  await deleteObject(r.objectKey);
  await c.deleteOne({ _id: r._id });
  await audit({ userId: user._id, actor: "user", action: "resume_deleted", entity: "resume", entityId: r._id });
  return { ok: true };
});
