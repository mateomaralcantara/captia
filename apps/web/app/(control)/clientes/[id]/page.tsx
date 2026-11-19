import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CaptiaApiError } from "@captia/api-client";
import { AddMemberForm, MemberActions, OrganizationStatusForm } from "@/components/forms";
import { ErrorNote, PageHeader, StatusBadge, formatDate } from "@/components/ui";
import { errorMessage } from "@/lib/i18n";
import { api, currentUser, errorCode, getLang, hasOrg, hasPlatform } from "@/lib/server";

export const metadata: Metadata = { title: "Organización" };

export default async function OrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { lang, t } = await getLang();
  const me = await currentUser();
  const client = await api();

  let organization;
  try {
    organization = await client.getOrganization(id);
  } catch (error) {
    if (error instanceof CaptiaApiError && error.status === 404) notFound();
    return <ErrorNote message={errorMessage(t, errorCode(error))} />;
  }

  const canReadMembers = hasOrg(me, id, "members.read");
  const canManage = hasOrg(me, id, "members.manage");
  const canReadRoles = hasOrg(me, id, "roles.read");
  const [members, roles] = await Promise.all([
    canReadMembers ? client.listMembers(id).then((r) => r.data) : Promise.resolve([]),
    canReadRoles ? client.listRoles(id).then((r) => r.data) : Promise.resolve([]),
  ]);
  const roleOptions = roles.map((r) => ({ key: r.key, name: r.name }));

  return (
    <>
      <Link href="/clientes" className="text-sm text-brand-700 hover:underline dark:text-brand-100">← {t.customers.back}</Link>
      <PageHeader title={organization.name} subtitle={`${organization.slug} · ${formatDate(organization.createdAt, lang)}`}>
        <div className="flex items-center gap-3">
          <StatusBadge status={organization.status} t={t} />
          {hasPlatform(me, "platform.organizations.suspend") ? (
            <OrganizationStatusForm t={t} organizationId={id} status={organization.status} />
          ) : null}
        </div>
      </PageHeader>

      {canReadMembers ? (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold">{t.customers.members}</h2>
          {canManage ? (
            <div className="card mb-4">
              <AddMemberForm t={t} organizationId={id} roles={roleOptions} />
            </div>
          ) : null}
          <div className="card overflow-x-auto p-0">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.common.email}</th>
                  <th>{t.common.role}</th>
                  <th>{t.common.status}</th>
                  <th>{t.common.created}</th>
                  {canManage ? <th>{t.common.actions}</th> : null}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>{m.email}{m.displayName ? <span className="block text-xs text-slate-500">{m.displayName}</span> : null}</td>
                    <td>{m.roleName}</td>
                    <td><StatusBadge status={m.status} t={t} /></td>
                    <td>{formatDate(m.createdAt, lang)}</td>
                    {canManage ? (
                      <td>
                        <MemberActions t={t} organizationId={id} memberId={m.id} roleKey={m.roleKey} status={m.status} roles={roleOptions} canManage />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {canReadRoles ? (
        <section>
          <h2 className="mb-3 text-lg font-semibold">{t.customers.roles}</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {roles.map((r) => (
              <div key={r.id} className="card">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">{r.name}</h3>
                  <span className="text-xs text-slate-500">{r.isSystem ? t.customers.system : t.customers.custom}</span>
                </div>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{r.description}</p>
                <ul className="mt-3 flex flex-wrap gap-1">
                  {r.permissions.map((p) => (
                    <li key={p} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-ink-800">{p}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
