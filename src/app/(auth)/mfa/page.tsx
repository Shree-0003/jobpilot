"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Alert, Button, Field, Input } from "@/components/ui";

export default function MfaPage() {
  const [setup, setSetup] = useState<{ enrolled: boolean; secret?: string; qr?: string } | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<string[] | null>(null);

  useEffect(() => {
    api<{ authenticated: boolean; mfaVerified?: boolean }>("/api/auth/me").then(async (m) => {
      if (!m.authenticated) return (window.location.href = "/login");
      if (m.mfaVerified) return (window.location.href = "/");
      setSetup(await api("/api/auth/mfa/setup"));
    }).catch((e) => setErr((e as Error).message));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ recoveryCodes?: string[] }>("/api/auth/mfa/verify", { body: { code: code.trim() } });
      if (r.recoveryCodes) setRecovery(r.recoveryCodes);
      else window.location.href = "/";
    } catch (e) {
      setErr((e as Error).message);
      if ((e as Error).message.includes("Sign in again")) setTimeout(() => (window.location.href = "/login"), 1500);
    } finally {
      setBusy(false);
    }
  }

  if (recovery) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold">MFA is on</h1>
        <Alert tone="amber">Save these one-time recovery codes somewhere safe (a password manager). They are shown only once.</Alert>
        <ul className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 font-mono text-sm" data-testid="recovery-codes">
          {recovery.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <Button className="w-full" onClick={() => (window.location.href = "/")}>I have saved them — continue</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Multi-factor authentication">
      <h1 className="text-lg font-semibold">{setup && !setup.enrolled ? "Set up your authenticator" : "Two-step verification"}</h1>
      {err && <Alert tone="red">{err}</Alert>}
      {setup && !setup.enrolled && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Scan this QR code with Google Authenticator, Microsoft Authenticator, 1Password or similar.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {setup.qr && <img src={setup.qr} alt="Authenticator QR code" width={180} height={180} className="mx-auto rounded-lg border border-slate-200" />}
          <p className="text-center text-xs text-slate-500">Or enter this key manually: <code className="select-all break-all rounded bg-slate-100 px-1.5 py-0.5" data-testid="mfa-secret">{setup.secret}</code></p>
        </div>
      )}
      <Field label={setup?.enrolled ? "6-digit code or a recovery code" : "6-digit code from the app"}>
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <Button type="submit" className="w-full" busy={busy} disabled={!setup}>Verify</Button>
    </form>
  );
}
