/**
 * Contratos compartidos de CAPTIA OS: esquemas de entrada/salida (zod), tipos inferidos,
 * catálogo de permisos y códigos de error. La API valida con estos esquemas, la web los usa para
 * tipar el cliente y la especificación OpenAPI se genera a partir de ellos.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Permisos y roles (deben coincidir con supabase/migrations/*_core.sql)
// ---------------------------------------------------------------------------

export const PLATFORM_PERMISSIONS = [
  "platform.organizations.create",
  "platform.organizations.suspend",
  "platform.users.read",
  "platform.audit.read",
  "platform.dashboard.read",
] as const;

export const ORGANIZATION_PERMISSIONS = [
  "organization.read",
  "organization.update",
  "members.read",
  "members.manage",
  "roles.read",
  "audit.read",
  "dashboard.read",
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];
export type OrganizationPermission = (typeof ORGANIZATION_PERMISSIONS)[number];
export type Permission = PlatformPermission | OrganizationPermission;

export const SYSTEM_ROLE_KEYS = ["org_admin", "supervisor", "operator", "user", "auditor"] as const;
export const PLATFORM_ROLE_KEYS = ["superadmin", "platform_admin", "platform_auditor"] as const;

// ---------------------------------------------------------------------------
// Errores (application/problem+json, RFC 9457)
// ---------------------------------------------------------------------------

export const ERROR_CODES = {
  unauthenticated: 401,
  mfa_required: 401,
  forbidden: 403,
  cannot_grant_role: 403,
  not_found: 404,
  organization_not_found: 404,
  member_not_found: 404,
  user_not_found: 404,
  role_not_found: 404,
  conflict: 409,
  slug_taken: 409,
  already_member: 409,
  last_admin: 409,
  validation_failed: 422,
  invalid_organization: 422,
  invalid_status: 422,
  role_from_other_organization: 422,
  rate_limited: 429,
  internal_error: 500,
  service_unavailable: 503,
  not_configured: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type Problem = z.infer<typeof ProblemSchema>;

// ---------------------------------------------------------------------------
// Primitivos
// ---------------------------------------------------------------------------

export const UuidSchema = z.uuid();
export const SlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$/, "Solo minúsculas, números y guiones (máx. 48)");
export const RoleKeySchema = z.string().trim().regex(/^[a-z_]+$/).max(64);
export const IdempotencyKeySchema = z.string().trim().min(8).max(200);

export const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.iso.datetime({ offset: true }).optional(),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

// ---------------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------------

export const CreateOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: SlugSchema,
  addCreatorAsMember: z.boolean().default(true),
});
export type CreateOrganizationInput = z.input<typeof CreateOrganizationSchema>;

export const UpdateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    status: z.enum(["active", "suspended"]).optional(),
  })
  .refine((v) => v.name !== undefined || v.status !== undefined, "Indica al menos un campo");
export type UpdateOrganizationInput = z.input<typeof UpdateOrganizationSchema>;

export const AddMemberSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  roleKey: RoleKeySchema,
  invite: z.boolean().default(false),
});
export type AddMemberInput = z.input<typeof AddMemberSchema>;

export const UpdateMemberSchema = z
  .object({
    roleKey: RoleKeySchema.optional(),
    status: z.enum(["active", "suspended"]).optional(),
  })
  .refine((v) => v.roleKey !== undefined || v.status !== undefined, "Indica al menos un campo");
export type UpdateMemberInput = z.input<typeof UpdateMemberSchema>;

// ---------------------------------------------------------------------------
// Salidas
// ---------------------------------------------------------------------------

export const OrganizationSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  slug: z.string(),
  status: z.enum(["active", "suspended"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

export const MemberSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  userId: UuidSchema,
  email: z.string(),
  displayName: z.string().nullable(),
  roleKey: z.string(),
  roleName: z.string(),
  status: z.enum(["active", "suspended"]),
  createdAt: z.string(),
});
export type Member = z.infer<typeof MemberSchema>;

export const RoleSchema = z.object({
  id: UuidSchema,
  key: z.string(),
  name: z.string(),
  description: z.string(),
  isSystem: z.boolean(),
  permissions: z.array(z.string()),
});
export type Role = z.infer<typeof RoleSchema>;

export const PermissionSchema = z.object({
  key: z.string(),
  scope: z.enum(["platform", "organization"]),
  description: z.string(),
});
export type PermissionInfo = z.infer<typeof PermissionSchema>;

export const MembershipSchema = z.object({
  organizationId: UuidSchema,
  organizationName: z.string(),
  organizationSlug: z.string(),
  organizationStatus: z.enum(["active", "suspended"]),
  roleKey: z.string(),
  roleName: z.string(),
  status: z.enum(["active", "suspended"]),
  permissions: z.array(z.string()),
});
export type Membership = z.infer<typeof MembershipSchema>;

export const MeSchema = z.object({
  userId: UuidSchema,
  email: z.string(),
  displayName: z.string().nullable(),
  aal: z.enum(["aal1", "aal2"]),
  mfaRequiredForAdmins: z.boolean(),
  platformRoles: z.array(z.string()),
  platformPermissions: z.array(z.string()),
  memberships: z.array(MembershipSchema),
});
export type Me = z.infer<typeof MeSchema>;

export const AuditEventSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema.nullable(),
  actorUserId: UuidSchema.nullable(),
  actorEmail: z.string().nullable(),
  actorType: z.enum(["user", "system", "api_key", "agent"]),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: UuidSchema.nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const SERVICE_STATUSES = [
  "implemented",
  "pending_infrastructure",
  "pending_authorization",
  "experimental",
  "unavailable",
] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export const ServiceCatalogEntrySchema = z.object({
  key: z.string(),
  product: z.enum(["control", "phone", "voice", "mail", "id", "ai"]),
  name: z.string(),
  status: z.enum(SERVICE_STATUSES),
  statusReason: z.string(),
  delivery: z.string().nullable(),
  updatedAt: z.string(),
});
export type ServiceCatalogEntry = z.infer<typeof ServiceCatalogEntrySchema>;

export const PlatformSummarySchema = z.object({
  scope: z.literal("platform"),
  organizationsTotal: z.number().int(),
  organizationsActive: z.number().int(),
  organizationsSuspended: z.number().int(),
  usersTotal: z.number().int(),
  platformAdmins: z.number().int(),
  membershipsActive: z.number().int(),
  auditEvents24h: z.number().int(),
});
export const OrganizationSummarySchema = z.object({
  scope: z.literal("organization"),
  organizationId: UuidSchema,
  membersTotal: z.number().int(),
  membersActive: z.number().int(),
  customRoles: z.number().int(),
  auditEvents24h: z.number().int(),
});
export const DashboardSummarySchema = z.object({
  summary: z.discriminatedUnion("scope", [PlatformSummarySchema, OrganizationSummarySchema]),
  services: z.array(ServiceCatalogEntrySchema),
  generatedAt: z.string(),
});
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;

export const HealthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  checks: z.record(z.string(), z.object({ status: z.enum(["ok", "fail", "not_configured"]), detail: z.string().optional() })),
  version: z.string(),
});
export type Health = z.infer<typeof HealthSchema>;

export function listOf<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item) });
}
