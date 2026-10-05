"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtDate } from "@/lib/client";
import { Button } from "./ui";

const NAV: { href: string; label: string; group?: string }[] = [
  { href: "/", label: "Dashboard" },
  { href: "/action-required", label: "Action Required" },
  { href: "/jobs", label: "Jobs" },
  { href: "/applications", label: "Application Register" },
  { href: "/profile", label: "My Profile", group: "Profile" },
  { href: "/facts", label: "Verified Facts", group: "Profile" },
  { href: "/resumes", label: "Resumes", group: "Profile" },
  { href: "/preferences", label: "Preferences & Limits", group: "Profile" },
  { href: "/audit", label: "Audit Log", group: "Security" },
  { href: "/security", label: "Security", group: "Security" },
  { href: "/settings", label: "Data & Integrations", group: "Security" },
];

type Notif = { _id: string; title: string; body: string; link?: string; read: boolean; ts: string };

export default function Shell({ email, children }: { email: string; children: React.ReactNode }) {
  const path = usePathname();
  const [state, setState] = useState<"running" | "paused" | "stopped">("running");
  const [busy, setBusy] = useState(false);
  const [actionCount, setActionCount] = useState(0);
  const [notifs, setNotifs] = useState<{ items: Notif[]; unread: number }>({ items: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const seen = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const [a, n, ar] = await Promise.all([
        api<{ state: typeof state }>("/api/automation"),
        api<{ items: Notif[]; unread: number }>("/api/notifications"),
        api<{ jobs: unknown[]; applications: unknown[] }>("/api/action-required"),
      ]);
      setState(a.state);
      setNotifs(n);
      setActionCount(ar.jobs.length + ar.applications.length);
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        for (const it of n.items) {
          if (!it.read && !seen.current.has(it._id) && seen.current.size > 0) new Notification(it.title, { body: it.body });
        }
      }
      n.items.forEach((i) => seen.current.add(i._id));
      if (!seen.current.size) seen.current.add("init");
    } catch {
      /* handled by api() redirect */
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    const onChange = () => refresh();
    window.addEventListener("jp:refresh", onChange);
    return () => { clearInterval(t); window.removeEventListener("jp:refresh", onChange); };
  }, [refresh, path]);

  async function setAutomation(s: typeof state) {
    setBusy(true);
    try {
      await api("/api/automation", { body: { state: s } });
      setState(s);
      window.dispatchEvent(new Event("jp:refresh"));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/login";
  }

  const pill = { running: "bg-emerald-50 text-emerald-700 ring-emerald-200", paused: "bg-amber-50 text-amber-800 ring-amber-200", stopped: "bg-red-50 text-red-700 ring-red-200" }[state];
  let lastGroup: string | undefined;

  return (
    <div className="flex min-h-full">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white md:block">
        <div className="flex items-center gap-2 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">J</div>
          <span className="font-semibold">JobPilot</span>
        </div>
        <nav className="px-3 pb-6 text-sm" aria-label="Main">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            const header = n.group && n.group !== lastGroup ? n.group : null;
            lastGroup = n.group;
            return (
              <div key={n.href}>
                {header && <div className="mt-4 px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{header}</div>}
                <Link href={n.href} className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 ${active ? "bg-brand-50 font-medium text-brand-700" : "text-slate-700 hover:bg-slate-100"}`}>
                  {n.label}
                  {n.href === "/action-required" && actionCount > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white" data-testid="action-count">{actionCount}</span>}
                </Link>
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex items-center gap-2 text-sm">
            <button type="button" className="rounded-lg border border-slate-300 px-2.5 py-1 text-sm md:hidden" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>☰</button>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${pill}`} data-testid="automation-state">
              Automation: {state === "stopped" ? "EMERGENCY STOP" : state}
            </span>
            <span className="hidden text-xs text-slate-500 lg:inline">Mode: Human approval required</span>
          </div>
          <div className="flex items-center gap-2">
            {state === "running" && <Button variant="secondary" size="sm" busy={busy} onClick={() => setAutomation("paused")}>Pause</Button>}
            {state !== "running" && <Button variant="success" size="sm" busy={busy} onClick={() => setAutomation("running")}>Resume</Button>}
            {state !== "stopped" && <Button variant="danger" size="sm" busy={busy} onClick={() => setAutomation("stopped")}>Emergency Stop</Button>}
            <div className="relative">
              <Button variant="ghost" size="sm" aria-label="Notifications" onClick={() => setOpen(!open)}>
                Alerts{notifs.unread > 0 && <span className="ml-1 rounded-full bg-brand-600 px-1.5 text-xs text-white" data-testid="unread">{notifs.unread}</span>}
              </Button>
              {open && (
                <div className="absolute right-0 mt-2 w-[min(20rem,90vw)] rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                  <div className="flex items-center justify-between px-2 py-1">
                    <span className="text-xs font-semibold text-slate-600">Notifications</span>
                    <button className="text-xs text-brand-600 hover:underline" onClick={async () => { await api("/api/notifications", { body: { all: true } }); refresh(); }}>Mark all read</button>
                  </div>
                  <ul className="max-h-80 overflow-y-auto">
                    {notifs.items.length === 0 && <li className="px-2 py-3 text-sm text-slate-500">Nothing yet.</li>}
                    {notifs.items.map((n) => (
                      <li key={n._id}>
                        <Link href={n.link ?? "#"} onClick={() => setOpen(false)} className={`block rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50 ${n.read ? "text-slate-500" : "text-slate-900"}`}>
                          <div className="font-medium">{n.title}</div>
                          <div className="text-xs text-slate-500">{n.body} · {fmtDate(n.ts)}</div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <span className="hidden text-xs text-slate-500 sm:inline">{email}</span>
            <Button variant="ghost" size="sm" onClick={logout}>Sign out</Button>
          </div>
        </header>
        {menu && (
          <nav className="border-b border-slate-200 bg-white px-4 py-2 text-sm md:hidden" aria-label="Mobile">
            {NAV.map((n) => {
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} onClick={() => setMenu(false)} className={`flex items-center justify-between rounded-lg px-2.5 py-2 ${active ? "bg-brand-50 font-medium text-brand-700" : "text-slate-700"}`}>
                  {n.label}
                  {n.href === "/action-required" && actionCount > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">{actionCount}</span>}
                </Link>
              );
            })}
          </nav>
        )}
        {state === "stopped" && (
          <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-800" role="alert">
            Emergency Stop is active. No discovery, approvals or application actions will run until you press Resume.
          </div>
        )}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6">{children}</main>
      </div>
    </div>
  );
}
