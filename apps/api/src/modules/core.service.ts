import { Inject, Injectable } from "@nestjs/common";
import type {
  AuditEvent,
  DashboardSummary,
  Me,
  Member,
  Organization,
  PermissionInfo,
  Role,
  ServiceCatalogEntry,
} from "@captia/validation";
import type { AuthContext } from "../auth/jwt-verifier.js";
import { ProblemError } from "../common/problem.js";
import { DatabaseService, type Db } from "../database.service.js";
import { SupabaseAdminAdapter } from "../supabase-admin.adapter.js";

type Row = Record<string, unknown>;

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const num = (v: unknown): number => Number(v ?? 0);

function toOrganization(r: Row): Organization {
  return {
    id: String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    status: r.status as Organization["status"],
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function toMember(r: Row): Member {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    userId: String(r.user_id),
    email: String(r.email ?? ""),
    displayName: (r.display_name as string | null) ?? null,
    roleKey: String(r.role_key),
    roleName: String(r.role_name),
    status: r.status as Member["status"],
    createdAt: iso(r.created_at),
  };
}

function toAuditEvent(r: Row): AuditEvent {
  return {
    id: String(r.id),
    organizationId: (r.organization_id as string | null) ?? null,
    actorUserId: (r.actor_user_id as string | null) ?? null,
    actorEmail: (r.actor_email as string | null) ?? null,
    actorType: r.actor_type as AuditEvent["actorType"],
    action: String(r.action),
    targetType: (r.target_type as string | null) ?? null,
    targetId: (r.target_id as string | null) ?? null,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    createdAt: iso(r.created_at),
  };
}

const MEMBER_SELECT = `
  select m.id, m.organization_id, m.user_id, m.status, m.created_at,
         p.email, p.display_name, r.key as role_key, r.name as role_name
  from core.organization_members m
  join core.organization_roles r on r.id = m.role_id
  left join core.profiles p on p.id = m.user_id`;

const AUDIT_SELECT = `select e.* from core.audit_events e`;

@Injectable()
export class CoreService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SupabaseAdminAdapter) private readonly supabaseAdmin: SupabaseAdminAdapter,
  ) {}

  /** 404 si la organización no es visible para el usuario; 403 si es visible pero falta el permiso. */
  private async requireOrgPermission(db: Db, organizationId: string, permission: string): Promise<void> {
    const { rows } = await db.query(
      `select exists (select 1 from core.organizations where id = $1) as visible,
              core.has_org_permission($1, $2) as allowed`,
      [organizationId, permission],
    );
    const row = rows[0] as { visible: boolean; allowed: boolean };
    if (!row.visible && !row.allowed) throw new ProblemError("organization_not_found");
    if (!row.allowed) throw new ProblemError("forbidden");
  }

  private async requirePlatformPermission(db: Db, permission: string): Promise<void> {
    const { rows } = await db.query("select core.has_platform_permission($1) as allowed", [permission]);
    if (!(rows[0] as { allowed: boolean }).allowed) throw new ProblemError("forbidden");
  }

  // --- Usuario actual -----------------------------------------------------------

  me(auth: AuthContext): Promise<Me> {
    return this.db.asUser(auth, async (db) => {
      const { rows } = await db.query("select core.my_context() as ctx");
      const ctx = rows[0]?.ctx as Row | null;
      if (!ctx) throw new ProblemError("unauthenticated", "El usuario no tiene perfil en CAPTIA");
      return {
        userId: String(ctx.user_id),
        email: String(ctx.email),
        displayName: (ctx.display_name as string | null) ?? null,
        aal: auth.aal,
        mfaRequiredForAdmins: Boolean(ctx.mfa_required_for_admins),
        platformRoles: ctx.platform_roles as string[],
        platformPermissions: ctx.platform_permissions as string[],
        memberships: (ctx.memberships as Row[]).map((m) => ({
          organizationId: String(m.organization_id),
          organizationName: String(m.organization_name),
          organizationSlug: String(m.organization_slug),
          organizationStatus: m.organization_status as "active" | "suspended",
          roleKey: String(m.role_key),
          roleName: String(m.role_name),
          status: m.status as "active" | "suspended",
          permissions: m.permissions as string[],
        })),
      };
    });
  }

  permissions(auth: AuthContext): Promise<PermissionInfo[]> {
    return this.db.asUser(auth, async (db) => {
      const { rows } = await db.query("select key, scope, description from core.permissions order by scope, key");
      return rows as PermissionInfo[];
    });
  }

  serviceCatalogPublic(): Promise<ServiceCatalogEntry[]> {
    // El catálogo es información pública del producto (estado de cada servicio), sin datos de clientes.
    return this.db.pool
      .query(
        `select key, product, name, status, status_reason, delivery, updated_at from core.service_catalog
         order by coalesce(substring(delivery from '[0-9]+')::int, 99), key`,
      )
      .then(({ rows }) =>
        rows.map((r: Row) => ({
          key: String(r.key),
          product: r.product as ServiceCatalogEntry["product"],
          name: String(r.name),
          status: r.status as ServiceCatalogEntry["status"],
          statusReason: String(r.status_reason),
          delivery: (r.delivery as string | null) ?? null,
          updatedAt: iso(r.updated_at),
        })),
      );
  }

  // --- Organizaciones -----------------------------------------------------------

  listOrganizations(auth: AuthContext): Promise<Organization[]> {
    return this.db.asUser(auth, async (db) => {
      const { rows } = await db.query("select * from core.organizations order by name, id");
      return rows.map(toOrganization);
    });
  }

  getOrganization(auth: AuthContext, id: string): Promise<Organization> {
    return this.db.asUser(auth, async (db) => {
      const { rows } = await db.query("select * from core.organizations where id = $1", [id]);
      if (!rows[0]) throw new ProblemError("organization_not_found");
      return toOrganization(rows[0]);
    });
  }

  createOrganization(
    auth: AuthContext,
    input: { name: string; slug: string; addCreatorAsMember: boolean },
    idempotencyKey: string | null,
  ): Promise<Organization> {
    return this.db.asUser(auth, async (db) => {
      const { rows } = await db.query("select * from core.create_organization($1, $2, $3, $4)", [
        input.name,
        input.slug,
        input.addCreatorAsMember,
        idempotencyKey,
      ]);
      return toOrganization(rows[0]);
    });
  }

  updateOrganization(auth: AuthContext, id: string, input: { name?: string | undefined; status?: string | undefined }) {
    return this.db.asUser(auth, async (db) => {
      const { rows } = await db.query("select * from core.update_organization($1, $2, $3)", [
        id,
        input.name ?? null,
        input.status ?? null,
      ]);
      return toOrganization(rows[0]);
    });
  }

  // --- Miembros y roles ---------------------------------------------------------

  listMembers(auth: AuthContext, organizationId: string): Promise<Member[]> {
    return this.db.asUser(auth, async (db) => {
      await this.requireOrgPermission(db, organizationId, "members.read");
      const { rows } = await db.query(`${MEMBER_SELECT} where m.organization_id = $1 order by p.email`, [organizationId]);
      return rows.map(toMember);
    });
  }

  private async getMember(db: Db, memberId: string): Promise<Member> {
    const { rows } = await db.query(`${MEMBER_SELECT} where m.id = $1`, [memberId]);
    if (!rows[0]) throw new ProblemError("member_not_found");
    return toMember(rows[0]);
  }

  async addMember(
    auth: AuthContext,
    organizationId: string,
    input: { email: string; roleKey: string; invite: boolean },
  ): Promise<Member> {
    const add = () =>
      this.db.asUser(auth, async (db) => {
        const { rows } = await db.query("select (core.add_organization_member($1, $2, $3)).id as id", [
          organizationId,
          input.email,
          input.roleKey,
        ]);
        return this.getMember(db, String(rows[0]?.id));
      });

    try {
      return await add();
    } catch (error) {
      const isMissingUser = (error as { message?: string }).message === "user_not_found";
      if (!isMissingUser) throw error;
      if (!input.invite) {
        throw new ProblemError(
          "user_not_found",
          "No existe un usuario con ese correo. Pídele que se registre o envía una invitación.",
        );
      }
      // Antes de invitar, confirmar que el actor puede gestionar miembros (evita usar la API como
      // herramienta de envío de correos para quien no tiene permiso).
      await this.db.asUser(auth, (db) => this.requireOrgPermission(db, organizationId, "members.manage"));
      await this.supabaseAdmin.inviteUser(input.email);
      return add();
    }
  }

  updateMember(
    auth: AuthContext,
    organizationId: string,
    memberId: string,
    input: { roleKey?: string | undefined; status?: string | undefined },
  ): Promise<Member> {
    return this.db.asUser(auth, async (db) => {
      await this.assertMemberInOrganization(db, organizationId, memberId);
      await db.query("select core.update_organization_member($1, $2, $3)", [memberId, input.roleKey ?? null, input.status ?? null]);
      return this.getMember(db, memberId);
    });
  }

  removeMember(auth: AuthContext, organizationId: string, memberId: string): Promise<void> {
    return this.db.asUser(auth, async (db) => {
      await this.assertMemberInOrganization(db, organizationId, memberId);
      await db.query("select core.remove_organization_member($1)", [memberId]);
    });
  }

  private async assertMemberInOrganization(db: Db, organizationId: string, memberId: string): Promise<void> {
    await this.requireOrgPermission(db, organizationId, "members.read");
    const { rowCount } = await db.query(
      "select 1 from core.organization_members where id = $1 and organization_id = $2",
      [memberId, organizationId],
    );
    if (!rowCount) throw new ProblemError("member_not_found");
  }

  listRoles(auth: AuthContext, organizationId: string): Promise<Role[]> {
    return this.db.asUser(auth, async (db) => {
      await this.requireOrgPermission(db, organizationId, "roles.read");
      const { rows } = await db.query(
        `select r.id, r.key, r.name, r.description, r.is_system,
                coalesce(array_agg(rp.permission_key order by rp.permission_key)
                         filter (where rp.permission_key is not null), '{}') as permissions
         from core.organization_roles r
         left join core.role_permissions rp on rp.role_id = r.id
         where r.organization_id = $1 or r.organization_id is null
         group by r.id
         order by r.is_system desc, r.name`,
        [organizationId],
      );
      return rows.map((r: Row) => ({
        id: String(r.id),
        key: String(r.key),
        name: String(r.name),
        description: String(r.description),
        isSystem: Boolean(r.is_system),
        permissions: r.permissions as string[],
      }));
    });
  }

  // --- Auditoría ----------------------------------------------------------------

  organizationAudit(auth: AuthContext, organizationId: string, page: { limit: number; before?: string | undefined }) {
    return this.db.asUser(auth, async (db) => {
      await this.requireOrgPermission(db, organizationId, "audit.read");
      const { rows } = await db.query(
        `${AUDIT_SELECT} where e.organization_id = $1 and ($2::timestamptz is null or e.created_at < $2)
         order by e.created_at desc, e.id desc limit $3`,
        [organizationId, page.before ?? null, page.limit],
      );
      return rows.map(toAuditEvent);
    });
  }

  platformAudit(auth: AuthContext, page: { limit: number; before?: string | undefined }) {
    return this.db.asUser(auth, async (db) => {
      await this.requirePlatformPermission(db, "platform.audit.read");
      const { rows } = await db.query(
        `${AUDIT_SELECT} where ($1::timestamptz is null or e.created_at < $1)
         order by e.created_at desc, e.id desc limit $2`,
        [page.before ?? null, page.limit],
      );
      return rows.map(toAuditEvent);
    });
  }

  // --- Resumen -------------------------------------------------------------------

  async dashboard(auth: AuthContext, organizationId: string | null): Promise<DashboardSummary> {
    const summary = await this.db.asUser(auth, async (db) => {
      const { rows } = await db.query("select core.dashboard_summary($1) as s", [organizationId]);
      return rows[0]?.s as Row;
    });
    const services = await this.serviceCatalogPublic();
    const generatedAt = new Date().toISOString();
    if (summary.scope === "platform") {
      return {
        summary: {
          scope: "platform",
          organizationsTotal: num(summary.organizations_total),
          organizationsActive: num(summary.organizations_active),
          organizationsSuspended: num(summary.organizations_suspended),
          usersTotal: num(summary.users_total),
          platformAdmins: num(summary.platform_admins),
          membershipsActive: num(summary.memberships_active),
          auditEvents24h: num(summary.audit_events_24h),
        },
        services,
        generatedAt,
      };
    }
    return {
      summary: {
        scope: "organization",
        organizationId: String(summary.organization_id),
        membersTotal: num(summary.members_total),
        membersActive: num(summary.members_active),
        customRoles: num(summary.custom_roles),
        auditEvents24h: num(summary.audit_events_24h),
      },
      services,
      generatedAt,
    };
  }
}
