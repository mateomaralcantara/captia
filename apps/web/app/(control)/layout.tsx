import Link from "next/link";
import { setOrganizationAction, toggleLanguageAction } from "@/app/actions";
import { NavLinks } from "@/components/nav";
import { NAV } from "@/lib/nav";
import { activeOrganizationId, api, currentUser, getLang } from "@/lib/server";
import type { ServiceCatalogEntry } from "@captia/validation";

export default async function ControlLayout({ children }: { children: React.ReactNode }) {
  const { lang, t } = await getLang();
  const me = await currentUser();
  const orgId = await activeOrganizationId(me);
  const catalog: ServiceCatalogEntry[] = await (await api())
    .serviceCatalog()
    .then((r) => r.data)
    .catch(() => []);
  const implemented = new Set(catalog.filter((s) => s.status === "implemented").map((s) => s.key));

  const items = NAV.map((n) => ({
    href: n.href,
    label: t.nav[n.key],
    implemented: !n.catalogKey || implemented.has(n.catalogKey),
  }));
  const activeOrgs = me.memberships.filter((m) => m.organizationStatus === "active");

  return (
    <div className="flex min-h-screen flex-col bg-ink-950 md:flex-row">
      <aside className="w-full shrink-0 bg-ink-950 text-slate-200 md:sticky md:top-0 md:h-screen md:w-64 md:overflow-y-auto">
        <div className="px-5 py-5">
          <Link href="/" className="text-lg font-semibold tracking-tight text-white">
            CAPTIA <span className="text-brand-500">Control</span>
          </Link>
        </div>
        <nav aria-label="Principal" className="px-3 pb-6">
          <NavLinks items={items} pendingLabel={t.status.unavailable} />
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-slate-50 dark:bg-ink-950">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3 dark:border-ink-800 dark:bg-ink-900">
          <div className="flex items-center gap-3 text-sm">
            {activeOrgs.length > 0 ? (
              <form action={setOrganizationAction} className="flex items-center gap-2">
                <label htmlFor="org-switch" className="text-slate-500">{t.common.organization}</label>
                <select key={orgId ?? "none"} id="org-switch" name="organizationId" defaultValue={orgId ?? ""} className="input w-auto py-1">
                  {activeOrgs.map((m) => (
                    <option key={m.organizationId} value={m.organizationId}>{m.organizationName}</option>
                  ))}
                </select>
                <button className="btn-secondary" type="submit">OK</button>
              </form>
            ) : null}
            {me.platformRoles.length > 0 ? (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-ink-800 dark:text-brand-100">
                {t.common.platform}: {me.platformRoles.join(", ")}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500" title={me.aal}>
              {me.email} · {me.aal === "aal2" ? "MFA ✓" : "MFA —"}
            </span>
            <form action={toggleLanguageAction}>
              <input type="hidden" name="lang" value={lang === "es" ? "en" : "es"} />
              <button className="btn-secondary" type="submit">{t.common.language}</button>
            </form>
            <form action="/logout" method="post">
              <button className="btn-secondary" type="submit">{t.common.logout}</button>
            </form>
          </div>
        </header>
        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
