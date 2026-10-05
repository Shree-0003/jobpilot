"use client";
import { useEffect, useState } from "react";
import { api, download } from "@/lib/client";
import { Alert, Badge, Button, Card, Field, Input, Msg, PageHeader, Select, Table, Td, useMsg } from "@/components/ui";

type Status = {
  sources: { gmailImap: boolean; adzuna: boolean; gmailMcp: boolean; careerBoards: boolean };
  schedule: { everyHours: number; maxNewPerRun: number };
  llm: { provider: string; model: string; ok: boolean; detail: string };
  gmailMcp: { configured: boolean };
  connectors: { portal: string; name: string; discovery: string; apply: string; autoSubmitAllowed: boolean; reviewedAt: string; reviewExpires: string; evidence: string; note: string }[];
};

export default function Settings() {
  const [s, setS] = useState<Status | null>(null);
  const [msg, setMsg] = useMsg();
  const [pwExport, setPwExport] = useState("");
  const [pwDel, setPwDel] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [scope, setScope] = useState("history");
  const [busy, setBusy] = useState("");
  useEffect(() => { api<Status>("/api/discovery/status").then(setS); }, []);

  async function exportData() {
    setBusy("export");
    try { await download("/api/account/export", { password: pwExport }); setPwExport(""); setMsg({ tone: "green", text: "Your data was downloaded." }); }
    catch (e) { setMsg({ tone: "red", text: (e as Error).message }); }
    finally { setBusy(""); }
  }
  async function del() {
    setBusy("delete");
    try {
      await api("/api/account/delete", { body: { password: pwDel, confirm: confirmText, scope } });
      if (scope === "everything") { window.location.href = "/register"; return; }
      setMsg({ tone: "green", text: scope === "history" ? "All application history deleted." : "All resumes deleted." });
      setPwDel(""); setConfirmText("");
    } catch (e) { setMsg({ tone: "red", text: (e as Error).message }); }
    finally { setBusy(""); }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Data & Integrations" subtitle="Connections, portal terms, export and deletion." />
      <Msg m={msg} />
      <Card title="Automatic job sources">
        {s && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge tone={s.sources.gmailImap ? "green" : "slate"}>Gmail alerts {s.sources.gmailImap ? "on" : "off"}</Badge>
              <Badge tone={s.sources.adzuna ? "green" : "slate"}>Adzuna India {s.sources.adzuna ? "on" : "off"}</Badge>
              <Badge tone={s.sources.careerBoards ? "green" : "slate"}>Career boards {s.sources.careerBoards ? "on" : "off"}</Badge>
              <Badge>Every {s.schedule.everyHours} h · max {s.schedule.maxNewPerRun} new per run</Badge>
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-slate-700">
              <li><strong>LinkedIn and Naukri:</strong> create daily job alerts there (e.g. "GRC Analyst", "Information Security Analyst", Bengaluru) so alert emails reach your Gmail.</li>
              <li><strong>Gmail:</strong> create an app password at myaccount.google.com/apppasswords (2-Step Verification must be on).</li>
              <li><strong>Adzuna:</strong> register free at developer.adzuna.com and copy your App ID and App Key.</li>
              <li>On your laptop run <code className="rounded bg-slate-100 px-1">powershell -ExecutionPolicy Bypass -File .\set-job-sources.ps1</code> and paste them.</li>
            </ol>
            <p className="text-xs text-slate-500">Gmail is opened read-only and only LinkedIn/Naukri alert emails are read. LinkedIn and Naukri themselves are never contacted.</p>
          </div>
        )}
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Local AI (Ollama)">
          {s && <div className="space-y-1 text-sm">
            <div>Status: {s.llm.ok ? <Badge tone="green">Ready</Badge> : <Badge tone="amber">Unavailable</Badge>} <span className="text-slate-500">{s.llm.detail}</span></div>
            <div>Model: <code>{s.llm.model}</code></div>
            <p className="text-xs text-slate-500">Runs on your machine. When it is unavailable JobPilot still works: scores fall back to the deterministic rules and answers go to you for review.</p>
          </div>}
        </Card>
        <Card title="Gmail job alerts (via MCP)">
          {s && <div className="space-y-1 text-sm">
            <div>Status: {s.gmailMcp.configured ? <Badge tone="green">Configured</Badge> : <Badge>Not configured</Badge>}</div>
            <p className="text-xs text-slate-500">Uses an open-source Gmail MCP server you run locally. JobPilot calls only its read/search tools and refuses send, modify or delete tools. Configure MCP_GMAIL_* in .env (see README).</p>
          </div>}
        </Card>
      </div>
      <Card title="Portal connectors and terms of service">
        {s && (
          <Table head={["Portal", "Discovery", "Apply", "Auto submit", "Reviewed", "Note"]}>
            {s.connectors.map((c) => (
              <tr key={c.portal}>
                <Td className="font-medium">{c.evidence ? <a className="text-brand-600 hover:underline" href={c.evidence} target="_blank" rel="noopener noreferrer">{c.name}</a> : c.name}</Td>
                <Td className="text-xs">{c.discovery}</Td>
                <Td className="text-xs">{c.apply === "human_submit" ? "You submit" : "Email (post-MVP)"}</Td>
                <Td>{c.autoSubmitAllowed ? <Badge tone="green">Allowed</Badge> : <Badge tone="red">Not allowed</Badge>}</Td>
                <Td className="whitespace-nowrap text-xs">{c.reviewedAt} → {c.reviewExpires}</Td>
                <Td className="text-xs text-slate-600">{c.note}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Export my data">
          <p className="mb-3 text-sm text-slate-600">Downloads everything JobPilot stores about you as JSON (decrypted).</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Password"><Input aria-label="Password for export" type="password" value={pwExport} onChange={(e) => setPwExport(e.target.value)} /></Field>
            <Button variant="secondary" busy={busy === "export"} disabled={!pwExport} onClick={exportData}>Export</Button>
          </div>
        </Card>
        <Card title="Delete my data">
          <Alert tone="red">Deletion is permanent. “Everything” also deletes your account and destroys your encryption key.</Alert>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="What to delete"><Select aria-label="Delete scope" value={scope} onChange={(e) => setScope(e.target.value)}><option value="history">All application history</option><option value="resumes">All uploaded resumes</option><option value="everything">Everything (account, facts, resumes, history)</option></Select></Field>
            <Field label="Password"><Input aria-label="Password for delete" type="password" value={pwDel} onChange={(e) => setPwDel(e.target.value)} /></Field>
            <Field label='Type "DELETE" to confirm'><Input aria-label="Confirm delete" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} /></Field>
            <div className="flex items-end"><Button variant="danger" busy={busy === "delete"} disabled={confirmText !== "DELETE" || !pwDel} onClick={del}>Delete</Button></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
