import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ErrorNote, InfoNote, PageHeader, StatusBadge } from "@/components/ui";
import { errorMessage } from "@/lib/i18n";
import { NAV, catalogKeyFor } from "@/lib/nav";
import { api, errorCode, getLang } from "@/lib/server";

export const metadata: Metadata = { title: "Módulo" };

/** Página de un módulo sin backend todavía: muestra su estado real según el catálogo del servidor. */
export default async function ModulePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const catalogKey = catalogKeyFor(key);
  const nav = NAV.find((n) => n.href === `/modulo/${key}`);
  if (!catalogKey || !nav) notFound();

  const { t } = await getLang();
  let entry;
  try {
    entry = (await (await api()).serviceCatalog()).data.find((s) => s.key === catalogKey);
  } catch (error) {
    return <ErrorNote message={errorMessage(t, errorCode(error))} />;
  }
  if (!entry) notFound();

  return (
    <>
      <PageHeader title={t.nav[nav.key]} subtitle={entry.name}>
        <StatusBadge status={entry.status} t={t} />
      </PageHeader>
      <section className="card max-w-2xl space-y-4">
        <h2 className="font-semibold">{t.module.pendingTitle}</h2>
        <InfoNote>{t.module.pendingBody}</InfoNote>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-slate-500">{t.common.status}</dt>
          <dd><StatusBadge status={entry.status} t={t} /></dd>
          <dt className="text-slate-500">{t.settings.reason}</dt>
          <dd>{entry.statusReason}</dd>
          <dt className="text-slate-500">{t.settings.delivery}</dt>
          <dd>{entry.delivery ?? "—"}</dd>
        </dl>
      </section>
    </>
  );
}
