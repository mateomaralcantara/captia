import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MfaForm } from "@/components/forms";
import { getLang, sessionClaims } from "@/lib/server";

export const metadata: Metadata = { title: "Verificación en dos pasos" };

export default async function MfaPage() {
  const { t } = await getLang();
  const claims = await sessionClaims();
  if (!claims) redirect("/login");
  if (claims.aal === "aal2") redirect("/");
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-ink-800 bg-white p-8 shadow-xl dark:bg-ink-900">
        <h1 className="text-2xl font-semibold">{t.login.mfaTitle}</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500 dark:text-slate-400">{t.login.mfaSubtitle}</p>
        <MfaForm t={t} />
      </div>
    </main>
  );
}
