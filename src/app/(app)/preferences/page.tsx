"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Alert, Badge, Button, Card, Field, Input, ListInput, Msg, PageHeader, Select, useMsg } from "@/components/ui";

type Prefs = {
  targetTitles: string[]; keywords: string[]; excludedKeywords: string[]; preferredIndustries: string[]; preferredCompanies: string[]; excludedCompanies: string[]; preferredLocations: string[];
  workModes: string[]; experienceMin: number; experienceMax: number; salaryMinLpa: number; salaryPreferredLpa: number; employmentTypes: string[];
  careerBoards: { vendor: "greenhouse" | "lever"; token: string }[]; excludePreviouslyRejected: boolean;
  limits: { maxPerDay: number; maxPerHour: number; maxPerCompanyPerDay: number; minMatchScore: number };
  autoApplyEnabled: boolean; automationState: string; notifications: { browser: boolean; highMatchThreshold: number };
};

const LISTS: [keyof Prefs, string, string][] = [
  ["targetTitles", "Target job titles", "Information Security Analyst, GRC Analyst, ISO 27001 Lead Auditor"],
  ["keywords", "Keywords", "ISO 27001, risk, audit"],
  ["excludedKeywords", "Excluded keywords", "sales, night shift"],
  ["preferredIndustries", "Preferred industries", "fintech, banking, SaaS"],
  ["preferredCompanies", "Preferred companies", ""],
  ["excludedCompanies", "Excluded companies", ""],
  ["preferredLocations", "Preferred locations", "Bengaluru, Pune"],
];

