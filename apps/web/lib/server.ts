import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CaptiaApiClient, CaptiaApiError } from "@captia/api-client";
import type { Me } from "@captia/validation";
import { ACCESS_COOKIE, LANG_COOKIE, ORG_COOKIE, decodeClaims } from "./session";
import { dictionaries, resolveLang, type Dictionary, type Lang } from "./i18n";

export function apiBaseUrl(): string | null {
  return process.env.CAPTIA_API_URL?.trim().replace(/\/+$/, "") || null;
}

export async function getLang(): Promise<{ lang: Lang; t: Dictionary }> {
  const lang = resolveLang((await cookies()).get(LANG_COOKIE)?.value);
  return { lang, t: dictionaries[lang] };
}

export async function accessToken(): Promise<string | undefined> {
  return (await cookies()).get(ACCESS_COOKIE)?.value;
}

export async function sessionClaims() {
  return decodeClaims(await accessToken());
}

/** Cliente de la API con el token del usuario. Redirige a /login si no hay sesión. */
export async function api(): Promise<CaptiaApiClient> {
  const token = await accessToken();
  if (!token) redirect("/login");
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new CaptiaApiError(503, { type: "about:blank", title: "API", status: 503, code: "api_unreachable" });
  return new CaptiaApiClient({
    baseUrl,
    accessToken: token,
    fetch: (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }).catch(() => {
        throw new CaptiaApiError(503, { type: "about:blank", title: "API", status: 503, code: "api_unreachable" });
      }),
  });
}

/** Usuario actual; si el token ya no es válido, vuelve al login. */
export async function currentUser(): Promise<Me> {
  try {
    return await (await api()).me();
  } catch (error) {
    if (error instanceof CaptiaApiError && error.status === 401) redirect("/logout");
    throw error;
  }
}

/** Organización activa: la de la cookie si el usuario pertenece a ella; si no, la primera. */
export async function activeOrganizationId(me: Me): Promise<string | null> {
  const chosen = (await cookies()).get(ORG_COOKIE)?.value;
  const ids = me.memberships.filter((m) => m.organizationStatus === "active").map((m) => m.organizationId);
  if (chosen && ids.includes(chosen)) return chosen;
  return ids[0] ?? null;
}

export function hasPlatform(me: Me, permission: string): boolean {
  return me.platformPermissions.includes(permission);
}

export function hasOrg(me: Me, organizationId: string, permission: string): boolean {
  if (hasPlatform(me, permission)) return true;
  const m = me.memberships.find((x) => x.organizationId === organizationId);
  return Boolean(m && m.status === "active" && m.organizationStatus === "active" && m.permissions.includes(permission));
}

export function errorCode(error: unknown): string {
  return error instanceof CaptiaApiError ? error.code : "generic";
}
