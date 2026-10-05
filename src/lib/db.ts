import "server-only";
import { MongoClient, type Db, type Collection, type Document } from "mongodb";
import { env } from "./env";
import type * as T from "./types";

const g = globalThis as unknown as { __mongo?: Promise<MongoClient>; __indexes?: Promise<void> };

async function client(): Promise<MongoClient> {
  if (!g.__mongo) {
    g.__mongo = MongoClient.connect(env().MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      appName: "jobpilot",
      ignoreUndefined: true,
    }).catch((e) => {
      g.__mongo = undefined;
      throw e;
    });
  }
  return g.__mongo;
}

export async function db(): Promise<Db> {
  const d = (await client()).db(env().MONGODB_DB);
  if (!g.__indexes) g.__indexes = ensureIndexes(d).catch((e) => { g.__indexes = undefined; throw e; });
  await g.__indexes;
  return d;
}

async function col<D extends Document>(name: string): Promise<Collection<D>> {
  return (await db()).collection<D>(name);
}

export const cols = {
  users: () => col<T.UserDoc>("users"),
  sessions: () => col<T.SessionDoc>("sessions"),
  profiles: () => col<T.ProfileDoc>("profiles"),
  facts: () => col<T.FactDoc>("verified_facts"),
  factChanges: () => col<T.FactChangeDoc>("fact_changes"),
  prefs: () => col<T.PrefsDoc>("job_preferences"),
  resumes: () => col<T.ResumeDoc>("resumes"),
  jobs: () => col<T.JobDoc>("jobs"),
  evaluations: () => col<T.EvaluationDoc>("job_evaluations"),
  applications: () => col<T.ApplicationDoc>("applications"),
  audit: () => col<T.AuditDoc>("audit_log"),
  securityEvents: () => col<T.SecurityEventDoc>("security_events"),
  aiLog: () => col<T.AiLogDoc>("ai_gateway_log"),
  notifications: () => col<T.NotificationDoc>("notifications"),
  counters: () => col<{ _id: string; seq: number }>("counters"),
};

async function ensureIndexes(d: Db) {
  await Promise.all([
    d.collection("users").createIndex({ email: 1 }, { unique: true }),
    d.collection("sessions").createIndex({ tokenHash: 1 }, { unique: true }),
    d.collection("sessions").createIndex({ userId: 1 }),
    d.collection("verified_facts").createIndex({ userId: 1, factId: 1 }, { unique: true }),
    d.collection("jobs").createIndex({ userId: 1, dedupeHash: 1 }),
    d.collection("jobs").createIndex({ userId: 1, urlCanonical: 1 }),
    d.collection("applications").createIndex({ userId: 1, status: 1 }),
    d.collection("audit_log").createIndex({ seq: 1 }, { unique: true }),
    d.collection("security_events").createIndex({ userId: 1, ts: -1 }),
    d.collection("notifications").createIndex({ userId: 1, read: 1 }),
  ]);
}

/** Atomic per-user counter, used for human-readable IDs (F001, APP-000001). */
export async function nextSeq(key: string): Promise<number> {
  const c = await cols.counters();
  const r = await c.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  return r!.seq;
}
