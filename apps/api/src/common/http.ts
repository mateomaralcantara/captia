import {
  Catch,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  HttpException,
  type ArgumentsHost,
  type CanActivate,
  type ExceptionFilter,
  type ExecutionContext,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { APP_CONFIG, type AppConfig } from "../config.js";
import type { AuthedRequest } from "../auth/auth.guard.js";
import { ProblemError, problemFromDatabaseError } from "./problem.js";

type RequestWithId = Request & { id?: string };

/** Cabeceras de seguridad, identificador de petición y no-cache para todas las respuestas. */
export function securityHeaders(req: RequestWithId, res: Response, next: NextFunction): void {
  const incoming = req.headers["x-request-id"];
  req.id = typeof incoming === "string" && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader("X-Request-Id", req.id);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Cache-Control", "no-store");
  next();
}

/** Convierte cualquier error en application/problem+json sin filtrar detalles internos. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger("HTTP");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<RequestWithId>();
    const res = ctx.getResponse<Response>();

    let problem: ProblemError | null =
      exception instanceof ProblemError ? exception : problemFromDatabaseError(exception);

    if (!problem && exception instanceof NotFoundException) problem = new ProblemError("not_found");
    if (!problem && exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === 400 || status === 413 || status === 415) {
        problem = new ProblemError("validation_failed", "Cuerpo de la petición no válido");
      }
    }
    if (!problem) {
      const message = exception instanceof Error ? `${exception.name}: ${exception.message}` : String(exception);
      this.logger.error(`[${req.id}] ${req.method} ${req.path} → ${message}`);
      problem = new ProblemError("internal_error", `Referencia: ${req.id}`);
    }

    res.status(problem.status).type("application/problem+json").json(problem.toProblem());
  }
}

/**
 * Límite de peticiones en memoria por usuario (o IP si no hay sesión), con una cuota menor para
 * escrituras. Válido para una sola instancia de la API; al escalar horizontalmente se sustituye por
 * Redis (ver docs/architecture/decisions.md).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, { start: number; count: number }>();
  private lastSweep = Date.now();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    const now = Date.now();
    const write = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    const identity = req.auth?.userId ?? `ip:${req.ip ?? "desconocida"}`;
    const limit = write ? this.config.rateLimit.writesPerMinute : this.config.rateLimit.perMinute;
    const key = `${write ? "w" : "r"}:${identity}`;

    if (now - this.lastSweep > 60_000) {
      for (const [k, v] of this.windows) if (now - v.start >= 60_000) this.windows.delete(k);
      this.lastSweep = now;
    }
    let window = this.windows.get(key);
    if (!window || now - window.start >= 60_000) {
      window = { start: now, count: 0 };
      this.windows.set(key, window);
    }
    window.count += 1;
    res.setHeader("RateLimit-Limit", String(limit));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - window.count)));
    if (window.count > limit) {
      res.setHeader("Retry-After", String(Math.ceil((window.start + 60_000 - now) / 1000)));
      throw new ProblemError("rate_limited");
    }
    return true;
  }
}
