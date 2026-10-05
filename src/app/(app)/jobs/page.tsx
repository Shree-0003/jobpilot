"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, fmtDay } from "@/lib/client";
import DiscoveryPanel from "@/components/DiscoveryPanel";
import { Badge, Button, Card, Empty, Field, Input, Msg, PageHeader, ScoreBadge, Select, StatusBadge, Table, Td, Textarea, useMsg } from "@/components/ui";

type Job = { _id: string; title: string; company: string; location: string; portal: string; source: string; status: string; matchScore?: number; decision?: string; discoveredAt: string; injectionFlag: boolean; url?: string };
const FILTERS = ["", "Awaiting Approval", "Manual Action Required", "Shortlisted", "Low Relevance", "Skipped", "Approved", "Dismissed"];

export default function JobsPage() {
  const [filter, setFilter] = useState("");
  const [data, setData] = useState<{ jobs: Job[]; counts: Record<string, number> } | null>(null);
  const [panel, setPanel] = useState<"" | "paste" | "email">("");
  const [msg, setMsg] = useMsg();
  const [busy, setBusy] = useState("");

  const load = useCallback(async (f: string) => {
    setData(await api(`/api/jobs${f ? `?status=${encodeURIComponent(f)}` : ""}`));
  }, []);
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get("status") ?? "";
    setFilter(f);
    load(f);
  }, [load]);

  async function run(kind: "gmail" | "boards") {
    setBusy(kind);
    setMsg(null);
    try {
      if (kind === "gmail") {
        const r = await api<{ messages: number; found: number; created: number; duplicates: number }>("/api/discovery/gmail", { method: "POST" });
        setMsg({ tone: "green", text: `Gmail: read ${r.messages} alert emails, found ${r.found} jobs, added ${r.created}, skipped ${r.duplicates} duplicates.` });
      } else {
        const r = await api<{ results: { board: string; found: number; created: number; error?: string }[] }>("/api/discovery/boards", { method: "POST" });
        setMsg({ tone: r.results.some((x) => x.error) ? "amber" : "green", text: r.results.map((x) => `${x.board}: ${x.error ? "error — " + x.error : `${x.created} added of ${x.found} matching`}`).join(" · ") });
      }
      load(filter);
      window.dispatchEvent(new Event("jp:refresh"));
    } catch (e) {
      setMsg({ tone: "red", text: (e as Error).message });
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jobs"
        subtitle="Discovered jobs are scored, checked by the policy engine and wait for your approval."
        actions={<>
          <Button variant={panel === "paste" ? "primary" : "secondary"} onClick={() => setPanel(panel === "paste" ? "" : "paste")}>Add job</Button>
          <Button variant={panel === "email" ? "primary" : "secondary"} onClick={() => setPanel(panel === "email" ? "" : "email")}>Import alert email</Button>
          <Button variant="secondary" busy={busy === "gmail"} onClick={() => run("gmail")}>Sync Gmail (MCP)</Button>
          <Button variant="secondary" busy={busy === "boards"} onClick={() => run("boards")}>Sync career boards</Button>
        </>}
      />
      <Msg m={msg} />
      <DiscoveryPanel onFinished={() => load(filter)} />
      {panel === "paste" && <AddJob onDone={(id) => (window.location.href = `/jobs/${id}`)} />}
      {panel === "email" && <ImportEmail onDone={(t) => { setMsg({ tone: "green", text: t }); setPanel(""); load(filter); }} />}
      <Card
        title="Discovered jobs"
        actions={
          <Select aria-label="Filter by status" value={filter} onChange={(e) => { setFilter(e.target.value); load(e.target.value); history.replaceState(null, "", e.target.value ? `?status=${encodeURIComponent(e.target.value)}` : "/jobs"); }} className="w-56">
            {FILTERS.map((f) => <option key={f} value={f}>{f ? `${f} (${data?.counts[f] ?? 0})` : "All statuses"}</option>)}
          </Select>
        }
      >
        {!data ? <p className="text-sm text-slate-500">Loading…</p> : data.jobs.length === 0 ? <Empty>No jobs here yet. Add one, import an alert email, or sync a source.</Empty> : (
          <Table head={["Role", "Portal", "Score", "Status", "Discovered", ""]}>
            {data.jobs.map((j) => (
              <tr key={j._id}>
                <Td>
                  <Link href={`/jobs/${j._id}`} className="font-medium text-slate-900 hover:underline">{j.title}</Link>
                  <div className="text-xs text-slate-500">{j.company}{j.location ? ` · ${j.location}` : ""}</div>
                  {j.injectionFlag && <Badge tone="red">Injection flagged</Badge>}
                </Td>
                <Td><Badge>{j.portal}</Badge> <span className="text-xs text-slate-400">{j.source.replace("_", " ")}</span></Td>
                <Td><ScoreBadge score={j.matchScore} /></Td>
                <Td><StatusBadge status={j.status} /></Td>
                <Td className="whitespace-nowrap text-xs text-slate-500">{fmtDay(j.discoveredAt)}</Td>
                <Td><Link href={`/jobs/${j._id}`} className="text-sm text-brand-600 hover:underline">Review</Link></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function AddJob({ onDone }: { onDone: (id: string) => void }) {
  const [f, setF] = useState({ title: "", company: "", location: "", url: "", description: "", workMode: "unknown", employmentType: "", salaryText: "", experienceText: "", applyEmail: "" });
  const [msg, setMsg] = useMsg();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ id: string }>("/api/jobs", { body: f });
      onDone(r.id);
    } catch (e) {
      setMsg({ tone: "red", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Add a job (paste from LinkedIn, Naukri or a career site)">
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-2" aria-label="Add job">
        <p className="text-xs text-slate-500 md:col-span-2">JobPilot never logs into or scrapes LinkedIn/Naukri. Copy the job text from the page you have open and paste it here.</p>
        <Field label="Job title"><Input name="title" required value={f.title} onChange={set("title")} /></Field>
        <Field label="Company"><Input name="company" required value={f.company} onChange={set("company")} /></Field>
        <Field label="Location"><Input name="location" value={f.location} onChange={set("location")} placeholder="Bengaluru / Remote" /></Field>
        <Field label="Job URL"><Input name="url" value={f.url} onChange={set("url")} placeholder="https://www.linkedin.com/jobs/view/…" /></Field>
        <Field label="Work mode"><Select name="workMode" value={f.workMode} onChange={set("workMode")}><option value="unknown">Not stated</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">On-site</option></Select></Field>
        <Field label="Employment type"><Select name="employmentType" value={f.employmentType} onChange={set("employmentType")}><option value="">Detect from text</option><option value="full-time">Full-time</option><option value="contract">Contract</option><option value="internship">Internship</option><option value="part-time">Part-time</option></Select></Field>
        <Field label="Experience required"><Input name="experienceText" value={f.experienceText} onChange={set("experienceText")} placeholder="3-6 years" /></Field>
        <Field label="Salary (if shown)"><Input name="salaryText" value={f.salaryText} onChange={set("salaryText")} placeholder="12-18 LPA" /></Field>
        <div className="md:col-span-2"><Field label="Job description"><Textarea name="description" rows={8} value={f.description} onChange={set("description")} placeholder="Paste the full description…" /></Field></div>
        <div className="flex items-center gap-3 md:col-span-2"><Button type="submit" busy={busy}>Add and score</Button><Msg m={msg} /></div>
      </form>
    </Card>
  );
}

function ImportEmail({ onDone }: { onDone: (msg: string) => void }) {
  const [text, setText] = useState("");
  const [msg, setMsg] = useMsg();
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ found: number; created: number; duplicates: number }>("/api/discovery/alert-email", { body: { text } });
      onDone(`Found ${r.found} jobs in the alert email, added ${r.created}, skipped ${r.duplicates} duplicates. Paste each description to complete scoring.`);
    } catch (e) {
      setMsg({ tone: "red", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Import a LinkedIn or Naukri job-alert email">
      <form onSubmit={submit} className="space-y-3" aria-label="Import alert email">
        <p className="text-xs text-slate-500">Open the alert email in your mail app, select all, copy and paste here (text or HTML source). Only job links, titles, companies and locations are extracted.</p>
        <Textarea name="alert" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the email…" />
        <div className="flex items-center gap-3"><Button type="submit" busy={busy}>Extract jobs</Button><Msg m={msg} /></div>
      </form>
    </Card>
  );
}
