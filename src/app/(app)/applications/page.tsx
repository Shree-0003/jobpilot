"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, download, fmtDay } from "@/lib/client";
import { Badge, Button, Card, Empty, Input, Msg, PageHeader, ScoreBadge, Select, StatusBadge, Table, Td, useMsg } from "@/components/ui";

type App = { _id: string; appId: string; jobTitle: string; company: string; portal: string; jobUrl?: string; matchScore: number; resumeLabel?: string; approvedAt: string; submittedAt?: string; status: string; automationStatus: string; failureReason?: string; followUpDate?: string; hiringStatus?: string };

export default function Register() {
  const [apps, setApps] = useState<App[] | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [msg, setMsg] = useMsg();
  useEffect(() => { api<{ applications: App[] }>("/api/applications").then((r) => setApps(r.applications)); }, []);
  const rows = useMemo(() => (apps ?? []).filter((a) => (!status || a.status === status) && (!q || `${a.appId} ${a.jobTitle} ${a.company}`.toLowerCase().includes(q.toLowerCase()))), [apps, q, status]);
  const exp = (format: "csv" | "xlsx") => download(`/api/export?type=applications&format=${format}`).catch((e) => setMsg({ tone: "red", text: e.message }));
  return (
    <div className="space-y-6">
      <PageHeader title="Application Register" subtitle="Every approved application, its status and what was submitted." actions={<>
        <Button variant="secondary" onClick={() => exp("csv")}>Export CSV</Button>
        <Button variant="secondary" onClick={() => exp("xlsx")}>Export XLSX</Button>
      </>} />
      <Msg m={msg} />
      <Card title={`${rows.length} application(s)`} actions={<>
        <Input aria-label="Search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="w-48" />
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-52">
          <option value="">All statuses</option>
          {["Manual Action Required", "Applied", "Application Failed", "Interview", "Offer", "Rejected", "Withdrawn", "Closed"].map((s) => <option key={s}>{s}</option>)}
        </Select>
      </>}>
        {!apps ? <p className="text-sm text-slate-500">Loading…</p> : rows.length === 0 ? <Empty>No applications match.</Empty> : (
          <Table head={["Application ID", "Job title / company", "Portal", "Score", "Resume", "Date", "Status", "Automation", "Follow-up", "Hiring status"]}>
            {rows.map((a) => (
              <tr key={a._id}>
                <Td><Link className="font-mono text-xs text-brand-600 hover:underline" href={`/applications/${a._id}`}>{a.appId}</Link></Td>
                <Td><div className="font-medium">{a.jobTitle}</div><div className="text-xs text-slate-500">{a.company}</div>{a.failureReason && <div className="text-xs text-red-600">{a.failureReason}</div>}</Td>
                <Td><Badge>{a.portal}</Badge></Td>
                <Td><ScoreBadge score={a.matchScore} /></Td>
                <Td className="text-xs">{a.resumeLabel ?? "—"}</Td>
                <Td className="whitespace-nowrap text-xs">{fmtDay(a.submittedAt ?? a.approvedAt)}</Td>
                <Td><StatusBadge status={a.status} /></Td>
                <Td className="text-xs">{a.automationStatus}</Td>
                <Td className="text-xs">{a.followUpDate ? fmtDay(a.followUpDate) : "—"}</Td>
                <Td className="text-xs">{a.hiringStatus || "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
