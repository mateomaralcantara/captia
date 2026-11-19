// Cookies de sesión y llamadas a Supabase Auth (GoTrue REST). Sin imports de next/headers para que
// también lo use proxy.ts. El navegador nunca ve los tokens: son cookies httpOnly.

export const ACCESS_COOKIE = "captia_at";
export const REFRESH_COOKIE = "captia_rt";
export const ORG_COOKIE = "captia_org";
export const LANG_COOKIE = "captia_lang";
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

export type SessionTokens = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id: string; email?: string; factors?: Factor[] };
};
export type Factor = { id: string; factor_type: string; status: "verified" | "unverified"; friendly_name?: string };

type CookieWriter = { cookies: { set: (name: string, value: string, options: Record<string, unknown>) => unknown } };

export function cookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };
}

export function setSessionCookies(target: CookieWriter, session: SessionTokens) {
  if (session.access_token) {
    // Caduca un minuto antes que el token para renovarlo antes de que la API lo rechace.
    const maxAge = Math.max(60, (session.expires_in ?? 3600) - 60);
    target.cookies.set(ACCESS_COOKIE, session.access_token, { ...cookieOptions(), maxAge });
  }
  if (session.refresh_token) {
    target.cookies.set(REFRESH_COOKIE, session.refresh_token, { ...cookieOptions(), maxAge: REFRESH_MAX_AGE });
  }
}

export function clearSessionCookies(target: CookieWriter) {
  target.cookies.set(ACCESS_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  target.cookies.set(REFRESH_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}

/** Lee los claims sin verificar la firma: solo para decidir la UI. La API verifica cada token. */
export function decodeClaims(token: string | undefined): { sub?: string; email?: string; aal?: string; exp?: number } | null {
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    return JSON.parse(json) as { sub?: string; email?: string; aal?: string; exp?: number };
  } catch {
    return null;
  }
}

export function authConfig(): { url: string; anonKey: string } | null {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const anonKey = (process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY)?.trim();
  return url && anonKey ? { url, anonKey } : null;
}

export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(reason);
  }
}

/** Llamada a Supabase Auth. `token` = token de acceso del usuario cuando la operación lo requiere. */
export async function gotrue<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const config = authConfig();
  if (!config) throw new AuthError(503, "not_configured");
  const response = await fetch(`${config.url}/auth/v1${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${init.token ?? config.anonKey}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!response) throw new AuthError(503, "unreachable");
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const reason = String(payload.error_code ?? payload.error ?? payload.msg ?? response.status);
    throw new AuthError(response.status, reason);
  }
  return payload as T;
}

export async function refreshSession(refreshToken: string): Promise<SessionTokens | null> {
  try {
    const session = await gotrue<SessionTokens>("/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: refreshToken },
    });
    return session.access_token ? session : null;
  } catch {
    return null;
  }
}
