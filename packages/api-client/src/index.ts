/**
 * Cliente tipado de la API de CAPTIA (v1). Valida cada respuesta con los esquemas compartidos, de
 * modo que una divergencia entre API y cliente falla de forma explícita en lugar de mostrar datos
 * incorrectos.
 */
import {
  AuditEventSchema,
  DashboardSummarySchema,
  HealthSchema,
  MeSchema,
  MemberSchema,
  OrganizationSchema,
  PermissionSchema,
  ProblemSchema,
  RoleSchema,
  ServiceCatalogEntrySchema,
  listOf,
  type AddMemberInput,
  type CreateOrganizationInput,
  type Problem,
  type UpdateMemberInput,
  type UpdateOrganizationInput,
} from "@captia/validation";
import type { z } from "zod";

export class CaptiaApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem,
  ) {
    super(problem.detail ?? problem.title);
    this.name = "CaptiaApiError";
  }

  get code(): string {
    return this.problem.code;
  }
}

export interface CaptiaApiClientOptions {
  baseUrl: string;
  /** Token de acceso de Supabase Auth del usuario (sin "Bearer "). */
  accessToken?: string | null;
  fetch?: typeof fetch;
  /** Cabeceras extra (p. ej. X-Request-Id). */
  headers?: Record<string, string>;
}

type Query = Record<string, string | number | undefined>;

export class CaptiaApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: CaptiaApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  // --- Sistema ---------------------------------------------------------------
  health() {
    return this.request("GET", "/v1/health", HealthSchema, { allowError: true });
  }
  serviceCatalog() {
    return this.request("GET", "/v1/service-catalog", listOf(ServiceCatalogEntrySchema));
  }
  me() {
    return this.request("GET", "/v1/me", MeSchema);
  }
  permissions() {
    return this.request("GET", "/v1/permissions", listOf(PermissionSchema));
  }
  dashboard(organizationId?: string) {
    return this.request("GET", "/v1/dashboard/summary", DashboardSummarySchema, { query: { organizationId } });
  }

  // --- Organizaciones -------------------------------------------------------
  listOrganizations() {
    return this.request("GET", "/v1/organizations", listOf(OrganizationSchema));
  }
  getOrganization(id: string) {
    return this.request("GET", `/v1/organizations/${encodeURIComponent(id)}`, OrganizationSchema);
  }
  createOrganization(input: CreateOrganizationInput, idempotencyKey?: string) {
    return this.request("POST", "/v1/organizations", OrganizationSchema, {
      body: input,
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    });
  }
  updateOrganization(id: string, input: UpdateOrganizationInput) {
    return this.request("PATCH", `/v1/organizations/${encodeURIComponent(id)}`, OrganizationSchema, { body: input });
  }

  // --- Miembros y roles -----------------------------------------------------
  listMembers(organizationId: string) {
    return this.request("GET", `/v1/organizations/${encodeURIComponent(organizationId)}/members`, listOf(MemberSchema));
  }
  addMember(organizationId: string, input: AddMemberInput) {
    return this.request("POST", `/v1/organizations/${encodeURIComponent(organizationId)}/members`, MemberSchema, { body: input });
  }
  updateMember(organizationId: string, memberId: string, input: UpdateMemberInput) {
    return this.request(
      "PATCH",
      `/v1/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(memberId)}`,
      MemberSchema,
      { body: input },
    );
  }
  async removeMember(organizationId: string, memberId: string): Promise<void> {
    await this.request(
      "DELETE",
      `/v1/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(memberId)}`,
      null,
    );
  }
  listRoles(organizationId: string) {
    return this.request("GET", `/v1/organizations/${encodeURIComponent(organizationId)}/roles`, listOf(RoleSchema));
  }

  // --- Auditoría -------------------------------------------------------------
  organizationAudit(organizationId: string, query: { limit?: number; before?: string } = {}) {
    return this.request("GET", `/v1/organizations/${encodeURIComponent(organizationId)}/audit-events`, listOf(AuditEventSchema), {
      query,
    });
  }
  platformAudit(query: { limit?: number; before?: string } = {}) {
    return this.request("GET", "/v1/platform/audit-events", listOf(AuditEventSchema), { query });
  }

  // --- Núcleo ---------------------------------------------------------------
  private async request<S extends z.ZodType>(
    method: string,
    path: string,
    schema: S,
    opts?: { body?: unknown; query?: Query; headers?: Record<string, string> | undefined; allowError?: boolean },
  ): Promise<z.infer<S>>;
  private async request(
    method: string,
    path: string,
    schema: null,
    opts?: { body?: unknown; query?: Query; headers?: Record<string, string> | undefined },
  ): Promise<undefined>;
  private async request(
    method: string,
    path: string,
    schema: z.ZodType | null,
    opts: { body?: unknown; query?: Query; headers?: Record<string, string> | undefined; allowError?: boolean } = {},
  ): Promise<unknown> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { Accept: "application/json", ...this.options.headers, ...opts.headers };
    if (this.options.accessToken) headers.Authorization = `Bearer ${this.options.accessToken}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    const response = await this.fetchImpl(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: "no-store",
    });

    if (response.status === 204) return undefined;
    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok && !(opts.allowError && schema?.safeParse(payload).success)) {
      const problem = ProblemSchema.safeParse(payload);
      throw new CaptiaApiError(
        response.status,
        problem.success
          ? problem.data
          : { type: "about:blank", title: "Error de la API", status: response.status, code: "internal_error" },
      );
    }
    if (!schema) return undefined;
    return schema.parse(payload);
  }
}
