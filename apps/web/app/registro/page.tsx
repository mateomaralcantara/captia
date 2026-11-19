import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "@/components/forms";
import { ErrorNote } from "@/components/ui";
import { getLang } from "@/lib/server";
import { authConfig } from "@/lib/session";

export const metadata: Metadata = { title: "Crear cuenta" };

export default async function SignupPage() {
  const { t } = await getLang();
  const configured = authConfig() !== null;
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-950 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-ink-800 bg-white p-8 shadow-xl dark:bg-ink-900">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-600">CAPTIA OS</p>
        <h1 className="mt-2 text-2xl font-semibold">{t.signup.title}</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500 dark:text-slate-400">{t.signup.subtitle}</p>
        {configured ? <SignupForm t={t} /> : <ErrorNote message={t.login.notConfigured} />}
        <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
          {t.signup.haveAccount}{" "}
          <Link href="/login" className="font-medium text-brand-700 hover:underline dark:text-brand-100">
            {t.signup.signIn}
          </Link>
        </p>
      </div>
    </main>
  );
}
