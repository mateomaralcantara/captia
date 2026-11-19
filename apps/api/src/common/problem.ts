import { ERROR_CODES, type ErrorCode, type Problem } from "@captia/validation";

const TITLES: Record<ErrorCode, string> = {
  unauthenticated: "Autenticación requerida",
  mfa_required: "Se requiere verificación en dos pasos",
  forbidden: "No tienes permiso para esta acción",
  cannot_grant_role: "No puedes conceder un rol con más permisos que los tuyos",
  not_found: "Recurso no encontrado",
  organization_not_found: "Organización no encontrada",
  member_not_found: "Miembro no encontrado",
  user_not_found: "Usuario no encontrado",
  role_not_found: "Rol no encontrado",
  conflict: "Conflicto con el estado actual",
  slug_taken: "Ese identificador ya está en uso",
  already_member: "El usuario ya es miembro de la organización",
  last_admin: "La organización debe conservar al menos un administrador activo",
  validation_failed: "Datos no válidos",
  invalid_organization: "Datos de organización no válidos",
  invalid_status: "Estado no válido",
  role_from_other_organization: "El rol pertenece a otra organización",
  rate_limited: "Demasiadas solicitudes",
  internal_error: "Error interno",
  service_unavailable: "Servicio no disponible",
  not_configured: "Integración pendiente de configuración",
};

/** Error de dominio que se responde como application/problem+json. */
export class ProblemError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    readonly detail?: string,
    readonly errors?: Problem["errors"],
  ) {
    super(detail ?? TITLES[code]);
    this.status = ERROR_CODES[code];
  }

  toProblem(): Problem {
    return {
      type: `https://captia.dev/problems/${this.code}`,
      title: TITLES[this.code],
      status: this.status,
      code: this.code,
      ...(this.detail ? { detail: this.detail } : {}),
      ...(this.errors ? { errors: this.errors } : {}),
    };
  }
}

function isErrorCode(value: string): value is ErrorCode {
  return Object.hasOwn(ERROR_CODES, value);
}

/**
 * Traduce errores de PostgreSQL a errores de dominio. Las funciones SQL de CAPTIA lanzan SQLSTATE
 * propios (CA401/403/404/409/422) con la clave del error como mensaje. Devuelve null si el error no
 * es reconocible: entonces se trata como error interno (y no se filtra su mensaje).
 */
export function problemFromDatabaseError(error: unknown): ProblemError | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = String((error as { code: unknown }).code);
  const message = String((error as { message?: unknown }).message ?? "").split(":")[0]!.trim();

  if (/^CA4\d\d$/.test(code)) {
    if (isErrorCode(message)) return new ProblemError(message);
    const fallback: Record<string, ErrorCode> = {
      CA401: "mfa_required",
      CA403: "forbidden",
      CA404: "not_found",
      CA409: "conflict",
      CA422: "validation_failed",
    };
    return new ProblemError(fallback[code] ?? "internal_error");
  }
  switch (code) {
    case "42501": // insufficient_privilege
      return new ProblemError("forbidden");
    case "23505": // unique_violation
      return new ProblemError("conflict");
    case "22P02": // invalid_text_representation (p. ej. UUID mal formado)
      return new ProblemError("not_found");
    default:
      return null;
  }
}