export default function Preferences() {
  const [p, setP] = useState<Prefs | null>(null);
  const [msg, setMsg] = useMsg();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState("");
  const [board, setBoard] = useState<{ vendor: "greenhouse" | "lever"; token: string }>({ vendor: "greenhouse", token: "" });
  useEffect(() => { api<Prefs>("/api/prefs").then(setP); }, []);
  if (!p) return <p className="text-sm text-slate-500">Loading…</p>;
  const cur: Prefs = p;
  const num = (k: "experienceMin" | "experienceMax" | "salaryMinLpa" | "salaryPreferredLpa") => (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: Number(e.target.value) });
  const lim = (k: keyof Prefs["limits"]) => (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, limits: { ...p.limits, [k]: Number(e.target.value) } });
  const toggle = (k: "workModes" | "employmentTypes", v: string) => setP({ ...p, [k]: p[k].includes(v) ? p[k].filter((x) => x !== v) : [...p[k], v] });

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy("save");
    try {
      const { autoApplyEnabled: _a, automationState: _s, ...body } = cur;
      void _a; void _s;
      await api("/api/prefs", { method: "PUT", body });
      setMsg({ tone: "green", text: "Preferences saved." });
    } catch (err) { setMsg({ tone: "red", text: (err as Error).message }); }
    finally { setBusy(""); }
  }
  async function autoApply(enabled: boolean) {
    setBusy("auto");
    try {
      await api("/api/auto-apply", { body: { enabled, password: pw || undefined } });
      setP({ ...cur, autoApplyEnabled: enabled }); setPw("");
      setMsg({ tone: "green", text: enabled ? "Auto Apply enabled. It only acts on connectors whose terms allow automated submission — none in this version, so you will still approve and submit." : "Auto Apply disabled. Every application needs your approval." });
    } catch (err) { setMsg({ tone: "red", text: (err as Error).message }); }
    finally { setBusy(""); }
  }
  async function notifPerm(v: boolean) {
    if (v && typeof Notification !== "undefined" && Notification.permission !== "granted") await Notification.requestPermission();
    setP({ ...cur, notifications: { ...cur.notifications, browser: v } });
  }

  return (
    <form onSubmit={save} className="space-y-6" aria-label="Preferences">
      <PageHeader title="Preferences & Limits" subtitle="The deterministic policy engine enforces these on every job." actions={<Button type="submit" busy={busy === "save"}>Save preferences</Button>} />
      <Msg m={msg} />
      <Card title="What you are looking for">
        <div className="grid gap-3 md:grid-cols-2">
          {LISTS.map(([k, label, ph]) => (
            <Field key={k} label={label} hint="Comma separated"><ListInput aria-label={label} value={p[k] as string[]} onChange={(v) => setP({ ...p, [k]: v })} placeholder={ph} /></Field>
          ))}
          <Field label="Work modes">
            <div className="flex gap-3 text-sm">{["remote", "hybrid", "onsite"].map((m) => <label key={m} className="flex items-center gap-1"><input type="checkbox" checked={p.workModes.includes(m)} onChange={() => toggle("workModes", m)} /> {m}</label>)}</div>
          </Field>
          <Field label="Employment types">
            <div className="flex flex-wrap gap-3 text-sm">{["full-time", "contract", "internship", "part-time"].map((m) => <label key={m} className="flex items-center gap-1"><input type="checkbox" checked={p.employmentTypes.includes(m)} onChange={() => toggle("employmentTypes", m)} /> {m}</label>)}</div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Min experience (yrs)"><Input type="number" min={0} max={50} value={p.experienceMin} onChange={num("experienceMin")} /></Field>
            <Field label="Max experience (yrs)"><Input type="number" min={0} max={50} value={p.experienceMax} onChange={num("experienceMax")} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Minimum salary (LPA)"><Input type="number" min={0} value={p.salaryMinLpa} onChange={num("salaryMinLpa")} /></Field>
            <Field label="Preferred salary (LPA)"><Input type="number" min={0} value={p.salaryPreferredLpa} onChange={num("salaryPreferredLpa")} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.excludePreviouslyRejected} onChange={(e) => setP({ ...p, excludePreviouslyRejected: e.target.checked })} /> Skip companies + titles that rejected me before</label>
        </div>
      </Card>

      <Card title="Daily application controls">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Max applications / day"><Input aria-label="Max per day" type="number" min={1} max={100} value={p.limits.maxPerDay} onChange={lim("maxPerDay")} /></Field>
          <Field label="Max applications / hour"><Input aria-label="Max per hour" type="number" min={1} max={30} value={p.limits.maxPerHour} onChange={lim("maxPerHour")} /></Field>
          <Field label="Max / company / day"><Input aria-label="Max per company" type="number" min={1} max={10} value={p.limits.maxPerCompanyPerDay} onChange={lim("maxPerCompanyPerDay")} /></Field>
          <Field label="Minimum match score"><Input aria-label="Minimum match score" type="number" min={0} max={100} value={p.limits.minMatchScore} onChange={lim("minMatchScore")} /></Field>
        </div>
      </Card>

      <Card title="Company career boards (public read-only feeds)">
        <p className="mb-3 text-sm text-slate-600">Add employers that publish jobs on Greenhouse or Lever. The board token is the company slug in their jobs URL (e.g. boards.greenhouse.io/<strong>gitlab</strong>).</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {p.careerBoards.map((b, i) => (
            <span key={i} className="inline-flex items-center gap-1"><Badge tone="blue">{b.vendor}:{b.token}</Badge><button type="button" aria-label={`Remove ${b.token}`} className="text-xs text-slate-400 hover:text-red-600" onClick={() => setP({ ...p, careerBoards: p.careerBoards.filter((_, j) => j !== i) })}>×</button></span>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Vendor"><Select value={board.vendor} onChange={(e) => setBoard({ ...board, vendor: e.target.value as "greenhouse" | "lever" })}><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option></Select></Field>
          <Field label="Board token"><Input aria-label="Board token" value={board.token} onChange={(e) => setBoard({ ...board, token: e.target.value.trim() })} placeholder="company-slug" /></Field>
          <Button type="button" variant="secondary" onClick={() => { if (board.token) { setP({ ...p, careerBoards: [...p.careerBoards, board] }); setBoard({ ...board, token: "" }); } }}>Add board</Button>
        </div>
      </Card>

      <Card title="Notifications">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.notifications.browser} onChange={(e) => notifPerm(e.target.checked)} /> Browser notifications</label>
          <Field label="High-match alert threshold"><Input type="number" min={0} max={100} value={p.notifications.highMatchThreshold} onChange={(e) => setP({ ...p, notifications: { ...p.notifications, highMatchThreshold: Number(e.target.value) } })} /></Field>
        </div>
        <p className="mt-2 text-xs text-slate-500">In-app alerts are always on. Email notifications arrive with the Gmail sender in a later release.</p>
      </Card>

      <Card title="Approval mode">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">Current mode: {p.autoApplyEnabled ? <Badge tone="violet">Auto Apply enabled</Badge> : <Badge tone="green">Human Approval Required</Badge>}</div>
          <Alert tone="blue">Auto Apply can only act through connectors whose terms permit automated submission. LinkedIn, Naukri and company career sites require you to submit yourself, so in this version every application still comes to you.</Alert>
          {!p.autoApplyEnabled ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Confirm with your password"><Input aria-label="Password to enable auto apply" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
              <Button type="button" variant="secondary" busy={busy === "auto"} onClick={() => autoApply(true)} disabled={!pw}>Enable Auto Apply</Button>
            </div>
          ) : (
            <Button type="button" variant="secondary" busy={busy === "auto"} onClick={() => autoApply(false)}>Return to approval mode</Button>
          )}
        </div>
      </Card>
    </form>
  );
}
