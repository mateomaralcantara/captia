import type { Metadata } from "next";
import { LoginForm } from "@/components/forms";
import { getLang } from "@/lib/server";
import { authConfig } from "@/lib/session";
import { ErrorNote } from "@/components/ui";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function LoginPage() {
  const { t } = await getLang();
  const configured = authConfig() !== null;
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-ink-800 bg-white p-8 shadow-xl dark:bg-ink-900">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-600">CAPTIA OS</p>
        <h1 className="mt-2 text-2xl font-semibold">{t.login.title}</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500 dark:text-slate-400">{t.login.subtitle}</p>
        {configured ? <LoginForm t={t} /> : <ErrorNote message={t.login.notConfigured} />}
      </div>
    </main>
  );
}
