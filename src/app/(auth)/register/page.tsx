"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { Alert, Button, Field, Input } from "@/components/ui";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setErr("Passwords do not match.");
    setBusy(true);
    setErr("");
    try {
      await api("/api/auth/register", { body: { email, password } });
      window.location.href = "/mfa";
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Create account">
      <h1 className="text-lg font-semibold">Create your account</h1>
      <p className="text-sm text-slate-600">Single-user workspace. You will set up an authenticator app next — MFA is mandatory.</p>
      {err && <Alert tone="red">{err}</Alert>}
      <Field label="Email"><Input name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Password" hint="At least 12 characters. A passphrase works well.">
        <Input name="password" type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Confirm password"><Input name="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
      <Button type="submit" className="w-full" busy={busy}>Create account</Button>
      <p className="text-center text-sm text-slate-600">Already set up? <Link className="font-medium text-brand-600 hover:underline" href="/login">Sign in</Link></p>
    </form>
  );
}
