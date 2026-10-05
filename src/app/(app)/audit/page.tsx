"use client";
import { useCallback, useEffect, useState } from "react";
import { api, download, fmtDate } from "@/lib/client";
import { Alert, Badge, Button, Card, Msg, PageHeader, Table, Td, useMsg } from "@/components/ui";

type Row = { seq: number; ts: string; actor: string; action: string; entity?: string; entityId?: string; details: Record<string, unknown>; rowHash: string; prevHash: string };

export default function Audit() {
  const [d, setD] = useState<{ rows: Row[]; total: number; page: number } | null>(null);
  const [page, setPage] = useState(0);
  const [verify, setVerify] = useState<{ ok: boolean; checked: number; brokenAtSeq?: number } | null>(null);
  const [msg, setMsg] = useMsg();
  const load = useCallback((p: number) => api<{ rows: Row[]; total: number; page: number }>(`/api/audit?page=${p}`).then(setD), []);
  useEffect(() => { load(page); }, [load, page]);
  const exp = (format: "csv" | "xlsx") => download(`/api/export?type=audit&format=${format}`).catch((e) => setMsg({ tone: "red", text: e.message }));
  return (
    <div className="space-y-6">
      <PageHeader title="Audit Log" subtitle="Append-only and hash-chained: every row includes the hash of the one before, so any edit or deletion is detectable." actions={<>
        <Button variant="secondary" onClick={() => api<typeof verify>("/api/audit/verify").then(setVerify)}>Verify integrity</Button>
        <Button variant="secondary" onClick={() => exp("csv")}>Export CSV</Button>
        <Button variant="secondary" onClick={() => exp("xlsx")}>Export XLSX</Button>
      </>} />
      <Msg m={msg} />
      {verify && (verify.ok ? <Alert tone="green">Chain intact — {verify.checked} entries verified.</Alert> : <Alert tone="red">Chain broken at entry #{verify.brokenAtSeq}. The log was modified outside the application.</Alert>)}
      <Card title={`${d?.total ?? 0} entries`} actions={<>
        <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>← Newer</Button>
        <Button size="sm" variant="ghost" disabled={!d || (page + 1) * 50 >= d.total} onClick={() => setPage(page + 1)}>Older →</Button>
      </>}>
        {!d ? <p className="text-sm text-slate-500">Loading…</p> : (
          <Table head={["#", "Time", "Actor", "Action", "Entity", "Details", "Hash"]}>
            {d.rows.map((r) => (
              <tr key={r.seq}>
                <Td className="font-mono text-xs">{r.seq}</Td>
                <Td className="whitespace-nowrap text-xs">{fmtDate(r.ts)}</Td>
                <Td><Badge tone={r.actor === "ai" ? "violet" : r.actor === "system" ? "blue" : "slate"}>{r.actor}</Badge></Td>
                <Td className="text-sm font-medium">{r.action.replace(/_/g, " ")}</Td>
                <Td className="font-mono text-xs">{r.entity ? `${r.entity}:${(r.entityId ?? "").slice(0, 12)}` : "—"}</Td>
                <Td className="max-w-xs truncate font-mono text-xs text-slate-500" >{JSON.stringify(r.details)}</Td>
                <Td className="font-mono text-xs text-slate-400" >{r.rowHash.slice(0, 10)}…</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
