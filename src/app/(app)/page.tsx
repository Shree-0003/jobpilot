"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, fmtDay } from "@/lib/client";
import { Card, Empty, PageHeader, ScoreBadge, Stat, StatusBadge, Table, Td } from "@/components/ui";
import DiscoveryPanel from "@/components/DiscoveryPanel";

type Dash = {
  today: { discovered: number; matched: number; submitted: number; pending: number; manual: number; failed: number };
  stats: { totalApplications: number; week: number; month: number; avgMatch: number; successRate: number; interviewRate: number; responseRate: number };
  breakdown: { strong: number; review: number; low: number; total: number };
  recent: { _id: string; appId: string; jobTitle: string; company: string; portal: string; status: string; matchScore: number; createdAt: string }[];
};
type AR = { jobs: { _id: string; title: string; company: string; matchScore?: number; statusReason?: string }[]; applications: { _id: string; jobTitle: string; company: string; matchScore: number; actionReason?: string; status: string }[]; awaitingApproval: number };

export default function Dashboard() {
  const [d, setD] = useState<Dash | null>(null);
  const [ar, setAr] = useState<AR | null>(null);
  useEffect(() => {
    api<Dash>("/api/dashboard").then(setD);
    api<AR>("/api/action-required").then(setAr);
  }, []);
  if (!d) return <p className="text-sm text-slate-500">Loading…</p>;
  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle={`Found ${d.breakdown.total} relevant jobs: ${d.breakdown.strong} strongly matched · ${d.breakdown.review} need review · ${d.breakdown.low} low relevance`} />
      <DiscoveryPanel onFinished={() => { api<Dash>("/api/dashboard").then(setD); api<AR>("/api/action-required").then(setAr); }} />
      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Today</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Jobs discovered" value={d.today.discovered} />
          <Stat label="Jobs matched" value={d.today.matched} />
          <Stat label="Applications submitted" value={d.today.submitted} />
          <Stat label="Awaiting approval" value={d.today.pending} />
          <Stat label="Manual actions" value={d.today.manual} />
          <Stat label="Failed" value={d.today.failed} />
        </div>
      </div>
      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Statistics</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="Total applications" value={d.stats.totalApplications} />
          <Stat label="This week" value={d.stats.week} />
          <Stat label="This month" value={d.stats.month} />
          <Stat label="Avg match score" value={d.stats.avgMatch} />
          <Stat label="Success rate" value={`${d.stats.successRate}%`} hint="approved → submitted" />
          <Stat label="Interview rate" value={`${d.stats.interviewRate}%`} />
          <Stat label="Response rate" value={`${d.stats.responseRate}%`} />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Recent applications" actions={<Link className="text-sm text-brand-600 hover:underline" href="/applications">Open register</Link>}>
          {d.recent.length === 0 ? <Empty>No applications yet. Approve a job to start.</Empty> : (
            <Table head={["ID", "Role", "Score", "Status", "Date"]}>
              {d.recent.map((a) => (
                <tr key={a._id}>
                  <Td><Link className="font-mono text-xs text-brand-600 hover:underline" href={`/applications/${a._id}`}>{a.appId}</Link></Td>
                  <Td><div className="font-medium">{a.jobTitle}</div><div className="text-xs text-slate-500">{a.company}</div></Td>
                  <Td><ScoreBadge score={a.matchScore} /></Td>
                  <Td><StatusBadge status={a.status} /></Td>
                  <Td className="whitespace-nowrap text-xs text-slate-500">{fmtDay(a.createdAt)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title="Action required" actions={<Link className="text-sm text-brand-600 hover:underline" href="/action-required">View all</Link>}>
          {!ar ? null : ar.jobs.length + ar.applications.length === 0 ? <Empty>Nothing needs you right now.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {ar.applications.slice(0, 4).map((a) => (
                <li key={a._id} className="py-2">
                  <Link href={`/applications/${a._id}`} className="font-medium hover:underline">{a.jobTitle}</Link>
                  <span className="text-sm text-slate-500"> · {a.company}</span>
                  <div className="text-xs text-amber-700">{a.status === "Application Failed" ? "Application failed — retry" : a.actionReason}</div>
                </li>
              ))}
              {ar.jobs.slice(0, 4).map((j) => (
                <li key={j._id} className="py-2">
                  <Link href={`/jobs/${j._id}`} className="font-medium hover:underline">{j.title}</Link>
                  <span className="text-sm text-slate-500"> · {j.company}</span>
                  <div className="text-xs text-amber-700">{j.statusReason}</div>
                </li>
              ))}
            </ul>
          )}
          {ar && ar.awaitingApproval > 0 && <p className="mt-3 text-sm"><Link className="text-brand-600 hover:underline" href="/jobs?status=Awaiting%20Approval">{ar.awaitingApproval} job(s) awaiting your approval →</Link></p>}
        </Card>
      </div>
    </div>
  );
}
