import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import {
  AddMemberSchema,
  CreateOrganizationSchema,
  IdempotencyKeySchema,
  PageQuerySchema,
  UpdateMemberSchema,
  UpdateOrganizationSchema,
  type Health,
} from "@captia/validation";
import { z } from "zod";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { Public, authOf, type AuthedRequest } from "../auth/auth.guard.js";
import { parseId, parseInput } from "../common/validation.js";
import { DatabaseService } from "../database.service.js";
import { SupabaseAdminAdapter } from "../supabase-admin.adapter.js";
import { buildOpenApiDocument } from "../openapi.js";
import { CoreService } from "./core.service.js";

@Controller("v1")
export class SystemController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SupabaseAdminAdapter) private readonly supabaseAdmin: SupabaseAdminAdapter,
    @Inject(CoreService) private readonly core: CoreService,
  ) {}

  /** Salud con comprobaciones reales. 503 si la base de datos no responde. */
  @Public()
  @Get("health")
  async health(@Res({ passthrough: true }) res: Response): Promise<Health> {
    const diag = await this.db.diagnose();
    const ok = diag.database.ok && diag.migrations.ok;
    const health: Health = {
      status: ok ? "ok" : "degraded",
      version: this.config.version,
      checks: {
        database: diag.database.ok ? { status: "ok" } : { status: "fail", detail: diag.database.detail ?? "" },
        migrations: diag.migrations.ok ? { status: "ok" } : { status: "fail", ...(diag.migrations.detail ? { detail: diag.migrations.detail } : {}) },
        auth: {
          status: "ok",
          detail: this.config.supabase.jwtSecret ? "JWT HS256 + JWKS" : "JWKS de Supabase",
        },
        invitations: this.supabaseAdmin.configured
          ? { status: "ok" }
          : { status: "not_configured", detail: "Falta SUPABASE_SERVICE_ROLE_KEY" },
      },
    };
    if (!ok) res.status(503);
    return health;
  }

  @Public()
  @Get("service-catalog")
  async serviceCatalog() {
    return { data: await this.core.serviceCatalogPublic() };
  }

  @Public()
  @Get("openapi.json")
  openapi() {
    return buildOpenApiDocument(this.config);
  }

  @Get("me")
  me(@Req() req: AuthedRequest) {
    return this.core.me(authOf(req));
  }

  @Get("permissions")
  async permissions(@Req() req: AuthedRequest) {
    return { data: await this.core.permissions(authOf(req)) };
  }

  @Get("dashboard/summary")
  dashboard(@Req() req: AuthedRequest, @Query("organizationId") organizationId?: string) {
    return this.core.dashboard(authOf(req), organizationId ? parseId(organizationId, "organization_not_found") : null);
  }

  @Get("platform/audit-events")
  async platformAudit(@Req() req: AuthedRequest, @Query() query: unknown) {
    return { data: await this.core.platformAudit(authOf(req), parseInput(PageQuerySchema, query)) };
  }
}

const optionalIdempotencyKey = z.union([IdempotencyKeySchema, z.undefined()]);

@Controller("v1/organizations")
export class OrganizationsController {
  constructor(@Inject(CoreService) private readonly core: CoreService) {}

  @Get()
  async list(@Req() req: AuthedRequest) {
    return { data: await this.core.listOrganizations(authOf(req)) };
  }

  @Post()
  @HttpCode(201)
  create(@Req() req: AuthedRequest, @Body() body: unknown, @Headers("idempotency-key") idempotencyKey?: string) {
    const input = parseInput(CreateOrganizationSchema, body);
    const key = parseInput(optionalIdempotencyKey, idempotencyKey);
    return this.core.createOrganization(authOf(req), input, key ?? null);
  }

  @Get(":id")
  get(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.core.getOrganization(authOf(req), parseId(id, "organization_not_found"));
  }

  @Patch(":id")
  update(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.core.updateOrganization(authOf(req), parseId(id, "organization_not_found"), parseInput(UpdateOrganizationSchema, body));
  }

  @Get(":id/members")
  async members(@Req() req: AuthedRequest, @Param("id") id: string) {
    return { data: await this.core.listMembers(authOf(req), parseId(id, "organization_not_found")) };
  }

  @Post(":id/members")
  @HttpCode(201)
  addMember(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.core.addMember(authOf(req), parseId(id, "organization_not_found"), parseInput(AddMemberSchema, body));
  }

  @Patch(":id/members/:memberId")
  updateMember(@Req() req: AuthedRequest, @Param("id") id: string, @Param("memberId") memberId: string, @Body() body: unknown) {
    return this.core.updateMember(
      authOf(req),
      parseId(id, "organization_not_found"),
      parseId(memberId, "member_not_found"),
      parseInput(UpdateMemberSchema, body),
    );
  }

  @Delete(":id/members/:memberId")
  @HttpCode(204)
  async removeMember(@Req() req: AuthedRequest, @Param("id") id: string, @Param("memberId") memberId: string) {
    await this.core.removeMember(authOf(req), parseId(id, "organization_not_found"), parseId(memberId, "member_not_found"));
  }

  @Get(":id/roles")
  async roles(@Req() req: AuthedRequest, @Param("id") id: string) {
    return { data: await this.core.listRoles(authOf(req), parseId(id, "organization_not_found")) };
  }

  @Get(":id/audit-events")
  async audit(@Req() req: AuthedRequest, @Param("id") id: string, @Query() query: unknown) {
    return {
      data: await this.core.organizationAudit(authOf(req), parseId(id, "organization_not_found"), parseInput(PageQuerySchema, query)),
    };
  }
}
