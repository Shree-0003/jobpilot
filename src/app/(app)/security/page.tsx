"use client";
import { useEffect, useState } from "react";
import { api, fmtDate } from "@/lib/client";
import { Badge, Button, Card, Empty, PageHeader, Table, Td } from "@/components/ui";

type D = {
  events: { ts: string; type: string; severity: string; ip?: string; details: Record<string, unknown> }[];
  sessions: { _id: string; ip: string; userAgent: string; createdAt: string; lastSeenAt: string; mfaVerified: boolean }[];
  ai: { ts: string; provider: string; model: string; requestType: string; tokensIn?: number; tokensOut?: number; latencyMs: number; schemaValid: boolean; guardrailResult: string; error?: string }[];
};
const SEV: Record<string, "slate" | "blue" | "amber" | "red"> = { info: "slate", low: "blue", medium: "amber", high: "red" };

export default function Security() {
  const [d, setD] = useState<D | null>(null);
  useEffect(() => { api<D>("/api/security/events").then(setD); }, []);
  async function revokeAll() {
    if (!confirm("Sign out every session, including this one?")) return;
    await api("/api/auth/logout-all", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <div className="space-y-6">
      <PageHeader title="Security" subtitle="Security events, active sessions and AI Gateway activity (metadata only — prompts are never stored)." actions={<Button variant="danger" onClick={revokeAll}>Sign out all sessions</Button>} />
      <Card title="Security events">
        {!d ? <p className="text-sm text-slate-500">Loading…</p> : d.events.length === 0 ? <Empty>No events.</Empty> : (
          <Table head={["Time", "Severity", "Event", "IP", "Details"]}>
            {d.events.map((e, i) => (
              <tr key={i}>
                <Td className="whitespace-nowrap text-xs">{fmtDate(e.ts)}</Td>
                <Td><Badge tone={SEV[e.severity]}>{e.severity}</Badge></Td>
                <Td className="font-medium">{e.type.replace(/_/g, " ")}</Td>
                <Td className="font-mono text-xs">{e.ip ?? "—"}</Td>
                <Td className="max-w-sm truncate font-mono text-xs text-slate-500">{JSON.stringify(e.details)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Active sessions">
          {d && (
            <ul className="space-y-2 text-sm">
              {d.sessions.map((s) => (
                <li key={s._id} className="rounded-lg border border-slate-200 p-2">
                  <div className="font-mono text-xs">{s.ip}</div>
                  <div className="truncate text-xs text-slate-500">{s.userAgent}</div>
                  <div className="text-xs text-slate-500">Started {fmtDate(s.createdAt)} · last active {fmtDate(s.lastSeenAt)} · {s.mfaVerified ? "MFA verified" : "MFA pending"}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="AI Gateway log">
          {!d ? null : d.ai.length === 0 ? <Empty>No AI calls yet.</Empty> : (
            <Table head={["Time", "Task", "Model", "Tokens", "ms", "Result"]}>
              {d.ai.map((a, i) => (
                <tr key={i}>
                  <Td className="whitespace-nowrap text-xs">{fmtDate(a.ts)}</Td>
                  <Td className="text-xs">{a.requestType}</Td>
                  <Td className="text-xs">{a.model}</Td>
                  <Td className="text-xs tabular-nums">{a.tokensIn ?? "—"}/{a.tokensOut ?? "—"}</Td>
                  <Td className="text-xs tabular-nums">{a.latencyMs}</Td>
                  <Td><Badge tone={a.guardrailResult === "pass" ? "green" : a.guardrailResult === "unavailable" ? "slate" : "amber"} title={a.error}>{a.guardrailResult}</Badge></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
