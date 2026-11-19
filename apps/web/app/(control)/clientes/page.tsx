import type { Metadata } from "next";
import Link from "next/link";
import { CreateOrganizationForm } from "@/components/forms";
import { ErrorNote, InfoNote, PageHeader, StatusBadge, formatDate } from "@/components/ui";
import { errorMessage } from "@/lib/i18n";
import { api, currentUser, errorCode, getLang, hasPlatform } from "@/lib/server";

export const metadata: Metadata = { title: "Clientes" };

export default async function CustomersPage() {
  const { lang, t } = await getLang();
  const me = await currentUser();
  const canCreate = hasPlatform(me, "platform.organizations.create");

  let organizations;
  try {
    organizations = (await (await api()).listOrganizations()).data;
  } catch (error) {
    return <ErrorNote message={errorMessage(t, errorCode(error))} />;
  }

  return (
    <>
      <PageHeader title={t.customers.title} subtitle={t.customers.subtitle} />
      <section className="card mb-8">
        <h2 className="mb-4 font-semibold">{t.customers.create}</h2>
        {canCreate ? <CreateOrganizationForm t={t} /> : <InfoNote>{t.customers.noPermissionCreate}</InfoNote>}
      </section>
      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>{t.common.name}</th>
              <th>Slug</th>
              <th>{t.common.status}</th>
              <th>{t.common.created}</th>
            </tr>
          </thead>
          <tbody>
            {organizations.length === 0 ? (
              <tr><td colSpan={4} className="text-slate-500">{t.common.none}</td></tr>
            ) : (
              organizations.map((o) => (
                <tr key={o.id}>
                  <td><Link className="font-medium text-brand-700 hover:underline dark:text-brand-100" href={`/clientes/${o.id}`}>{o.name}</Link></td>
                  <td className="font-mono text-xs">{o.slug}</td>
                  <td><StatusBadge status={o.status} t={t} /></td>
                  <td>{formatDate(o.createdAt, lang)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
