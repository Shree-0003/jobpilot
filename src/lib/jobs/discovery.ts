import "server-only";
import { cols, db } from "../db";
import { env } from "../env";
import { UserCipher } from "../crypto";
import { audit, notify, securityEvent } from "../audit";
import { isRelevantTitle } from "../ai/baseline";
import { canonicalUrl, dedupeHash, externalJobId } from "./dedupe";
import { findDuplicate, ingestDrafts } from "./service";
import { fetchAlertsViaImap, imapConfigured } from "./sources/gmailImap";
import { fetchAdzuna, adzunaConfigured } from "./sources/adzuna";
import { fetchAlertsViaMcp, mcpConfigured } from "./sources/mcpGmail";
import { fetchBoard } from "./sources/careerBoards";
import type { JobDraft } from "./sources/types";
import type { PrefsDoc, UserDoc } from "../types";

export interface SourceResult { source: string; found: number; relevant: number; created: number; error?: string }
export interface DiscoveryStatus {
  _id: string;
  running: boolean;
  trigger?: "schedule" | "manual";
  startedAt?: Date;
  finishedAt?: Date;
  nextRunAt?: Date;
  results: SourceResult[];
  created: number;
  strong: number;
  error?: string;
}

const running = new Set<string>();

async function statusCol() {
  return (await db()).collection<DiscoveryStatus>("discovery_status");
}

export async function getDiscoveryStatus(userId: string): Promise<DiscoveryStatus> {
  const c = await statusCol();
  const d = await c.findOne({ _id: userId });
  return { _id: userId, running: false, results: [], created: 0, strong: 0, ...(d ?? {}) } as DiscoveryStatus;
}

export function sourcesConfigured(prefs?: PrefsDoc | null) {
  return {
    gmailImap: imapConfigured(),
    adzuna: adzunaConfigured(),
    gmailMcp: mcpConfigured(),
    careerBoards: (prefs?.careerBoards?.length ?? 0) > 0,
  };
}

function adzunaQueries(prefs: PrefsDoc): string[] {
  const titles = prefs.targetTitles.length ? prefs.targetTitles : ["GRC Analyst", "Information Security Analyst"];
  return [...new Set(titles.map((t) => t.replace(/&/g, "and").trim()))];
}

