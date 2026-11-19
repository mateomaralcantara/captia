import {
  AddMemberSchema,
  AuditEventSchema,
  CreateOrganizationSchema,
  DashboardSummarySchema,
  HealthSchema,
  MeSchema,
  MemberSchema,
  OrganizationSchema,
  PermissionSchema,
  ProblemSchema,
  RoleSchema,
  ServiceCatalogEntrySchema,
  UpdateMemberSchema,
  UpdateOrganizationSchema,
  listOf,
} from "@captia/validation";
import { z } from "zod";
import type { AppConfig } from "./config.js";

interface RouteDoc {
  method: "get" | "post" | "patch" | "delete";
  path: string;
  summary: string;
  tag: string;
  public?: boolean;
  body?: z.ZodType;
  response?: z.ZodType;
  status?: number;
  query?: Record<string, { schema: object; description: string }>;
  idempotent?: boolean;
}

const pageQuery = {
  limit: { schema: { type: "integer", minimum: 1, maximum: 100, default: 50 }, description: "Tamaño de página" },
  before: { schema: { type: "string", format: "date-time" }, description: "Cursor: eventos anteriores a esta fecha" },
};

/** Registro de rutas de la API v1. Debe mantenerse alineado con los controladores (lo comprueba una prueba). */
export const ROUTES: RouteDoc[] = [
  { method: "get", path: "/v1/health", summary: "Estado de la API y sus dependencias", tag: "Sistema", public: true, response: HealthSchema },
  { method: "get", path: "/v1/service-catalog", summary: "Estado declarado de cada servicio de CAPTIA", tag: "Sistema", public: true, response: listOf(ServiceCatalogEntrySchema) },
  { method: "get", path: "/v1/openapi.json", summary: "Esta especificación", tag: "Sistema", public: true },
  { method: "get", path: "/v1/me", summary: "Usuario actual, roles de plataforma y membresías", tag: "Identidad", response: MeSchema },
  { method: "get", path: "/v1/permissions", summary: "Catálogo de permisos", tag: "Identidad", response: listOf(PermissionSchema) },
  {
    method: "get", path: "/v1/dashboard/summary", summary: "Resumen con datos reales (plataforma u organización)", tag: "Resumen",
    response: DashboardSummarySchema,
    query: { organizationId: { schema: { type: "string", format: "uuid" }, description: "Sin él: resumen de plataforma (requiere permiso de plataforma)" } },
  },
  { method: "get", path: "/v1/platform/audit-events", summary: "Auditoría de toda la plataforma", tag: "Auditoría", response: listOf(AuditEventSchema), query: pageQuery },
  { method: "get", path: "/v1/organizations", summary: "Organizaciones visibles para el usuario", tag: "Organizaciones", response: listOf(OrganizationSchema) },
  { method: "post", path: "/v1/organizations", summary: "Crear organización", tag: "Organizaciones", body: CreateOrganizationSchema, response: OrganizationSchema, status: 201, idempotent: true },
  { method: "get", path: "/v1/organizations/{id}", summary: "Detalle de organización", tag: "Organizaciones", response: OrganizationSchema },
  { method: "patch", path: "/v1/organizations/{id}", summary: "Editar o suspender organización", tag: "Organizaciones", body: UpdateOrganizationSchema, response: OrganizationSchema },
  { method: "get", path: "/v1/organizations/{id}/members", summary: "Miembros", tag: "Miembros", response: listOf(MemberSchema) },
  { method: "post", path: "/v1/organizations/{id}/members", summary: "Añadir miembro (o invitar por correo)", tag: "Miembros", body: AddMemberSchema, response: MemberSchema, status: 201 },
  { method: "patch", path: "/v1/organizations/{id}/members/{memberId}", summary: "Cambiar rol o estado de un miembro", tag: "Miembros", body: UpdateMemberSchema, response: MemberSchema },
  { method: "delete", path: "/v1/organizations/{id}/members/{memberId}", summary: "Quitar miembro", tag: "Miembros", status: 204 },
  { method: "get", path: "/v1/organizations/{id}/roles", summary: "Roles disponibles y sus permisos", tag: "Miembros", response: listOf(RoleSchema) },
  { method: "get", path: "/v1/organizations/{id}/audit-events", summary: "Auditoría de la organización", tag: "Auditoría", response: listOf(AuditEventSchema), query: pageQuery },
];

const jsonSchema = (schema: z.ZodType, io: "input" | "output") =>
  z.toJSONSchema(schema, { io, unrepresentable: "any" }) as Record<string, unknown>;

export function buildOpenApiDocument(config: Pick<AppConfig, "version">) {
  const paths: Record<string, Record<string, unknown>> = {};
  const problem = { "application/problem+json": { schema: jsonSchema(ProblemSchema, "output") } };

  for (const route of ROUTES) {
    const params: object[] = [];
    for (const name of route.path.match(/\{(\w+)\}/g) ?? []) {
      params.push({ name: name.slice(1, -1), in: "path", required: true, schema: { type: "string", format: "uuid" } });
    }
    for (const [name, q] of Object.entries(route.query ?? {})) {
      params.push({ name, in: "query", required: false, schema: q.schema, description: q.description });
    }
    if (route.idempotent) {
      params.push({
        name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", minLength: 8, maxLength: 200 },
        description: "Repetir la petición con la misma clave devuelve el mismo recurso sin duplicarlo",
      });
    }
    const status = String(route.status ?? 200);
    const responses: Record<string, unknown> = {
      [status]: route.response
        ? { description: "OK", content: { "application/json": { schema: jsonSchema(route.response, "output") } } }
        : { description: "OK" },
      default: { description: "Error (RFC 9457)", content: problem },
    };
    (paths[route.path] ??= {})[route.method] = {
      summary: route.summary,
      tags: [route.tag],
      ...(route.public ? { security: [] } : {}),
      ...(params.length ? { parameters: params } : {}),
      ...(route.body
        ? { requestBody: { required: true, content: { "application/json": { schema: jsonSchema(route.body, "input") } } } }
        : {}),
      responses,
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "CAPTIA OS API",
      version: config.version,
      description:
        "API del plano de control de CAPTIA OS. Autenticación con el token de acceso de Supabase Auth " +
        "(Authorization: Bearer). Las acciones administrativas exigen una sesión con MFA (aal2).",
    },
    servers: [{ url: "/" }],
    security: [{ bearer: [] }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
    paths,
  };
}
