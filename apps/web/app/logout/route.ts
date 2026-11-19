import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, clearSessionCookies, gotrue } from "@/lib/session";

async function logout(request: NextRequest) {
  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  // Revoca la sesión en Supabase Auth (si falla, igualmente se borran las cookies locales).
  if (token) await gotrue("/logout", { method: "POST", token }).catch(() => undefined);
  // Redirección relativa: detrás de un proxy, request.url puede llevar el host interno.
  const response = new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  clearSessionCookies(response);
  return response;
}

// GET se usa cuando la API rechaza un token caducado; solo cierra sesión, no cambia datos.
export const GET = logout;
export const POST = logout;
