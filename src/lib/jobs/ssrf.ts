import dns from "node:dns/promises";
import net from "node:net";

/**
 * Only these hosts may ever be fetched server-side. LinkedIn and Naukri are deliberately
 * absent: their terms prohibit automated access, so the user pastes job text instead.
 */
export const FETCH_ALLOWLIST = ["boards-api.greenhouse.io", "api.lever.co", "api.adzuna.com"];

export class SsrfError extends Error {}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === "::1" || l === "::") return true;
    if (l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80")) return true;
    const v4 = l.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4) return isPrivateIp(v4[1]);
    return false;
  }
  return true;
}

export async function assertFetchable(rawUrl: string, allowlist = FETCH_ALLOWLIST): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new SsrfError("Invalid URL");
  }
  if (u.protocol !== "https:") throw new SsrfError("Only https is allowed");
  if (u.username || u.password) throw new SsrfError("Credentials in URL are not allowed");
  if (u.port && u.port !== "443") throw new SsrfError("Non-standard ports are not allowed");
  const host = u.hostname.toLowerCase();
  if (!allowlist.includes(host)) throw new SsrfError(`Host not on the fetch allowlist: ${host}`);
  if (net.isIP(host)) throw new SsrfError("IP literals are not allowed");
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new SsrfError("Host resolves to a private address");
  return u;
}

/** GET JSON from an allowlisted host. No redirects, 10 s timeout, 2 MB cap. */
export async function safeFetchJson(rawUrl: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const u = await assertFetchable(rawUrl);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetchImpl(u.toString(), { redirect: "manual", signal: ctl.signal, headers: { accept: "application/json", "user-agent": "JobPilot/0.1 (personal job search)" } });
    if (res.status >= 300 && res.status < 400) throw new SsrfError("Redirects are not followed");
    if (!res.ok) throw new Error(`Upstream returned ${res.status}`);
    const text = await res.text();
    if (text.length > 2_000_000) throw new Error("Response too large");
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}
