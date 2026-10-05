"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Badge, Button, Card, Empty, Msg, PageHeader, ScoreBadge, StatusBadge, useMsg } from "@/components/ui";

type AR = {
  jobs: { _id: string; title: string; company: string; portal: string; url?: string; matchScore?: number; statusReason?: string }[];
  applications: { _id: string; appId: string; jobTitle: string; company: string; portal: string; jobUrl?: string; matchScore: number; actionReason?: string; failureReason?: string; status: string; pendingAnswers: number; reviewRequired: number }[];
  awaitingApproval: number;
};

export default function ActionRequired() {
  const [d, setD] = useState<AR | null>(null);
  const [msg, setMsg] = useMsg();
  const load = useCallback(() => api<AR>("/api/action-required").then(setD), []);
  useEffect(() => { load(); }, [load]);

  async function act(fn: () => Promise<unknown>, text: string) {
    try { await fn(); setMsg({ tone: "green", text }); await load(); window.dispatchEvent(new Event("jp:refresh")); }
    catch (e) { setMsg({ tone: "red", text: (e as Error).message }); }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Action Required" subtitle="Applications waiting for you to submit, failed attempts, and jobs the system would not handle automatically." />
      <Msg m={msg} />
      {d && d.awaitingApproval > 0 && <p className="text-sm"><Link className="text-brand-600 hover:underline" href="/jobs?status=Awaiting%20Approval">{d.awaitingApproval} job(s) awaiting your approval →</Link></p>}
      <Card title="Ready for you to submit">
        {!d ? <p className="text-sm text-slate-500">Loading…</p> : d.applications.length === 0 ? <Empty>No applications waiting.</Empty> : (
          <ul className="space-y-3">
            {d.applications.map((a) => (
              <li key={a._id} className="rounded-lg border border-slate-200 p-4" data-testid="ar-app">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{a.jobTitle}</div>
                    <div className="text-sm text-slate-600">Company: {a.company} · Match: <ScoreBadge score={a.matchScore} /> · <Badge>{a.portal}</Badge></div>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
                <p className="mt-2 text-sm"><span className="font-medium">Reason:</span> {a.status === "Application Failed" ? a.failureReason : a.actionReason}</p>
                {a.reviewRequired > 0 && <p className="text-sm text-red-700">{a.reviewRequired} answer(s) need your review.</p>}
                {a.pendingAnswers > 0 && a.reviewRequired === 0 && <p className="text-sm text-amber-700">{a.pendingAnswers} answer(s) to approve.</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {a.jobUrl && <a className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-50" href={a.jobUrl} target="_blank" rel="noopener noreferrer nofollow">Open Job ↗</a>}
                  <Link className="inline-flex items-center rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700" href={`/applications/${a._id}`}>{a.pendingAnswers ? "Review Answers" : "Open Apply Pack"}</Link>
                  {a.status === "Manual Action Required" && a.pendingAnswers === 0 && <Button size="sm" variant="success" onClick={() => act(() => api(`/api/applications/${a._id}`, { method: "PATCH", body: { status: "Applied" } }), "Marked as applied.")}>Mark as Applied</Button>}
                  {a.status === "Application Failed" && <Button size="sm" variant="secondary" onClick={() => act(() => api(`/api/applications/${a._id}`, { method: "PATCH", body: { status: "Manual Action Required" } }), "Back in the queue.")}>Retry</Button>}
                  <Button size="sm" variant="ghost" onClick={() => act(() => api(`/api/applications/${a._id}`, { method: "PATCH", body: { status: a.status === "Application Failed" ? "Closed" : "Withdrawn" } }), "Dismissed.")}>Dismiss</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Jobs that need a manual decision">
        {!d ? null : d.jobs.length === 0 ? <Empty>None.</Empty> : (
          <ul className="space-y-3">
            {d.jobs.map((j) => (
              <li key={j._id} className="rounded-lg border border-slate-200 p-4" data-testid="ar-job">
                <div className="font-semibold">{j.title}</div>
                <div className="text-sm text-slate-600">Company: {j.company} · Match: <ScoreBadge score={j.matchScore} /></div>
                <p className="mt-2 text-sm"><span className="font-medium">Reason:</span> {j.statusReason}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {j.url && <a className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-50" href={j.url} target="_blank" rel="noopener noreferrer nofollow">Open Job ↗</a>}
                  <Link className="inline-flex items-center rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700" href={`/jobs/${j._id}`}>Review</Link>
                  <Button size="sm" variant="ghost" onClick={() => act(() => api(`/api/jobs/${j._id}/dismiss`, { method: "POST" }), "Dismissed.")}>Dismiss</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
