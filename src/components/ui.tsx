"use client";
import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50",
  secondary: "bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-600/50",
  ghost: "text-slate-600 hover:bg-slate-100",
};

export function Button({ variant = "primary", size = "md", className, busy, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; busy?: boolean }) {
  return (
    <button
      {...p}
      disabled={p.disabled || busy}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        VARIANTS[variant],
        className,
      )}
    >
      {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl border border-slate-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, children, error }: { label: string; hint?: ReactNode; children: ReactNode; error?: string }) {
  return (
    <div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-700">{label}</span>
        {children}
      </label>
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100";
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(inputCls, "min-h-24", p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, p.className)} />;

type Tone = "slate" | "blue" | "green" | "amber" | "red" | "violet";
const TONES: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-700",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};
export function Badge({ tone = "slate", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span title={title} className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-transparent", TONES[tone])}>{children}</span>;
}

export function ScoreBadge({ score }: { score?: number | null }) {
  if (score === undefined || score === null) return <Badge>—</Badge>;
  const tone: Tone = score >= 80 ? "green" : score >= 60 ? "amber" : "red";
  return <Badge tone={tone}>{score}/100</Badge>;
}

const STATUS_TONE: Record<string, Tone> = {
  Discovered: "slate", Shortlisted: "blue", "Awaiting Approval": "violet", Applying: "blue", Applied: "green", "Application Failed": "red",
  "Manual Action Required": "amber", Rejected: "red", Interview: "green", Offer: "green", Withdrawn: "slate", Closed: "slate",
  "Low Relevance": "slate", Skipped: "slate", Approved: "blue", Dismissed: "slate",
};
export const StatusBadge = ({ status }: { status: string }) => <Badge tone={STATUS_TONE[status] ?? "slate"}>{status}</Badge>;

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export function Alert({ tone = "blue", children }: { tone?: "blue" | "red" | "amber" | "green"; children: ReactNode }) {
  const c = { blue: "border-blue-200 bg-blue-50 text-blue-900", red: "border-red-200 bg-red-50 text-red-900", amber: "border-amber-200 bg-amber-50 text-amber-900", green: "border-emerald-200 bg-emerald-50 text-emerald-900" }[tone];
  return <div role={tone === "red" ? "alert" : "status"} className={cx("rounded-lg border px-3.5 py-2.5 text-sm", c)}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">{children}</div>;
}

/** Message state helper: const [msg, setMsg] = useMsg(); */
export function useMsg() {
  return useState<{ tone: "green" | "red" | "amber" | "blue"; text: string } | null>(null);
}
export function Msg({ m }: { m: { tone: "green" | "red" | "amber" | "blue"; text: string } | null }) {
  return m ? <Alert tone={m.tone}>{m.text}</Alert> : null;
}

/** Comma-separated list input bound to string[] */
export function ListInput({ value, onChange, placeholder, ...rest }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; "aria-label"?: string; name?: string }) {
  const [text, setText] = useState(value.join(", "));
  return (
    <Input
      {...rest}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean));
      }}
    />
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
          <tr>{head.map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cx("px-3 py-2 align-top", className)}>{children}</td>;
