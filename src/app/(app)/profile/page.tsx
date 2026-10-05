"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Button, Card, Field, Input, ListInput, Msg, PageHeader, Textarea, useMsg } from "@/components/ui";

type P = { fullName: string; email: string; phone: string; dob?: string; address?: string; currentLocation: string; preferredLocations: string[]; currentDesignation: string; employmentTypePref: string[]; links: Record<string, string | undefined> };

export default function Profile() {
  const [p, setP] = useState<P | null>(null);
  const [msg, setMsg] = useMsg();
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<P>("/api/profile").then((r) => setP({ ...r, links: r.links ?? {}, preferredLocations: r.preferredLocations ?? [], employmentTypePref: r.employmentTypePref ?? [] })); }, []);
  if (!p) return <p className="text-sm text-slate-500">Loading…</p>;
  const set = (k: keyof P) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setP({ ...p, [k]: e.target.value });
  const link = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, links: { ...p.links, [k]: e.target.value } });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { await api("/api/profile", { method: "PUT", body: p }); setMsg({ tone: "green", text: "Profile saved (sensitive fields encrypted)." }); }
    catch (err) { setMsg({ tone: "red", text: (err as Error).message }); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} className="space-y-6" aria-label="Profile">
      <PageHeader title="My Profile" subtitle="Contact details are encrypted and never sent to the AI. Qualifications live in Verified Facts." actions={<Button type="submit" busy={busy}>Save profile</Button>} />
      <Msg m={msg} />
      <Card title="Personal information (encrypted, never sent to the AI)">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Full name"><Input name="fullName" value={p.fullName} onChange={set("fullName")} /></Field>
          <Field label="Contact email"><Input name="contactEmail" type="email" value={p.email} onChange={set("email")} /></Field>
          <Field label="Phone"><Input name="phone" value={p.phone} onChange={set("phone")} placeholder="+91 …" /></Field>
          <Field label="Date of birth" hint="Only if an application requires it."><Input name="dob" type="date" value={p.dob ?? ""} onChange={set("dob")} /></Field>
          <div className="md:col-span-2"><Field label="Address" hint="Only if an application requires it."><Textarea name="address" rows={2} value={p.address ?? ""} onChange={set("address")} /></Field></div>
        </div>
      </Card>
      <Card title="Location and role">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Current designation"><Input name="designation" value={p.currentDesignation} onChange={set("currentDesignation")} /></Field>
          <Field label="Current location"><Input name="currentLocation" value={p.currentLocation} onChange={set("currentLocation")} /></Field>
          <Field label="Preferred locations" hint="Comma separated"><ListInput aria-label="Preferred locations" value={p.preferredLocations} onChange={(v) => setP({ ...p, preferredLocations: v })} placeholder="Bengaluru, Pune, Remote" /></Field>
          <Field label="Employment type preference" hint="Comma separated"><ListInput aria-label="Employment types" value={p.employmentTypePref} onChange={(v) => setP({ ...p, employmentTypePref: v })} placeholder="full-time" /></Field>
        </div>
      </Card>
      <Card title="Links">
        <div className="grid gap-3 md:grid-cols-2">
          {["linkedin", "naukri", "portfolio", "github", "website"].map((k) => (
            <Field key={k} label={k[0].toUpperCase() + k.slice(1)}><Input name={k} value={p.links[k] ?? ""} onChange={link(k)} placeholder="https://…" /></Field>
          ))}
        </div>
      </Card>
    </form>
  );
}
