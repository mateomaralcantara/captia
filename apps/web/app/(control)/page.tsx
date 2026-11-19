import type { Metadata } from "next";
import Link from "next/link";
import { InfoNote, PageHeader, StatCard, StatusBadge, ErrorNote, formatDate } from "@/components/ui";
import { activeOrganizationId, api, currentUser, errorCode, getLang, hasPlatform } from "@/lib/server";
import { errorMessage } from "@/lib/i18n";

export const metadata: Metadata = { title: "Resumen" };

export default async function OverviewPage() {
  const { lang, t } = await getLang();
  const me = await currentUser();
  const platform = hasPlatform(me, "platform.dashboard.read");
  const orgId = platform ? null : await activeOrganizationId(me);

  if (!platform && !orgId) {
    return (
      <>
        <PageHeader title={t.overview.title} />
        <InfoNote>{t.signup.afterSignup}</InfoNote>
      </>
    );
  }

  let data;
  try {
    data = await (await api()).dashboard(orgId ?? undefined);
  } catch (error) {
    return (
      <>
        <PageHeader title={t.overview.title} />
        <ErrorNote message={errorMessage(t, errorCode(error))} />
      </>
    );
  }
  const s = data.summary;

  return (
    <>
      <PageHeader
        title={t.overview.title}
        subtitle={`${s.scope === "platform" ? t.overview.platformScope : t.overview.orgScope} · ${t.overview.generatedAt}: ${formatDate(data.generatedAt, lang)}`}
      />
      <section aria-label={t.overview.title} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {s.scope === "platform" ? (
          <>
            <StatCard label={t.overview.organizationsTotal} value={s.organizationsTotal} />
            <StatCard label={t.overview.organizationsActive} value={s.organizationsActive} />
            <StatCard label={t.overview.organizationsSuspended} value={s.organizationsSuspended} />
            <StatCard label={t.overview.usersTotal} value={s.usersTotal} />
            <StatCard label={t.overview.platformAdmins} value={s.platformAdmins} />
            <StatCard label={t.overview.membershipsActive} value={s.membershipsActive} />
            <StatCard label={t.overview.auditEvents24h} value={s.auditEvents24h} />
          </>
        ) : (
          <>
            <StatCard label={t.overview.membersTotal} value={s.membersTotal} />
            <StatCard label={t.overview.membersActive} value={s.membersActive} />
            <StatCard label={t.overview.customRoles} value={s.customRoles} />
            <StatCard label={t.overview.auditEvents24h} value={s.auditEvents24h} />
          </>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-2 text-lg font-semibold">{t.overview.services}</h2>
        <p className="mb-4 max-w-3xl text-sm text-slate-500 dark:text-slate-400">{t.overview.servicesNote}</p>
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                <th>{t.common.name}</th>
                <th>{t.common.status}</th>
                <th>{t.settings.reason}</th>
                <th>{t.settings.delivery}</th>
              </tr>
            </thead>
            <tbody>
              {data.services.map((svc) => (
                <tr key={svc.key}>
                  <td>
                    <Link href={svc.status === "implemented" ? "/clientes" : `/modulo/${svc.key}`} className="font-medium hover:underline">
                      {svc.name}
                    </Link>
                  </td>
                  <td><StatusBadge status={svc.status} t={t} /></td>
                  <td className="text-slate-500 dark:text-slate-400">{svc.statusReason}</td>
                  <td className="whitespace-nowrap">{svc.delivery ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
