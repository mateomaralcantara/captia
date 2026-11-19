import type { z } from "zod";
import { ProblemError } from "./problem.js";

/** Valida una entrada con zod y responde 422 con la lista de errores si no es válida. */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ProblemError(
      "validation_failed",
      undefined,
      result.error.issues.map((issue) => ({ path: issue.path.join(".") || "(raíz)", message: issue.message })),
    );
  }
  return result.data;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un identificador mal formado en la ruta se responde como 404 (no revela nada). */
export function parseId(value: string, code: "not_found" | "organization_not_found" | "member_not_found" = "not_found"): string {
  if (!UUID_RE.test(value)) throw new ProblemError(code);
  return value.toLowerCase();
}
