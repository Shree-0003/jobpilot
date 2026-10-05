"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, download, fmtDay } from "@/lib/client";
import { Badge, Button, Card, Empty, Field, Input, Msg, PageHeader, Table, Td, useMsg } from "@/components/ui";

type R = { _id: string; label: string; focusKeywords: string[]; mime: string; size: number; scanStatus: string; scanDetail?: string; approved: boolean; createdAt: string };

export default function Resumes() {
  const [list, setList] = useState<R[] | null>(null);
  const [label, setLabel] = useState("");
  const [kw, setKw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useMsg();
  const fileRef = useRef<HTMLInputElement>(null);
  const load = useCallback(() => api<{ resumes: R[] }>("/api/resumes").then((r) => setList(r.resumes)), []);
  useEffect(() => { load(); }, [load]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setMsg({ tone: "red", text: "Choose a PDF or DOCX file." });
    const fd = new FormData();
    fd.append("file", file);
    fd.append("label", label);
    fd.append("focusKeywords", kw);
    setBusy(true);
    try { await api("/api/resumes", { form: fd }); setMsg({ tone: "green", text: "Uploaded and encrypted. Approve it before it can be used." }); setLabel(""); setKw(""); if (fileRef.current) fileRef.current.value = ""; load(); }
    catch (err) { setMsg({ tone: "red", text: (err as Error).message }); }
    finally { setBusy(false); }
  }
  async function act(fn: () => Promise<unknown>, text: string) {
    try { await fn(); setMsg({ tone: "green", text }); load(); } catch (e) { setMsg({ tone: "red", text: (e as Error).message }); }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Resumes" subtitle="Encrypted at rest, checked for active content, never shown in logs. JobPilot picks the best approved resume per job — it never edits your resume." />
      <Msg m={msg} />
      <Card title="Upload a resume">
        <form onSubmit={upload} className="grid gap-3 md:grid-cols-4" aria-label="Upload resume">
          <Field label="Label"><Input name="label" required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Security/GRC Resume" /></Field>
          <div className="md:col-span-2"><Field label="Focus keywords" hint="Comma separated; used to pick this resume for matching jobs."><Input name="keywords" value={kw} onChange={(e) => setKw(e.target.value)} placeholder="GRC, ISO 27001, audit, risk" /></Field></div>
          <Field label="File (PDF or DOCX, max 5 MB)"><input ref={fileRef} name="file" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="block w-full text-sm" /></Field>
          <div><Button type="submit" busy={busy}>Upload</Button></div>
        </form>
      </Card>
      <Card title="Your resumes">
        {!list ? <p className="text-sm text-slate-500">Loading…</p> : list.length === 0 ? <Empty>No resumes yet.</Empty> : (
          <Table head={["Label", "Keywords", "Type", "Size", "Scan", "Status", "Uploaded", ""]}>
            {list.map((r) => (
              <tr key={r._id}>
                <Td className="font-medium">{r.label}</Td>
                <Td className="text-xs">{r.focusKeywords.join(", ") || "—"}</Td>
                <Td className="text-xs">{r.mime.includes("pdf") ? "PDF" : "DOCX"}</Td>
                <Td className="text-xs tabular-nums">{Math.round(r.size / 1024)} KB</Td>
                <Td><Badge tone={r.scanStatus === "clean" ? "green" : "red"} title={r.scanDetail}>{r.scanStatus}</Badge></Td>
                <Td>{r.approved ? <Badge tone="green">Approved</Badge> : <Badge tone="amber">Not approved</Badge>}</Td>
                <Td className="text-xs">{fmtDay(r.createdAt)}</Td>
                <Td className="whitespace-nowrap">
                  {r.approved
                    ? <Button size="sm" variant="ghost" onClick={() => act(() => api(`/api/resumes/${r._id}`, { method: "PATCH", body: { approved: false } }), "Approval removed.")}>Unapprove</Button>
                    : <Button size="sm" variant="success" onClick={() => act(() => api(`/api/resumes/${r._id}`, { method: "PATCH", body: { approved: true } }), `${r.label} approved.`)}>Approve</Button>}
                  <Button size="sm" variant="ghost" onClick={() => download(`/api/resumes/${r._id}/download`).catch((e) => setMsg({ tone: "red", text: e.message }))}>Download</Button>
                  <Button size="sm" variant="ghost" onClick={() => act(() => api(`/api/resumes/${r._id}`, { method: "DELETE" }), "Deleted.")}>Delete</Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
