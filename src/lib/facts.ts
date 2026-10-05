import "server-only";
import { z } from "zod";
import { cols, nextSeq } from "./db";
import { newId, type UserCipher } from "./crypto";
import { audit } from "./audit";
import { FACT_CATEGORIES, type Fact, type FactDoc } from "./types";

export const FactInput = z.object({
  category: z.enum(FACT_CATEGORIES),
  label: z.string().trim().min(1).max(160),
  value: z.string().trim().max(2000).default(""),
  valueNumeric: z.number().finite().min(0).max(100000).optional(),
  unit: z.string().trim().max(20).optional(),
});
export type FactInputT = z.infer<typeof FactInput>;

export function toFact(d: FactDoc, cipher: UserCipher): Fact {
  return {
    factId: d.factId,
    category: d.category,
    label: d.label,
    value: cipher.dec(d.valueEnc),
    valueNumeric: typeof d.valueNumeric === "number" ? d.valueNumeric : undefined,
    unit: d.unit ?? undefined,
    verified: d.verified,
    source: d.source,
    version: d.version,
    updatedAt: new Date(d.updatedAt).toISOString(),
  };
}

export async function listFacts(userId: string, cipher: UserCipher, onlyVerified = false): Promise<Fact[]> {
  const c = await cols.facts();
  const docs = await c.find({ userId, ...(onlyVerified ? { verified: true } : {}) }).sort({ factId: 1 }).toArray();
  return docs.map((d) => toFact(d, cipher));
}

export async function createFact(userId: string, cipher: UserCipher, input: FactInputT, source: "user" | "ai_proposed" = "user") {
  const n = await nextSeq(`fact:${userId}`);
  const factId = `F${String(n).padStart(3, "0")}`;
  const now = new Date();
  const doc: FactDoc = {
    _id: newId(), userId, factId, category: input.category, label: input.label,
    valueEnc: cipher.enc(input.value ?? ""), valueNumeric: input.valueNumeric, unit: input.unit,
    // Facts typed by the user are verified by the user; AI proposals must be approved.
    verified: source === "user", source, version: 1, createdAt: now, updatedAt: now,
  };
  await (await cols.facts()).insertOne(doc);
  await (await cols.factChanges()).insertOne({ _id: newId(), userId, factId, action: "create", newEnc: cipher.encJson(input), by: source === "user" ? "user" : "ai", ts: now });
  await audit({ userId, actor: source === "user" ? "user" : "ai", action: "fact_created", entity: "fact", entityId: factId, details: { category: input.category, verified: doc.verified } });
  return toFact(doc, cipher);
}

export async function updateFact(userId: string, cipher: UserCipher, factId: string, input: FactInputT) {
  const c = await cols.facts();
  const old = await c.findOne({ userId, factId });
  if (!old) return null;
  const now = new Date();
  await c.updateOne(
    { _id: old._id },
    { $set: { category: input.category, label: input.label, valueEnc: cipher.enc(input.value ?? ""), valueNumeric: input.valueNumeric, unit: input.unit, verified: true, updatedAt: now }, $inc: { version: 1 } },
  );
  await (await cols.factChanges()).insertOne({ _id: newId(), userId, factId, action: "update", oldEnc: cipher.encJson(toFact(old, cipher)), newEnc: cipher.encJson(input), by: "user", ts: now });
  await audit({ userId, actor: "user", action: "fact_updated", entity: "fact", entityId: factId, details: { category: input.category } });
  return toFact((await c.findOne({ _id: old._id }))!, cipher);
}

export async function verifyFact(userId: string, factId: string) {
  const c = await cols.facts();
  const r = await c.updateOne({ userId, factId }, { $set: { verified: true, updatedAt: new Date() } });
  if (r.matchedCount) {
    await (await cols.factChanges()).insertOne({ _id: newId(), userId, factId, action: "verify", by: "user", ts: new Date() });
    await audit({ userId, actor: "user", action: "fact_verified", entity: "fact", entityId: factId });
  }
  return r.matchedCount > 0;
}

export async function deleteFact(userId: string, factId: string) {
  const r = await (await cols.facts()).deleteOne({ userId, factId });
  if (r.deletedCount) {
    await (await cols.factChanges()).insertOne({ _id: newId(), userId, factId, action: "delete", by: "user", ts: new Date() });
    await audit({ userId, actor: "user", action: "fact_deleted", entity: "fact", entityId: factId });
  }
  return r.deletedCount > 0;
}
