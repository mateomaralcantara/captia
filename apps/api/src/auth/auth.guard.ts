import { Inject, Injectable, SetMetadata, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { ProblemError } from "../common/problem.js";
import { JwtVerifier, type AuthContext } from "./jwt-verifier.js";

const PUBLIC_KEY = "captia:public";
/** Marca una ruta como accesible sin autenticación (salud, catálogo de servicios, OpenAPI). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export type AuthedRequest = Request & { auth?: AuthContext };

/** Guard global: toda ruta exige un JWT válido de Supabase salvo las marcadas con @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtVerifier) private readonly verifier: JwtVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const header = request.headers.authorization ?? "";
    const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/.exec(header);
    if (!match?.[1]) throw new ProblemError("unauthenticated");
    request.auth = await this.verifier.verify(match[1]);
    return true;
  }
}

export function authOf(request: AuthedRequest): AuthContext {
  if (!request.auth) throw new ProblemError("unauthenticated");
  return request.auth;
}
