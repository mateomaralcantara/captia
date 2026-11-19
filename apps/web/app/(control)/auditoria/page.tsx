import type { Metadata } from "next";
import Link from "next/link";
import { ErrorNote, InfoNote, PageHeader, formatDate } from "@/components/ui";
import { errorMessage } from "@/lib/i18n";
import { activeOrganizationId, api, currentUser, errorCode, getLang, hasOrg, hasPlatform } from "@/lib/server";

export const metadata: Metadata = { title: "Auditoría" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { before } = await searchParams;
  const { lang, t } = await getLang();
  const me = await currentUser();
  const platform = hasPlatform(me, "platform.audit.read");
  const orgId = await activeOrganizationId(me);
  const client = await api();
  const page = { limit: 50, ...(before ? { before } : {}) };

  if (!platform && !(orgId && hasOrg(me, orgId, "audit.read"))) {
    return (
      <>
        <PageHeader title={t.audit.title} subtitle={t.audit.subtitle} />
        <InfoNote>{t.errors.forbidden}</InfoNote>
      </>
    );
  }

  let events;
  try {
    events = (platform ? await client.platformAudit(page) : await client.organizationAudit(orgId!, page)).data;
  } catch (error) {
    return <ErrorNote message={errorMessage(t, errorCode(error))} />;
  }
  const last = events.at(-1);

  return (
    <>
      <PageHeader title={t.audit.title} subtitle={`${t.audit.subtitle} · ${platform ? t.common.platform : t.common.organization}`} />
      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>{t.audit.when}</th>
              <th>{t.audit.actor}</th>
              <th>{t.audit.action}</th>
              <th>{t.audit.target}</th>
              <th>MFA</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr><td colSpan={5} className="text-slate-500">{t.common.none}</td></tr>
            ) : (
              events.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">{formatDate(e.createdAt, lang)}</td>
                  <td>{e.actorEmail ?? e.actorType}</td>
                  <td className="font-mono text-xs">{e.action}</td>
                  <td className="font-mono text-xs">{e.targetType ? `${e.targetType}:${e.targetId?.slice(0, 8)}` : "—"}</td>
                  <td>{String(e.metadata.aal ?? "—")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {last && events.length === page.limit ? (
        <Link className="btn-secondary mt-4" href={`/auditoria?before=${encodeURIComponent(last.createdAt)}`}>{t.audit.older} →</Link>
      ) : null}
    </>
  );
}
