"use client";
// Browser-side API helper: same-origin only, sends the CSRF double-submit header.

function csrf(): string {
  const m = document.cookie.match(/(?:^|;\s*)jp_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export class ApiFailure extends Error {
  constructor(public status: number, message: string, public data: Record<string, unknown> = {}) {
    super(message);
  }
}

export async function api<T = Record<string, unknown>>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  if (!path.startsWith("/api/")) throw new Error("Only same-origin API paths are allowed");
  const method = opts.method ?? (opts.body || opts.form ? "POST" : "GET");
  const headers: Record<string, string> = { "x-csrf-token": csrf() };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("application/json") ? await res.json() : {};
  const err = (data as { error?: string }).error ?? "";
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/") && /Sign in required|MFA verification required/.test(err)) {
    window.location.href = err.includes("MFA") ? "/mfa" : "/login";
  }
  if (!res.ok) {
    const d = data as { error?: string; fields?: { path: string; message: string }[] };
    const msg = d.fields?.length ? `${d.error} ${d.fields.map((f) => `${f.path}: ${f.message}`).join("; ")}` : d.error ?? `Request failed (${res.status})`;
    throw new ApiFailure(res.status, msg, data as Record<string, unknown>);
  }
  return data as T;
}

/** Download a file from an API route (POST or GET) without exposing data in the URL. */
export async function download(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "x-csrf-token": csrf(), ...(body ? { "content-type": "application/json" } : {}) },
    credentials: "same-origin",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new ApiFailure(res.status, (d as { error?: string }).error ?? "Download failed");
  }
  const blob = await res.blob();
  const name = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "download";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const fmtDate = (d?: string | Date | null) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
export const fmtDay = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—");
