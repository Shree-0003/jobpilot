"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { api, ApiFailure, fmtDate } from "@/lib/client";
import { Alert, Badge, Button, Card, Field, Msg, PageHeader, ScoreBadge, Select, StatusBadge, Textarea, useMsg } from "@/components/ui";

type Ev = {
  matchScore: number; baselineScore: number; llmScore?: number; aiAvailable: boolean; model: string;
  subScores: Record<string, number>;
  strongMatches: { requirement: string; factIds: string[] }[];
  notFoundInProfile: string[];
  userLacks: { requirement: string; factIds: string[] }[];
  riskFlags: string[];
  llmRecommendation?: string; llmReason?: string;
  policyDecision: string;
  policyRules: { rule: string; passed: boolean; detail: string; outcome?: string }[];
  guardrailNotes: string[];
  recommendedResumeId?: string;
  createdAt: string;
};
type Data = {
  job: { _id: string; title: string; company: string; location: string; portal: string; url?: string; status: string; descriptionSanitized: string; workMode?: string; employmentType?: string; experienceText?: string; salaryText?: string; injectionFlag: boolean; injectionSignals: string[]; discoveredAt: string; source: string };
  evaluation: Ev | null;
  application: { _id: string; appId: string; status: string } | null;
  resumes: { _id: string; label: string }[];
  connector?: { name: string; note: string; apply: string };
};

const DECISION_LABEL: Record<string, string> = {
  AUTO_APPLY: "Eligible for auto apply",
  USER_APPROVAL: "Your approval required",
  MANUAL: "Manual action required",
  LOW_RELEVANCE: "Low relevance",
  SKIP: "Skipped",
};

