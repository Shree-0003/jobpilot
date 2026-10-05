"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { api, download, fmtDate } from "@/lib/client";
import { Alert, Badge, Button, Card, Field, Input, Msg, PageHeader, ScoreBadge, Select, StatusBadge, Textarea, useMsg } from "@/components/ui";

type Q = { id: string; question: string; answer: string; factIds: string[]; status: "drafted" | "human_review_required" | "approved"; reason?: string; sensitive: boolean };
type AppT = {
  _id: string; appId: string; jobId: string; jobTitle: string; company: string; portal: string; jobUrl?: string; matchScore: number; resumeId?: string; resumeLabel?: string;
  status: string; automationStatus: string; channel: string; actionReason?: string; failureReason?: string; questions: Q[]; coverLetter: string; coverLetterFlags?: string[];
  followUpDate?: string; hiringStatus?: string; notes: string; approvedAt: string; submittedAt?: string;
};
type Data = { application: AppT; job: { url?: string; location?: string } | null; evaluation: { policyRules: { rule: string; passed: boolean; detail: string }[]; strongMatches: { requirement: string }[]; matchScore: number } | null; history: { ts: string; actor: string; action: string; details: Record<string, unknown> }[] };

const NEXT: Record<string, string[]> = {
  "Manual Action Required": ["Applied", "Application Failed", "Withdrawn"],
  "Application Failed": ["Manual Action Required", "Withdrawn", "Closed"],
  Applied: ["Interview", "Rejected", "Offer", "Withdrawn", "Closed"],
  Interview: ["Interview", "Offer", "Rejected", "Withdrawn", "Closed"],
  Offer: ["Closed", "Withdrawn"],
  Rejected: ["Closed"],
  Withdrawn: ["Closed"],
};

