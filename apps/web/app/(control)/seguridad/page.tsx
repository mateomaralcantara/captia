import type { Metadata } from "next";
import { EnrollMfa } from "@/components/forms";
import { InfoNote, PageHeader } from "@/components/ui";
import { accessToken, currentUser, getLang } from "@/lib/server";
import { gotrue, type Factor } from "@/lib/session";

export const metadata: Metadata = { title: "Seguridad" };

export default async function SecurityPage() {
  const { t } = await getLang();
  const me = await currentUser();
  const token = await accessToken();
  const factors = token
    ? await gotrue<{ factors?: Factor[] }>("/user", { token }).then((u) => u.factors ?? []).catch(() => [])
    : [];
  const verified = factors.some((f) => f.factor_type === "totp" && f.status === "verified");

  return (
    <>
      <PageHeader title={t.security.title} />
      <section className="card max-w-2xl space-y-4">
        <h2 className="font-semibold">{t.security.mfa}</h2>
        <p className="text-sm">
          {t.security.sessionLevel}: <strong>{me.aal}</strong>
        </p>
        {me.aal === "aal2" ? (
          <InfoNote>{t.security.mfaOn}</InfoNote>
        ) : verified ? (
          <InfoNote>{t.security.mfaEnrolled}</InfoNote>
        ) : (
          <>
            <p className="text-sm text-amber-700 dark:text-amber-300">{t.security.mfaOff}</p>
            <EnrollMfa t={t} />
          </>
        )}
      </section>
    </>
  );
}