/** Runs every configured source once for this user, then scores and stores new relevant jobs. */
export async function runDiscovery(user: UserDoc, trigger: "schedule" | "manual"): Promise<DiscoveryStatus> {
  if (running.has(user._id)) return getDiscoveryStatus(user._id);
  running.add(user._id);
  const c = await statusCol();
  const startedAt = new Date();
  await c.updateOne({ _id: user._id }, { $set: { running: true, trigger, startedAt, results: [], created: 0, strong: 0 }, $unset: { error: "" } }, { upsert: true });
  const results: SourceResult[] = [];
  let created = 0;
  let strong = 0;
  try {
    const prefs = (await (await cols.prefs()).findOne({ _id: user._id })) as PrefsDoc;
    if (prefs.automationState !== "running") throw new Error(`Automation is ${prefs.automationState}.`);
    const cipher = new UserCipher(user._id, user.wrappedDek);
    const maxNew = env().DISCOVERY_MAX_NEW_PER_RUN;
    const where = prefs.preferredLocations.find((l) => !/remote/i.test(l)) ?? "";

    const sources: [string, () => Promise<JobDraft[]>][] = [];
    if (imapConfigured()) sources.push(["Gmail alerts (LinkedIn / Naukri)", async () => (await fetchAlertsViaImap(3)).drafts]);
    if (mcpConfigured()) sources.push(["Gmail alerts via MCP", async () => (await fetchAlertsViaMcp()).drafts]);
    if (adzunaConfigured()) sources.push(["Adzuna India", () => fetchAdzuna(adzunaQueries(prefs), where)]);
    for (const b of prefs.careerBoards) sources.push([`${b.vendor}:${b.token}`, () => fetchBoard(b)]);
    if (!sources.length) throw new Error("No job sources are set up yet. Add Gmail or Adzuna in .env (see Data & Integrations).");

    for (const [name, fetcher] of sources) {
      if (created >= maxNew) { results.push({ source: name, found: 0, relevant: 0, created: 0, error: `skipped: ${maxNew} new jobs per run reached` }); continue; }
      try {
        const all = await fetcher();
        const relevant = all.filter((d) => isRelevantTitle(d.title, prefs));
        const fresh: JobDraft[] = [];
        for (const d of relevant) {
          if (fresh.length + created >= maxNew) break;
          const dup = await findDuplicate(user._id, { urlCanonical: canonicalUrl(d.url), externalJobId: d.externalJobId ?? externalJobId(d.url), dedupeHash: dedupeHash(d.company, d.title) });
          if (!dup && !fresh.some((f) => dedupeHash(f.company, f.title) === dedupeHash(d.company, d.title))) fresh.push(d);
        }
        const r = await ingestDrafts(user, cipher, fresh);
        created += r.created.length;
        results.push({ source: name, found: all.length, relevant: relevant.length, created: r.created.length });
      } catch (e) {
        const msg = (e as Error).message.replace(/app_key=[^&\s]+/g, "app_key=***").slice(0, 200);
        results.push({ source: name, found: 0, relevant: 0, created: 0, error: msg });
        await securityEvent({ userId: user._id, type: "connector_error", severity: "low", details: { connector: name, error: msg } });
      }
    }
    if (created) {
      strong = await (await cols.jobs()).countDocuments({ userId: user._id, discoveredAt: { $gte: startedAt }, matchScore: { $gte: prefs.limits.minMatchScore } });
      const review = await (await cols.jobs()).countDocuments({ userId: user._id, discoveredAt: { $gte: startedAt }, status: "Awaiting Approval" });
      await notify(user._id, "automation", `${created} new job${created === 1 ? "" : "s"} found`, `${strong} strong match${strong === 1 ? "" : "es"} · ${review} awaiting your approval`, "/jobs?status=Awaiting%20Approval");
    }
    await audit({ userId: user._id, actor: "system", action: "discovery_run", details: { trigger, created, strong, sources: results.length, errors: results.filter((r) => r.error).length } });
    const done: Partial<DiscoveryStatus> = { running: false, finishedAt: new Date(), results, created, strong };
    await c.updateOne({ _id: user._id }, { $set: done });
  } catch (e) {
    await c.updateOne({ _id: user._id }, { $set: { running: false, finishedAt: new Date(), results, created, strong, error: (e as Error).message.slice(0, 200) } });
  } finally {
    running.delete(user._id);
  }
  return getDiscoveryStatus(user._id);
}

/** Background scheduler: checks every 5 minutes and runs discovery when the interval has passed. */
export function startScheduler() {
  const g = globalThis as unknown as { __jpScheduler?: NodeJS.Timeout };
  if (g.__jpScheduler) return;
  const tick = async () => {
    try {
      const hours = env().DISCOVERY_INTERVAL_HOURS;
      if (!hours) return;
      const users = await (await cols.users()).find({ mfaEnabled: true }).toArray();
      for (const u of users) {
        const st = await getDiscoveryStatus(u._id);
        const last = st.startedAt ? new Date(st.startedAt).getTime() : 0;
        const due = last + hours * 3_600_000;
        const c = await statusCol();
        await c.updateOne({ _id: u._id }, { $set: { nextRunAt: new Date(Math.max(due, Date.now())) } }, { upsert: true });
        if (Date.now() >= due && !st.running) await runDiscovery(u, "schedule");
      }
    } catch (e) {
      console.error("[scheduler]", (e as Error).message);
    }
  };
  g.__jpScheduler = setInterval(tick, 5 * 60_000);
  setTimeout(tick, 60_000); // first check one minute after start
}