export default function ApplicationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<Data | null>(null);
  const [msg, setMsg] = useMsg();
  const [busy, setBusy] = useState("");
  const [questions, setQuestions] = useState("");
  const [tone, setTone] = useState("professional");
  const [letter, setLetter] = useState("");
  const [notes, setNotes] = useState("");
  const [follow, setFollow] = useState("");
  const [hiring, setHiring] = useState("");
  const [failReason, setFailReason] = useState("");

  const load = useCallback(async () => {
    const r = await api<Data>(`/api/applications/${id}`);
    setD(r);
    setLetter(r.application.coverLetter);
    setNotes(r.application.notes);
    setFollow(r.application.followUpDate ?? "");
    setHiring(r.application.hiringStatus ?? "");
  }, [id]);
  useEffect(() => { load().catch((e) => setMsg({ tone: "red", text: e.message })); }, [load, setMsg]);

  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      await load();
      if (ok) setMsg({ tone: "green", text: ok });
      window.dispatchEvent(new Event("jp:refresh"));
    } catch (e) {
      setMsg({ tone: "red", text: (e as Error).message });
    } finally {
      setBusy("");
    }
  }

  if (!d) return <div className="space-y-3"><Msg m={msg} /><p className="text-sm text-slate-500">Loading…</p></div>;
  const a = d.application;
  const pending = a.questions.filter((q) => q.status !== "approved").length;
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => setMsg({ tone: "green", text: "Copied." }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${a.appId} · ${a.jobTitle}`}
        subtitle={<>{a.company} · <Badge>{a.portal}</Badge> · <ScoreBadge score={a.matchScore} /> · approved {fmtDate(a.approvedAt)}</>}
        actions={<><StatusBadge status={a.status} /><Link href={`/jobs/${a.jobId}`} className="text-sm text-brand-600 hover:underline">View job analysis</Link></>}
      />
      <Msg m={msg} />

      {a.status === "Manual Action Required" && (
        <Card title="Apply Pack — submit this application yourself">
          <Alert tone="amber">{a.actionReason}</Alert>
          <ol className="mt-4 space-y-3 text-sm">
            <li className="flex flex-wrap items-center gap-2"><span className="font-semibold">1.</span> Open the job:
              {a.jobUrl ? <a className="font-medium text-brand-600 hover:underline" href={a.jobUrl} target="_blank" rel="noopener noreferrer nofollow">{a.jobUrl.slice(0, 70)}{a.jobUrl.length > 70 ? "…" : ""} ↗</a> : <span className="text-slate-500">no URL saved</span>}
            </li>
            <li className="flex flex-wrap items-center gap-2"><span className="font-semibold">2.</span> Attach resume:
              {a.resumeId ? <Button size="sm" variant="secondary" onClick={() => download(`/api/resumes/${a.resumeId}/download`).catch((e) => setMsg({ tone: "red", text: e.message }))}>Download “{a.resumeLabel}”</Button> : <span className="text-slate-500">none selected</span>}
            </li>
            <li><span className="font-semibold">3.</span> Paste the cover letter and the approved answers below ({pending ? `${pending} still to approve` : "all approved"}).</li>
            <li><span className="font-semibold">4.</span> Submit on the portal, then click <em>Mark as applied</em>. If the portal blocks you (CAPTCHA, OTP, external site), mark it failed with the reason.</li>
          </ol>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <Button variant="success" busy={busy === "applied"} onClick={() => run("applied", () => api(`/api/applications/${id}`, { method: "PATCH", body: { status: "Applied" } }), "Marked as applied.")}>Mark as applied</Button>
            <Input aria-label="Failure reason" placeholder="Reason (e.g. CAPTCHA, external portal)" value={failReason} onChange={(e) => setFailReason(e.target.value)} className="w-72" />
            <Button variant="secondary" busy={busy === "failed"} onClick={() => run("failed", () => api(`/api/applications/${id}`, { method: "PATCH", body: { status: "Application Failed", failureReason: failReason } }), "Marked as failed.")}>Mark as failed</Button>
          </div>
        </Card>
      )}
      {a.status === "Application Failed" && <Alert tone="red">Application failed: {a.failureReason}. You can retry by moving it back to Manual Action Required.</Alert>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Application questions" actions={<Badge tone={pending ? "amber" : "green"}>{pending ? `${pending} pending` : "All approved"}</Badge>}>
          <form
            className="space-y-2"
            onSubmit={(e) => { e.preventDefault(); const list = questions.split("\n").map((s) => s.trim()).filter(Boolean); if (list.length) run("q", () => api(`/api/applications/${id}/questions`, { body: { questions: list } }).then(() => setQuestions("")), "Answers drafted from your verified facts."); }}
          >
            <Field label="Paste the portal's questions, one per line" hint="Answers use only your verified facts. Salary, notice period, relocation, visa and personal questions always come back to you.">
              <Textarea name="questions" rows={4} value={questions} onChange={(e) => setQuestions(e.target.value)} placeholder={"Do you have 5+ years of experience?\nAre you ISO 27001 Lead Auditor certified?\nWhat is your expected CTC?"} />
            </Field>
            <Button type="submit" size="sm" busy={busy === "q"}>Draft answers</Button>
          </form>
          <ul className="mt-4 space-y-3" data-testid="questions">
            {a.questions.map((q) => <QuestionItem key={q.id} q={q} appId={id} onSaved={load} onCopy={copy} setMsg={setMsg} />)}
          </ul>
        </Card>

        <Card title="Cover letter" actions={<>
          <Select aria-label="Tone" value={tone} onChange={(e) => setTone(e.target.value)} className="w-36">
            <option value="formal">Formal</option><option value="professional">Professional</option><option value="short">Short</option><option value="technical">Technical</option>
          </Select>
          <Button size="sm" busy={busy === "cl"} onClick={() => run("cl", () => api(`/api/applications/${id}/cover-letter`, { body: { tone } }), "Cover letter generated from verified facts.")}>Generate</Button>
        </>}>
          {a.coverLetterFlags && a.coverLetterFlags.length > 0 && (
            <div className="mb-3"><Alert tone="amber"><div className="font-medium">Check before using:</div><ul className="list-disc pl-5">{a.coverLetterFlags.map((f, i) => <li key={i}>{f}</li>)}</ul></Alert></div>
          )}
          <Textarea aria-label="Cover letter" rows={14} value={letter} onChange={(e) => setLetter(e.target.value)} placeholder="Generate a draft or write your own." />
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="secondary" busy={busy === "cls"} onClick={() => run("cls", () => api(`/api/applications/${id}/cover-letter`, { method: "PUT", body: { text: letter } }), "Saved.")}>Save edits</Button>
            <Button size="sm" variant="ghost" onClick={() => copy(letter)}>Copy</Button>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Tracking">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {(NEXT[a.status] ?? []).filter((s) => !(a.status === "Manual Action Required" && (s === "Applied" || s === "Application Failed"))).map((s) => (
                <Button key={s} size="sm" variant="secondary" busy={busy === s} onClick={() => run(s, () => api(`/api/applications/${id}`, { method: "PATCH", body: { status: s } }), `Moved to ${s}.`)}>→ {s}</Button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Follow-up date"><Input type="date" value={follow} onChange={(e) => setFollow(e.target.value)} /></Field>
              <Field label="Current hiring status"><Input value={hiring} onChange={(e) => setHiring(e.target.value)} placeholder="e.g. HR screen scheduled" /></Field>
            </div>
            <Field label="Notes (encrypted)"><Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <Button size="sm" busy={busy === "track"} onClick={() => run("track", () => api(`/api/applications/${id}`, { method: "PATCH", body: { notes, followUpDate: follow, hiringStatus: hiring } }), "Saved.")}>Save tracking</Button>
          </div>
        </Card>
        <Card title="History (audit trail)">
          <ol className="space-y-2 text-sm" data-testid="history">
            {d.history.map((h, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-36 shrink-0 text-xs text-slate-500">{fmtDate(h.ts)}</span>
                <span><span className="font-medium">{h.action.replace(/_/g, " ")}</span> <span className="text-xs text-slate-500">by {h.actor}{h.details && Object.keys(h.details).length ? ` · ${Object.entries(h.details).filter(([, v]) => v !== null && v !== undefined && typeof v !== "object").slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(", ")}` : ""}</span></span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

function QuestionItem({ q, appId, onSaved, onCopy, setMsg }: { q: Q; appId: string; onSaved: () => Promise<void>; onCopy: (t: string) => void; setMsg: (m: { tone: "red" | "green"; text: string } | null) => void }) {
  const [ans, setAns] = useState(q.answer);
  const [busy, setBusy] = useState(false);
  async function save(approve: boolean) {
    setBusy(true);
    try {
      await api(`/api/applications/${appId}/questions/${q.id}`, { method: "PATCH", body: { answer: ans, approve } });
      await onSaved();
    } catch (e) {
      setMsg({ tone: "red", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  const tone = q.status === "approved" ? "green" : q.status === "human_review_required" ? "red" : "blue";
  return (
    <li className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">{q.question}</p>
        <Badge tone={tone}>{q.status === "human_review_required" ? "HUMAN REVIEW REQUIRED" : q.status}</Badge>
      </div>
      {q.reason && <p className="mt-1 text-xs text-slate-500">{q.reason}</p>}
      <Textarea aria-label={`Answer to: ${q.question}`} rows={2} className="mt-2" value={ans} onChange={(e) => setAns(e.target.value)} placeholder="Your answer" />
      <div className="mt-2 flex items-center gap-2">
        {q.status !== "approved" && <Button size="sm" variant="success" busy={busy} onClick={() => save(true)}>Approve</Button>}
        <Button size="sm" variant="secondary" busy={busy} onClick={() => save(false)}>Save</Button>
        <Button size="sm" variant="ghost" onClick={() => onCopy(ans)}>Copy</Button>
        {q.factIds.length > 0 && <span className="font-mono text-xs text-slate-400">facts: {q.factIds.join(", ")}</span>}
      </div>
    </li>
  );
}