export default function JobDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<Data | null>(null);
  const [desc, setDesc] = useState("");
  const [resumeId, setResumeId] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useMsg();

  const load = useCallback(async () => {
    const r = await api<Data>(`/api/jobs/${id}`);
    setD(r);
    setDesc(r.job.descriptionSanitized);
    setResumeId(r.evaluation?.recommendedResumeId ?? r.resumes[0]?._id ?? "");
  }, [id]);
  useEffect(() => { load().catch((e) => setMsg({ tone: "red", text: (e as Error).message })); }, [load, setMsg]);

  async function act(kind: "approve" | "dismiss" | "evaluate" | "describe") {
    setBusy(kind);
    setMsg(null);
    try {
      if (kind === "approve") {
        const r = await api<{ applicationId: string; appId: string }>(`/api/jobs/${id}/approve`, { body: { resumeId: resumeId || undefined, acknowledgeRisk: ack || undefined } });
        window.location.href = `/applications/${r.applicationId}`;
        return;
      }
      if (kind === "dismiss") await api(`/api/jobs/${id}/dismiss`, { method: "POST" });
      if (kind === "evaluate") await api(`/api/jobs/${id}/evaluate`, { method: "POST" });
      if (kind === "describe") await api(`/api/jobs/${id}`, { method: "PATCH", body: { description: desc } });
      await load();
      setMsg({ tone: "green", text: kind === "dismiss" ? "Dismissed." : "Re-scored." });
      window.dispatchEvent(new Event("jp:refresh"));
    } catch (e) {
      setMsg({ tone: e instanceof ApiFailure && e.data.needsAcknowledgement ? "amber" : "red", text: (e as Error).message });
    } finally {
      setBusy("");
    }
  }

  if (!d) return <div className="space-y-3"><Msg m={msg} /><p className="text-sm text-slate-500">Loading…</p></div>;
  const { job, evaluation: ev } = d;
  const risky = ev?.riskFlags.some((f) => /PROMPT_INJECTION|SUSPICIOUS/.test(f));
  const canApprove = ["Awaiting Approval", "Shortlisted", "Manual Action Required", "Low Relevance"].includes(job.status);

  return (
    <div className="space-y-6">
      <PageHeader
        title={job.title}
        subtitle={<>{job.company}{job.location ? ` · ${job.location}` : ""} · <Badge>{job.portal}</Badge> · discovered {fmtDate(job.discoveredAt)}</>}
        actions={<>
          {job.url && <a className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium hover:bg-slate-50" href={job.url} target="_blank" rel="noopener noreferrer nofollow">Open job ↗</a>}
          <Button variant="secondary" busy={busy === "evaluate"} onClick={() => act("evaluate")}>Re-score</Button>
          {job.status !== "Approved" && job.status !== "Dismissed" && <Button variant="ghost" busy={busy === "dismiss"} onClick={() => act("dismiss")}>Dismiss</Button>}
        </>}
      />
      <Msg m={msg} />
      {job.injectionFlag && (
        <Alert tone="red">This job text contains instructions aimed at an AI ({job.injectionSignals.join(", ")}). It was treated as data, kept away from the model, and routed to manual review.</Alert>
      )}
      {d.application && (
        <Alert tone="green">In your register as <Link className="font-semibold underline" href={`/applications/${d.application._id}`}>{d.application.appId}</Link> — {d.application.status}.</Alert>
      )}

      {ev && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Match score" className="lg:col-span-1">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-semibold tabular-nums" data-testid="match-score">{ev.matchScore}</span>
              <span className="text-slate-500">/100</span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Rules {ev.baselineScore}{ev.llmScore !== undefined ? ` · AI ${ev.llmScore} (${ev.model})` : " · AI not used"}
            </div>
            <div className="mt-4 space-y-2">
              {Object.entries(ev.subScores).map(([k, v]) => (
                <div key={k}>
                  <div className="flex justify-between text-xs"><span className="capitalize text-slate-600">{k} match</span><span className="tabular-nums">{v}%</span></div>
                  <div className="h-1.5 rounded-full bg-slate-100"><div className={`h-1.5 rounded-full ${v >= 80 ? "bg-emerald-500" : v >= 60 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${v}%` }} /></div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <StatusBadge status={job.status} />
              <span className="text-xs text-slate-500">{DECISION_LABEL[ev.policyDecision]}</span>
            </div>
          </Card>

          <Card title="Why" className="lg:col-span-2">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">Strong matches</h3>
                {ev.strongMatches.length === 0 ? <p className="text-sm text-slate-500">None found.</p> : (
                  <ul className="space-y-1 text-sm">{ev.strongMatches.map((m, i) => <li key={i}>✓ {m.requirement} <span className="font-mono text-xs text-slate-400">{m.factIds.join(", ")}</span></li>)}</ul>
                )}
              </div>
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">Information not found in profile</h3>
                <p className="mb-1 text-xs text-slate-500">Not the same as lacking it. Add a fact if you have it.</p>
                {ev.notFoundInProfile.length === 0 ? <p className="text-sm text-slate-500">Nothing missing.</p> : (
                  <ul className="space-y-1 text-sm">{ev.notFoundInProfile.map((n, i) => <li key={i}>? {n}</li>)}</ul>
                )}
              </div>
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-700">You do not meet (per your facts)</h3>
                {ev.userLacks.length === 0 ? <p className="text-sm text-slate-500">No contradictions.</p> : (
                  <ul className="space-y-1 text-sm">{ev.userLacks.map((m, i) => <li key={i}>✗ {m.requirement} <span className="font-mono text-xs text-slate-400">{m.factIds.join(", ")}</span></li>)}</ul>
                )}
              </div>
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700">Risk flags</h3>
                {ev.riskFlags.length === 0 ? <p className="text-sm text-slate-500">None.</p> : (
                  <div className="flex flex-wrap gap-1">{ev.riskFlags.map((f) => <Badge key={f} tone={/INJECTION|SUSPICIOUS/.test(f) ? "red" : "amber"}>{f.replace(/_/g, " ").toLowerCase()}</Badge>)}</div>
                )}
              </div>
            </div>
            {ev.llmReason && <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"><span className="font-medium">AI note (advisory):</span> {ev.llmReason}</p>}
            {ev.guardrailNotes.length > 0 && (
              <ul className="mt-3 space-y-0.5 text-xs text-slate-500">{ev.guardrailNotes.map((n, i) => <li key={i}>Guardrail: {n}</li>)}</ul>
            )}
          </Card>
        </div>
      )}

      {ev && (
        <Card title="Policy engine decision (deterministic)">
          <ul className="divide-y divide-slate-100 text-sm" data-testid="policy-rules">
            {ev.policyRules.map((r, i) => (
              <li key={i} className="flex flex-wrap items-start justify-between gap-2 py-1.5">
                <span><span className={r.passed ? "text-emerald-600" : "text-amber-600"}>{r.passed ? "✓" : "•"}</span> {r.rule}</span>
                <span className="text-xs text-slate-500">{r.detail}{r.outcome ? ` → ${DECISION_LABEL[r.outcome]}` : ""}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canApprove && ev && (
        <Card title="Approve this application">
          <div className="space-y-3">
            {d.connector && <p className="text-sm text-slate-600">After approval you get an Apply Pack. <strong>{d.connector.name}</strong>: {d.connector.note}</p>}
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Resume to use" hint={ev.recommendedResumeId ? "Pre-selected by keyword match against the job." : "No approved resume yet — approve one on the Resumes page."}>
                <Select name="resume" value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
                  <option value="">No resume</option>
                  {d.resumes.map((r) => <option key={r._id} value={r._id}>{r.label}{r._id === ev.recommendedResumeId ? " (recommended)" : ""}</option>)}
                </Select>
              </Field>
            </div>
            {risky && (
              <label className="flex items-start gap-2 text-sm text-red-800">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
                I have checked this posting myself and want to continue despite the security/scam flags.
              </label>
            )}
            <div className="flex gap-2">
              <Button variant="success" busy={busy === "approve"} onClick={() => act("approve")}>Approve & prepare Apply Pack</Button>
            </div>
          </div>
        </Card>
      )}

      <Card title="Job description (sanitised)" actions={job.status !== "Approved" ? <Button size="sm" variant="secondary" busy={busy === "describe"} onClick={() => act("describe")}>Save & re-score</Button> : undefined}>
        {job.status !== "Approved" ? (
          <Textarea aria-label="Job description" rows={12} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Paste the full job description here to complete scoring." />
        ) : (
          <pre className="whitespace-pre-wrap text-sm text-slate-700">{job.descriptionSanitized}</pre>
        )}
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500 md:grid-cols-4">
          <div><dt className="font-medium">Work mode</dt><dd>{job.workMode ?? "—"}</dd></div>
          <div><dt className="font-medium">Employment</dt><dd>{job.employmentType ?? "—"}</dd></div>
          <div><dt className="font-medium">Experience</dt><dd>{job.experienceText ?? "—"}</dd></div>
          <div><dt className="font-medium">Salary</dt><dd>{job.salaryText ?? "—"}</dd></div>
        </dl>
      </Card>
      {ev && <p className="text-xs text-slate-400">Scored {fmtDate(ev.createdAt)} · <ScoreBadge score={ev.matchScore} /></p>}
    </div>
  );
}
