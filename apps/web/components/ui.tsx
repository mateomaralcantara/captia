import type { Dictionary } from "@/lib/i18n";

const tone: Record<string, string> = {
  implemented: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  pending_infrastructure: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  pending_authorization: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  not_configured: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  experimental: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  unavailable: "bg-slate-200 text-slate-700 dark:bg-ink-800 dark:text-slate-300",
  suspended: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  fail: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

export function StatusBadge({ status, t }: { status: string; t: Dictionary }) {
  const label = (t.status as Record<string, string>)[status] ?? status;
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tone[status] ?? tone.unavailable}`}>
      {label}
    </span>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card">
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
      {message}
    </p>
  );
}

export function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-700 dark:border-ink-800 dark:bg-ink-900 dark:text-brand-100">
      {children}
    </div>
  );
}

export function formatDate(value: string, lang: string): string {
  return new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es-DO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
