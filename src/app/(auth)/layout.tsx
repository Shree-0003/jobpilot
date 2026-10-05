export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-full items-center justify-center bg-gradient-to-b from-slate-50 to-brand-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">J</div>
          <span className="text-lg font-semibold text-slate-900">JobPilot</span>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
        <p className="mt-4 text-center text-xs text-slate-500">Your data is encrypted. AI never sees your passwords or contact details.</p>
      </div>
    </main>
  );
}
