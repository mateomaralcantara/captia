"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AddMemberSchema, CreateOrganizationSchema, UpdateMemberSchema, UpdateOrganizationSchema } from "@captia/validation";
import { api, errorCode } from "@/lib/server";
import {
  AuthError,
  LANG_COOKIE,
  ORG_COOKIE,
  ACCESS_COOKIE,
  cookieOptions,
  decodeClaims,
  gotrue,
  setSessionCookies,
  type Factor,
  type SessionTokens,
} from "@/lib/session";

export type ActionState = { ok?: boolean; error?: string; data?: Record<string, string> };

type CookieStore = Awaited<ReturnType<typeof cookies>>;
const writer = (store: CookieStore) => ({ cookies: { set: (n: string, v: string, o: Record<string, unknown>) => store.set(n, v, o) } });

// --- Autenticación -----------------------------------------------------------------

export async function loginAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "invalid" };

  let session: SessionTokens;
  try {
    session = await gotrue<SessionTokens>("/token?grant_type=password", { method: "POST", body: { email, password } });
  } catch (error) {
    if (error instanceof AuthError && error.reason === "not_configured") return { error: "not_configured" };
    if (error instanceof AuthError && error.reason === "unreachable") return { error: "unreachable" };
    return { error: "invalid" };
  }
  const store = await cookies();
  setSessionCookies(writer(store), session);

  const hasVerifiedFactor = (session.user?.factors ?? []).some((f) => f.status === "verified");
  if (hasVerifiedFactor && decodeClaims(session.access_token)?.aal !== "aal2") redirect("/login/mfa");
  redirect("/");
}

async function verifyTotp(factorId: string, code: string, token: string): Promise<SessionTokens> {
  const challenge = await gotrue<{ id: string }>(`/factors/${encodeURIComponent(factorId)}/challenge`, { method: "POST", token, body: {} });
  return gotrue<SessionTokens>(`/factors/${encodeURIComponent(factorId)}/verify`, {
    method: "POST",
    token,
    body: { challenge_id: challenge.id, code },
  });
}

export async function mfaVerifyAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const code = String(form.get("code") ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return { error: "invalidCode" };
  const store = await cookies();
  const token = store.get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");
  try {
    const user = await gotrue<{ factors?: Factor[] }>("/user", { token });
    const factor = (user.factors ?? []).find((f) => f.factor_type === "totp" && f.status === "verified");
    if (!factor) redirect("/");
    setSessionCookies(writer(store), await verifyTotp(factor.id, code, token));
  } catch (error) {
    if (error instanceof AuthError) return { error: "invalidCode" };
    throw error;
  }
  redirect("/");
}

export async function enrollStartAction(): Promise<ActionState> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");
  try {
    const factor = await gotrue<{ id: string; totp: { qr_code: string; secret: string } }>("/factors", {
      method: "POST",
      token,
      body: { factor_type: "totp", friendly_name: `CAPTIA ${new Date().toISOString().slice(0, 16)}` },
    });
    return { ok: true, data: { factorId: factor.id, qr: factor.totp.qr_code, secret: factor.totp.secret } };
  } catch (error) {
    return { error: error instanceof AuthError && error.reason === "not_configured" ? "not_configured" : "generic" };
  }
}

export async function enrollVerifyAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const factorId = String(form.get("factorId") ?? "");
  const code = String(form.get("code") ?? "").replace(/\s+/g, "");
  if (!factorId || !/^\d{6}$/.test(code)) return { error: "invalidCode" };
  const store = await cookies();
  const token = store.get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");
  try {
    setSessionCookies(writer(store), await verifyTotp(factorId, code, token));
  } catch {
    return { error: "invalidCode" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

// --- Preferencias ----------------------------------------------------------------------

export async function setOrganizationAction(form: FormData): Promise<void> {
  const id = String(form.get("organizationId") ?? "");
  if (/^[0-9a-f-]{36}$/i.test(id)) (await cookies()).set(ORG_COOKIE, id, { ...cookieOptions(), maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}

export async function toggleLanguageAction(form: FormData): Promise<void> {
  const lang = form.get("lang") === "en" ? "en" : "es";
  (await cookies()).set(LANG_COOKIE, lang, { ...cookieOptions(), httpOnly: false, maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}

// --- Organizaciones y miembros -----------------------------------------------------

async function run(fn: () => Promise<unknown>, paths: string[]): Promise<ActionState> {
  try {
    await fn();
  } catch (error) {
    return { error: errorCode(error) };
  }
  for (const p of paths) revalidatePath(p);
  return { ok: true };
}

export async function createOrganizationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = CreateOrganizationSchema.safeParse({
    name: form.get("name"),
    slug: form.get("slug"),
    addCreatorAsMember: form.get("addCreatorAsMember") === "on",
  });
  if (!parsed.success) return { error: "validation_failed" };
  // Una clave por envío del formulario: un doble clic no crea dos organizaciones.
  const key = String(form.get("idempotencyKey") || randomUUID());
  const result = await run(async () => (await api()).createOrganization(parsed.data, key), ["/clientes", "/"]);
  return result.ok ? { ok: true, data: { nextKey: randomUUID() } } : result;
}

export async function updateOrganizationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("organizationId") ?? "");
  const parsed = UpdateOrganizationSchema.safeParse({
    name: form.get("name") || undefined,
    status: form.get("status") || undefined,
  });
  if (!parsed.success) return { error: "validation_failed" };
  return run(async () => (await api()).updateOrganization(id, parsed.data), [`/clientes/${id}`, "/clientes"]);
}

export async function addMemberAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("organizationId") ?? "");
  const parsed = AddMemberSchema.safeParse({
    email: form.get("email"),
    roleKey: form.get("roleKey"),
    invite: form.get("invite") === "on",
  });
  if (!parsed.success) return { error: "validation_failed" };
  return run(async () => (await api()).addMember(id, parsed.data), [`/clientes/${id}`]);
}

export async function updateMemberAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("organizationId") ?? "");
  const memberId = String(form.get("memberId") ?? "");
  const parsed = UpdateMemberSchema.safeParse({
    roleKey: form.get("roleKey") || undefined,
    status: form.get("status") || undefined,
  });
  if (!parsed.success) return { error: "validation_failed" };
  return run(async () => (await api()).updateMember(id, memberId, parsed.data), [`/clientes/${id}`]);
}

export async function removeMemberAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("organizationId") ?? "");
  const memberId = String(form.get("memberId") ?? "");
  return run(async () => (await api()).removeMember(id, memberId), [`/clientes/${id}`]);
}
