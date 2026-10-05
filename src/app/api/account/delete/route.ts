import { z } from "zod";
import { route, body, ApiError } from "@/lib/http";
import { cols } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { audit, securityEvent } from "@/lib/audit";
import { destroyCurrentSession } from "@/lib/auth/session";
import { purgeAllObjects } from "@/lib/resumes";

const Schema = z.object({
  password: z.string().min(1).max(128),
  confirm: z.literal("DELETE"),
  scope: z.enum(["everything", "history", "resumes"]),
});

/**
 * Delete My Data.
 *  - history: jobs, evaluations, applications, notifications, AI logs
 *  - resumes: resume files and records
 *  - everything: all of the above + profile, facts, preferences, sessions, then the account
 *    itself; the wrapped data key is destroyed, which crypto-shreds anything left in backups.
 * The hash-chained audit log keeps non-PII entries (event names, IDs) for integrity.
 */
export const POST = route({ auth: "full", limit: 5 }, async ({ req, user, ip }) => {
  const { password, scope } = await body(req, Schema);
  if (!(await verifyPassword(user.passwordHash, password))) {
    await securityEvent({ userId: user._id, type: "reauth_failed", severity: "medium", ip, details: { action: "delete" } });
    throw new ApiError(403, "Password is incorrect.");
  }
  const uid = user._id;
  const counts: Record<string, number> = {};
  const del = async (name: keyof typeof cols, filter: Record<string, unknown>) => {
    const r = await (await (cols[name] as unknown as () => Promise<import("mongodb").Collection<import("mongodb").Document>>)()).deleteMany(filter);
    counts[name] = r.deletedCount;
  };
  if (scope === "resumes" || scope === "everything") {
    const rs = await (await cols.resumes()).find({ userId: uid }).project<{ objectKey: string }>({ objectKey: 1 }).toArray();
    await purgeAllObjects(rs.map((r) => r.objectKey));
    await del("resumes", { userId: uid });
  }
  if (scope === "history" || scope === "everything") {
    for (const n of ["jobs", "evaluations", "applications", "notifications", "aiLog"] as const) await del(n, { userId: uid });
  }
  await audit({ userId: uid, actor: "user", action: `data_deleted_${scope}`, details: counts });
  if (scope === "everything") {
    for (const n of ["facts", "factChanges", "securityEvents", "sessions"] as const) await del(n, { userId: uid });
    await del("profiles", { _id: uid });
    await del("prefs", { _id: uid });
    await (await cols.counters()).deleteMany({ _id: { $in: [`fact:${uid}`, `app:${uid}`] } });
    await (await cols.users()).deleteOne({ _id: uid }); // destroys wrappedDek → crypto-shred
    await destroyCurrentSession();
  }
  return { ok: true, scope, counts };
});
