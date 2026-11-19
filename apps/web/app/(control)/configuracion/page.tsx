import type { Metadata } from "next";
import { ErrorNote, PageHeader, StatusBadge } from "@/components/ui";
import { errorMessage } from "@/lib/i18n";
import { api, errorCode, getLang } from "@/lib/server";

export const metadata: Metadata = { title: "Configuración" };

export default async function SettingsPage() {
  const { t } = await getLang();
  const client = await api();
  let health, catalog;
  try {
    [health, catalog] = await Promise.all([client.health(), client.serviceCatalog()]);
  } catch (error) {
    return <ErrorNote message={errorMessage(t, errorCode(error))} />;
  }

  return (
    <>
      <PageHeader title={t.settings.title} />
      <section className="card mb-8 max-w-2xl">
        <h2 className="mb-3 font-semibold">{t.settings.apiHealth} · v{health.version}</h2>
        <ul className="space-y-2 text-sm">
          {Object.entries(health.checks).map(([name, check]) => (
            <li key={name} className="flex items-center justify-between gap-4">
              <span className="font-mono">{name}</span>
              <span className="flex items-center gap-2">
                {check.detail ? <span className="text-xs text-slate-500">{check.detail}</span> : null}
                <StatusBadge status={check.status} t={t} />
              </span>
            </li>
          ))}
        </ul>
      </section>
      <h2 className="mb-3 text-lg font-semibold">{t.settings.catalog}</h2>
      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr><th>Clave</th><th>{t.common.name}</th><th>{t.common.status}</th><th>{t.settings.delivery}</th></tr>
          </thead>
          <tbody>
            {catalog.data.map((s) => (
              <tr key={s.key}>
                <td className="font-mono text-xs">{s.key}</td>
                <td>{s.name}</td>
                <td><StatusBadge status={s.status} t={t} /></td>
                <td>{s.delivery ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
