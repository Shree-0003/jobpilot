"use client";
import { useCallback, useEffect, useState } from "react";
import { api, fmtDay } from "@/lib/client";
import { Badge, Button, Card, Empty, Field, Input, Msg, PageHeader, Select, Table, Td, useMsg } from "@/components/ui";

type Fact = { factId: string; category: string; label: string; value: string; valueNumeric?: number; unit?: string; verified: boolean; source: string; version: number; updatedAt: string };
const CATS: [string, string][] = [
  ["skill", "Skill"], ["certification", "Certification"], ["experience_years", "Experience (years)"], ["employer", "Employer"], ["job_title", "Job title"],
  ["education", "Education"], ["project", "Project"], ["achievement", "Achievement"], ["industry", "Industry"], ["language", "Language"],
  ["notice_period_days", "Notice period (days) — private"], ["current_salary", "Current salary — private"], ["expected_salary", "Expected salary — private"],
  ["work_authorization", "Work authorisation — private"], ["location", "Location"],
];
const PRIVATE = new Set(["notice_period_days", "current_salary", "expected_salary", "work_authorization"]);
const NUMERIC = new Set(["experience_years", "notice_period_days", "current_salary", "expected_salary"]);
const empty = { category: "skill", label: "", value: "", valueNumeric: "", unit: "" };

export default function Facts() {
  const [facts, setFacts] = useState<Fact[] | null>(null);
  const [f, setF] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useMsg();
  const load = useCallback(() => api<{ facts: Fact[] }>("/api/facts").then((r) => setFacts(r.facts)), []);
  useEffect(() => { load(); }, [load]);

  const payload = () => ({ category: f.category, label: f.label, value: f.value, valueNumeric: f.valueNumeric === "" ? undefined : Number(f.valueNumeric), unit: f.unit || undefined });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      if (editing) await api(`/api/facts/${editing}`, { method: "PUT", body: payload() });
      else await api("/api/facts", { body: payload() });
      setMsg({ tone: "green", text: editing ? `Updated ${editing}.` : "Fact added and marked verified." });
      setF(empty); setEditing(null); load();
    } catch (err) { setMsg({ tone: "red", text: (err as Error).message }); }
  }
  async function act(fn: () => Promise<unknown>, text: string) {
    try { await fn(); setMsg({ tone: "green", text }); load(); } catch (e) { setMsg({ tone: "red", text: (e as Error).message }); }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Verified Facts" subtitle="The only information the AI may use to score jobs and draft answers. If it is not here, the AI must say so — it will not guess." />
      <Msg m={msg} />
      <Card title={editing ? `Edit ${editing}` : "Add a fact"}>
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-6" aria-label="Fact form">
          <div className="md:col-span-2"><Field label="Category"><Select name="category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field></div>
          <div className="md:col-span-2"><Field label="Label" hint="e.g. ISO/IEC 27001 Lead Auditor, Total experience, GRC experience"><Input name="label" required value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field></div>
          <Field label="Number"><Input name="valueNumeric" type="number" step="0.1" min="0" value={f.valueNumeric} onChange={(e) => setF({ ...f, valueNumeric: e.target.value })} disabled={!NUMERIC.has(f.category)} /></Field>
          <Field label="Unit"><Input name="unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="years / LPA" disabled={!NUMERIC.has(f.category)} /></Field>
          <div className="md:col-span-5"><Field label="Details (optional)" hint="Issuer and year, employer and dates, scope of work…"><Input name="value" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field></div>
          <div className="flex items-end gap-2"><Button type="submit">{editing ? "Save" : "Add fact"}</Button>{editing && <Button type="button" variant="ghost" onClick={() => { setEditing(null); setF(empty); }}>Cancel</Button>}</div>
        </form>
        {PRIVATE.has(f.category) && <p className="mt-2 text-xs text-amber-700">Private category: stored encrypted, never sent to the AI. Used only by code (e.g. salary comparisons) and pre-filled for your confirmation.</p>}
      </Card>
      <Card title={`${facts?.length ?? 0} fact(s)`}>
        {!facts ? <p className="text-sm text-slate-500">Loading…</p> : facts.length === 0 ? <Empty>Add your skills, certifications, total years of experience, employers and education.</Empty> : (
          <Table head={["ID", "Category", "Fact", "Value", "Status", "Updated", ""]}>
            {facts.map((x) => (
              <tr key={x.factId} data-testid={`fact-${x.factId}`}>
                <Td className="font-mono text-xs">{x.factId}</Td>
                <Td><Badge tone={PRIVATE.has(x.category) ? "amber" : "slate"}>{x.category.replace(/_/g, " ")}</Badge></Td>
                <Td><div className="font-medium">{x.label}</div>{x.value && <div className="text-xs text-slate-500">{x.value}</div>}</Td>
                <Td className="tabular-nums">{x.valueNumeric !== undefined ? `${x.valueNumeric} ${x.unit ?? ""}` : "—"}</Td>
                <Td>{x.verified ? <Badge tone="green">Verified</Badge> : <Badge tone="amber">Needs approval</Badge>}</Td>
                <Td className="whitespace-nowrap text-xs text-slate-500">{fmtDay(x.updatedAt)} · v{x.version}</Td>
                <Td className="whitespace-nowrap">
                  {!x.verified && <Button size="sm" variant="success" onClick={() => act(() => api(`/api/facts/${x.factId}/verify`, { method: "POST" }), `${x.factId} verified.`)}>Verify</Button>}
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(x.factId); setF({ category: x.category, label: x.label, value: x.value, valueNumeric: x.valueNumeric?.toString() ?? "", unit: x.unit ?? "" }); window.scrollTo({ top: 0 }); }}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => act(() => api(`/api/facts/${x.factId}`, { method: "DELETE" }), `${x.factId} deleted.`)}>Delete</Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
