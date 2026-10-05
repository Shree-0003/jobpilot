"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtDate } from "@/lib/client";
import { Alert, Badge, Button, Card } from "./ui";

type Result = { source: string; found: number; relevant: number; created: number; error?: string };
type Status = {
  sources: { gmailImap: boolean; adzuna: boolean; gmailMcp: boolean; careerBoards: boolean };
  schedule: { everyHours: number; maxNewPerRun: number };
  discovery: { running: boolean; startedAt?: string; finishedAt?: string; nextRunAt?: string; results: Result[]; created: number; strong: number; error?: string; trigger?: string };
  llm: { ok: boolean; detail: string };
};

export default function DiscoveryPanel({ onFinished }: { onFinished?: () => void }) {
  const [s, setS] = useState<Status | null>(null);
  const [msg, setMsg] = useState<string>("");
  const wasRunning = useRef(false);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  const load = useCallback(async () => {
    const r = await api<Status>("/api/discovery/status");
    setS(r);
    if (wasRunning.current && !r.discovery.running) { finished.current?.(); window.dispatchEvent(new Event("jp:refresh")); }
    wasRunning.current = r.discovery.running;
    return r;
  }, []);

  useEffect(() => { load().catch(() => undefined); }, [load]);
  useEffect(() => {
    if (!s?.discovery.running) return;
    const t = setInterval(() => load().catch(() => undefined), 4000);
    return () => clearInterval(t);
  }, [s?.discovery.running, load]);

  async function run() {
    setMsg("");
    try {
      await api("/api/discovery/run", { method: "POST" });
      wasRunning.current = true;
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  if (!s) return null;
  const d = { ...s.discovery, results: s.discovery.results ?? [] };
  const anySource = s.sources.gmailImap || s.sources.adzuna || s.sources.gmailMcp || s.sources.careerBoards;
  return (
    <Card
      title="Automatic job discovery"
      actions={<Button onClick={run} busy={d.running} disabled={!anySource}>{d.running ? "Finding jobs…" : "Find jobs now"}</Button>}
    >
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge tone={s.sources.gmailImap ? "green" : "slate"}>Gmail alerts {s.sources.gmailImap ? "on" : "off"}</Badge>
          <Badge tone={s.sources.adzuna ? "green" : "slate"}>Adzuna India {s.sources.adzuna ? "on" : "off"}</Badge>
          <Badge tone={s.sources.careerBoards ? "green" : "slate"}>Career boards {s.sources.careerBoards ? "on" : "off"}</Badge>
          <Badge tone={s.llm.ok ? "green" : "amber"}>AI scoring {s.llm.ok ? "ready" : "unavailable (rules only)"}</Badge>
        </div>
        {!anySource && (
          <Alert tone="amber">
            No job sources are set up, so nothing can arrive automatically yet. Turn on Gmail alerts and/or Adzuna — see{" "}
            <Link className="font-medium underline" href="/settings">Data &amp; Integrations</Link>.
          </Alert>
        )}
        {anySource && (
          <p className="text-slate-600">
            {s.schedule.everyHours ? `Runs every ${s.schedule.everyHours} h` : "Scheduled runs are off"} · up to {s.schedule.maxNewPerRun} new jobs per run
            {d.nextRunAt && !d.running ? ` · next run ${fmtDate(d.nextRunAt)}` : ""}
            {d.finishedAt ? ` · last run ${fmtDate(d.finishedAt)}` : ""}
          </p>
        )}
        {d.running && <p className="text-brand-700">Fetching and scoring jobs… On a CPU each job takes up to a minute to score, so this can take a while. You can leave this page.</p>}
        {!d.running && d.error && <Alert tone="red">Last run: {d.error}</Alert>}
        {!d.running && d.finishedAt && !d.error && (
          <p className="font-medium">
            Last run added {d.created} new job{d.created === 1 ? "" : "s"} ({d.strong} strong match{d.strong === 1 ? "" : "es"}).{" "}
            {d.created > 0 && <Link className="text-brand-600 hover:underline" href="/jobs?status=Awaiting%20Approval">Review them →</Link>}
          </p>
        )}
        {d.results.length > 0 && (
          <ul className="space-y-0.5 text-xs text-slate-500">
            {d.results.map((r, i) => (
              <li key={i}>{r.source}: {r.error ? <span className="text-red-600">{r.error}</span> : `${r.found} found · ${r.relevant} relevant · ${r.created} new`}</li>
            ))}
          </ul>
        )}
        {msg && <Alert tone="red">{msg}</Alert>}
      </div>
    </Card>
  );
}
