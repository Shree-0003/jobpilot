import "server-only";
import { cols } from "./db";
import { newId, sha256 } from "./crypto";
import type { AuditDoc, Severity } from "./types";

const GENESIS = "0".repeat(64);

/** Deterministic JSON so the hash is stable regardless of key order. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

export function computeRowHash(r: Omit<AuditDoc, "_id" | "rowHash">): string {
  return sha256(
    canonical({ seq: r.seq, ts: r.ts, userId: r.userId, actor: r.actor, action: r.action, entity: r.entity ?? null, entityId: r.entityId ?? null, details: r.details, prevHash: r.prevHash }),
  );
}

const PII_KEYS = /pass|secret|token|cookie|otp|code|phone|email|address|dob|salary|answer/i;
function scrub(d: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) out[k] = PII_KEYS.test(k) ? "[redacted]" : v;
  return out;
}

/**
 * Append-only, hash-chained audit log. The unique index on `seq` serialises writers;
 * a conflicting writer retries against the new tail.
 */
export async function audit(entry: { userId: string; actor: AuditDoc["actor"]; action: string; entity?: string; entityId?: string; details?: Record<string, unknown> }) {
  const c = await cols.audit();
  for (let attempt = 0; attempt < 8; attempt++) {
    const tail = await c.find({}).sort({ seq: -1 }).limit(1).next();
    const base = {
      seq: (tail?.seq ?? 0) + 1,
      ts: new Date(),
      userId: entry.userId,
      actor: entry.actor,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      // JSON round-trip drops undefined values so the stored row hashes identically when re-read.
      details: JSON.parse(JSON.stringify(scrub(entry.details ?? {}))) as Record<string, unknown>,
      prevHash: tail?.rowHash ?? GENESIS,
    };
    const doc: AuditDoc = { _id: newId(), ...base, rowHash: computeRowHash(base) };
    try {
      await c.insertOne(doc);
      return doc;
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
    }
  }
  throw new Error("Audit log contention");
}

export async function verifyAuditChain(): Promise<{ ok: boolean; checked: number; brokenAtSeq?: number }> {
  const c = await cols.audit();
  let prev = GENESIS;
  let checked = 0;
  for await (const r of c.find({}).sort({ seq: 1 })) {
    const { _id, rowHash, ...rest } = r;
    void _id;
    if (r.prevHash !== prev || computeRowHash({ ...rest, ts: new Date(r.ts) }) !== rowHash) {
      return { ok: false, checked, brokenAtSeq: r.seq };
    }
    prev = rowHash;
    checked++;
  }
  return { ok: true, checked };
}

export async function securityEvent(e: { userId?: string; type: string; severity: Severity; ip?: string; details?: Record<string, unknown> }) {
  const c = await cols.securityEvents();
  await c.insertOne({ _id: newId(), ts: new Date(), userId: e.userId, type: e.type, severity: e.severity, ip: e.ip, details: scrub(e.details ?? {}) });
  if (e.userId && (e.severity === "high" || e.severity === "medium")) {
    await notify(e.userId, "security", `Security: ${e.type.replace(/_/g, " ")}`, "Review the Security page for details.", "/security");
  }
}

export async function notify(userId: string, kind: import("./types").NotificationDoc["kind"], title: string, body: string, link?: string) {
  const c = await cols.notifications();
  await c.insertOne({ _id: newId(), userId, ts: new Date(), kind, title, body, link, read: false });
}
