import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE, clearSessionCookies, refreshSession, setSessionCookies } from "./lib/session";

/**
 * Protege el panel: sin token de acceso intenta renovarlo con el refresh token; si no puede,
 * redirige a /login. La autorización real la hace la API en cada petición.
 */
export async function proxy(request: NextRequest) {
  if (request.cookies.get(ACCESS_COOKIE)?.value) return NextResponse.next();

  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  const session = refreshToken ? await refreshSession(refreshToken) : null;
  if (session?.access_token) {
    request.cookies.set(ACCESS_COOKIE, session.access_token);
    const response = NextResponse.next({ request: { headers: request.headers } });
    setSessionCookies(response, session);
    return response;
  }

  const login = new URL("/login", request.url);
  const response = NextResponse.redirect(login);
  if (refreshToken) clearSessionCookies(response);
  return response;
}

export const config = {
  // Todo excepto login/logout, recursos estáticos y archivos de Next.
  matcher: ["/((?!login|logout|registro|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
