"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { Alert, Button, Field, Input } from "@/components/ui";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false);

  useEffect(() => {
    api<{ authenticated: boolean; mfaVerified?: boolean; registrationOpen?: boolean }>("/api/auth/me").then((m) => {
      if (m.authenticated) window.location.href = m.mfaVerified ? "/" : "/mfa";
      setRegistrationOpen(!!m.registrationOpen);
    }).catch(() => undefined);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api("/api/auth/login", { body: { email, password } });
      window.location.href = "/mfa";
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Sign in">
      <h1 className="text-lg font-semibold">Sign in</h1>
      {err && <Alert tone="red">{err}</Alert>}
      <Field label="Email"><Input name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <Button type="submit" className="w-full" busy={busy}>Continue</Button>
      {registrationOpen && (
        <p className="text-center text-sm text-slate-600">First time here? <Link className="font-medium text-brand-600 hover:underline" href="/register">Create your account</Link></p>
      )}
    </form>
  );
}
