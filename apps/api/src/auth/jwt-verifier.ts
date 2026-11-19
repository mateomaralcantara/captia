import { createRemoteJWKSet, decodeProtectedHeader, errors, jwtVerify, type JWTPayload } from "jose";
import type { AppConfig } from "../config.js";
import { ProblemError } from "../common/problem.js";

export interface AuthContext {
  userId: string;
  email: string | null;
  aal: "aal1" | "aal2";
  /** Claims completos del JWT verificado; se pasan a Postgres como request.jwt.claims. */
  claims: JWTPayload & Record<string, unknown>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verifica los JWT de acceso emitidos por Supabase Auth:
 *  - HS256 con el secreto heredado del proyecto (SUPABASE_JWT_SECRET), o
 *  - RS256/ES256 con las claves públicas del proyecto (JWKS), el modo recomendado actual.
 * Exige emisor, audiencia `authenticated`, expiración, `sub` UUID y rol `authenticated`.
 */
export class JwtVerifier {
  private readonly secret?: Uint8Array;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: AppConfig["supabase"]) {
    if (config.jwtSecret) this.secret = new TextEncoder().encode(config.jwtSecret);
    this.jwks = createRemoteJWKSet(new URL(config.jwksUrl), { cooldownDuration: 30_000, cacheMaxAge: 600_000 });
  }

  async verify(token: string): Promise<AuthContext> {
    let payload: JWTPayload;
    try {
      const { alg } = decodeProtectedHeader(token);
      const options = { issuer: this.config.issuer, audience: "authenticated", clockTolerance: 5 };
      if (alg === "HS256") {
        if (!this.secret) throw new ProblemError("unauthenticated", "Algoritmo de token no aceptado");
        ({ payload } = await jwtVerify(token, this.secret, { ...options, algorithms: ["HS256"] }));
      } else {
        ({ payload } = await jwtVerify(token, this.jwks, { ...options, algorithms: ["RS256", "ES256"] }));
      }
    } catch (error) {
      if (error instanceof ProblemError) throw error;
      if (error instanceof errors.JWTExpired) throw new ProblemError("unauthenticated", "La sesión ha caducado");
      throw new ProblemError("unauthenticated", "Token no válido");
    }

    if (typeof payload.sub !== "string" || !UUID_RE.test(payload.sub)) {
      throw new ProblemError("unauthenticated", "Token sin usuario");
    }
    if (payload.role !== "authenticated") {
      throw new ProblemError("unauthenticated", "Token sin rol de usuario");
    }
    return {
      userId: payload.sub.toLowerCase(),
      email: typeof payload.email === "string" ? payload.email : null,
      aal: payload.aal === "aal2" ? "aal2" : "aal1",
      claims: payload as AuthContext["claims"],
    };
  }
}
