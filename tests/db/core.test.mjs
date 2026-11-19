// Pruebas del núcleo en PostgreSQL: RLS, permisos, MFA, auditoría e idempotencia.
// Cada prueba indica el TEST de aceptación del prompt maestro al que aporta evidencia.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { asUser, connect, createUser, expectPgError, grantPlatformRole, slug } from "./helpers.mjs";

let db;
let superadmin;
let adminA;
let adminB;
let orgA;
let orgB;

before(async () => {
  db = await connect();
  superadmin = await createUser(db, "superadmin");
  await grantPlatformRole(db, superadmin.id, "superadmin");
  adminA = await createUser(db, "admin-a");
  adminB = await createUser(db, "admin-b");

  orgA = await asUser(db, superadmin, async (c) =>
    (await c.query("select * from core.create_organization($1, $2, false)", ["Empresa A", slug("a")])).rows[0]);
  orgB = await asUser(db, superadmin, async (c) =>
    (await c.query("select * from core.create_organization($1, $2, false)", ["Empresa B", slug("b")])).rows[0]);

  await asUser(db, superadmin, async (c) => {
    await c.query("select core.add_organization_member($1, $2, 'org_admin')", [orgA.id, adminA.email]);
    await c.query("select core.add_organization_member($1, $2, 'org_admin')", [orgB.id, adminB.email]);
  });
});

after(async () => {
  await db?.end();
});

describe("perfiles", () => {
  test("cada usuario de Supabase Auth recibe un perfil", async () => {
    const { rows } = await db.query("select email from core.profiles where id = $1", [adminA.id]);
    assert.equal(rows[0].email, adminA.email);
  });
});

describe("TEST 002 / 014 — aislamiento entre organizaciones", () => {
  test("el admin de A ve su organización y no la de B", async () => {
    const ids = await asUser(db, adminA, async (c) =>
      (await c.query("select id from core.organizations")).rows.map((r) => r.id));
    assert.deepEqual(ids, [orgA.id]);
  });

  test("el admin de A no ve miembros ni auditoría de B", async () => {
    await asUser(db, adminA, async (c) => {
      const members = await c.query("select 1 from core.organization_members where organization_id = $1", [orgB.id]);
      assert.equal(members.rowCount, 0);
      const audit = await c.query("select 1 from core.audit_events where organization_id = $1", [orgB.id]);
      assert.equal(audit.rowCount, 0);
    });
  });

  test("el admin de A no puede añadir miembros a B y no descubre que existe", async () => {
    const outsider = await createUser(db, "outsider");
    await expectPgError(
      asUser(db, adminA, (c) => c.query("select core.add_organization_member($1, $2, 'user')", [orgB.id, outsider.email])),
      "CA404", "organization_not_found",
    );
  });

  test("el admin de A no ve el resumen de B", async () => {
    await expectPgError(asUser(db, adminA, (c) => c.query("select core.dashboard_summary($1)", [orgB.id])), "CA404");
  });

  test("un usuario sin membresía no ve ninguna organización ni perfiles ajenos", async () => {
    const stranger = await createUser(db, "stranger");
    await asUser(db, stranger, async (c) => {
      assert.equal((await c.query("select 1 from core.organizations")).rowCount, 0);
      const profiles = await c.query("select id from core.profiles");
      assert.deepEqual(profiles.rows.map((r) => r.id), [stranger.id]);
    });
  });

  test("authenticated no puede escribir tablas directamente", async () => {
    await expectPgError(
      asUser(db, adminA, (c) => c.query("insert into core.organizations (name, slug) values ('X', $1)", [slug("x")])),
      "42501",
    );
    await expectPgError(
      asUser(db, adminA, (c) => c.query("update core.organizations set name = 'hack' where id = $1", [orgA.id])),
      "42501",
    );
  });

  test("anon no puede leer nada del esquema core", async () => {
    await db.query("begin");
    try {
      await db.query("set local role anon");
      await expectPgError(db.query("select 1 from core.organizations"), "42501");
    } finally {
      await db.query("rollback");
    }
  });
});

describe("TEST 009 — permisos", () => {
  test("un operador no puede gestionar miembros", async () => {
    const operator = await createUser(db, "operator");
    const target = await createUser(db, "target");
    await asUser(db, adminA, (c) => c.query("select core.add_organization_member($1, $2, 'operator')", [orgA.id, operator.email]));
    await expectPgError(
      asUser(db, operator, (c) => c.query("select core.add_organization_member($1, $2, 'user')", [orgA.id, target.email])),
      "CA403", "forbidden",
    );
  });

  test("un operador no ve la lista de miembros, solo su propia membresía", async () => {
    const operator = await createUser(db, "operator2");
    await asUser(db, adminA, (c) => c.query("select core.add_organization_member($1, $2, 'operator')", [orgA.id, operator.email]));
    const rows = await asUser(db, operator, async (c) =>
      (await c.query("select user_id from core.organization_members where organization_id = $1", [orgA.id])).rows);
    assert.deepEqual(rows.map((r) => r.user_id), [operator.id]);
  });

  test("un usuario normal no puede crear organizaciones (autoservicio desactivado)", async () => {
    await expectPgError(
      asUser(db, adminA, (c) => c.query("select core.create_organization('Nueva', $1)", [slug("n")])),
      "CA403",
    );
  });

  test("solo la plataforma puede suspender organizaciones", async () => {
    await expectPgError(
      asUser(db, adminA, (c) => c.query("select core.update_organization($1, null, 'suspended')", [orgA.id])),
      "CA403",
    );
  });

  test("un supervisor no puede conceder un rol con más permisos que los suyos", async () => {
    const supervisor = await createUser(db, "supervisor");
    await asUser(db, superadmin, (c) => c.query("select core.add_organization_member($1, $2, 'supervisor')", [orgA.id, supervisor.email]));
    // El supervisor ni siquiera tiene members.manage.
    const other = await createUser(db, "other");
    await expectPgError(
      asUser(db, supervisor, (c) => c.query("select core.add_organization_member($1, $2, 'org_admin')", [orgA.id, other.email])),
      "CA403",
    );
  });

  test("no se puede asignar un rol personalizado de otra organización", async () => {
    const roleB = (await db.query(
      "insert into core.organization_roles (organization_id, key, name) values ($1, 'solo_b', 'Solo B') returning id", [orgB.id],
    )).rows[0];
    const user = await createUser(db, "crossrole");
    await expectPgError(
      db.query("insert into core.organization_members (organization_id, user_id, role_id) values ($1, $2, $3)", [orgA.id, user.id, roleB.id]),
      "CA422",
    );
  });

  test("no se puede quitar ni degradar al último administrador", async () => {
    const org = await asUser(db, superadmin, async (c) =>
      (await c.query("select * from core.create_organization('Solo', $1, false)", [slug("solo")])).rows[0]);
    const admin = await createUser(db, "lastadmin");
    const member = await asUser(db, superadmin, async (c) =>
      (await c.query("select * from core.add_organization_member($1, $2, 'org_admin')", [org.id, admin.email])).rows[0]);

    await expectPgError(asUser(db, admin, (c) => c.query("select core.remove_organization_member($1)", [member.id])), "CA409", "last_admin");
    await expectPgError(
      asUser(db, admin, (c) => c.query("select core.update_organization_member($1, 'user')", [member.id])),
      "CA409", "last_admin",
    );
  });

  test("un miembro de una organización suspendida pierde el acceso; la plataforma no", async () => {
    const org = await asUser(db, superadmin, async (c) =>
      (await c.query("select * from core.create_organization('Suspendible', $1, false)", [slug("s")])).rows[0]);
    const admin = await createUser(db, "susp");
    await asUser(db, superadmin, (c) => c.query("select core.add_organization_member($1, $2, 'org_admin')", [org.id, admin.email]));
    await asUser(db, superadmin, (c) => c.query("select core.update_organization($1, null, 'suspended')", [org.id]));

    const visible = await asUser(db, admin, async (c) => (await c.query("select 1 from core.organizations where id = $1", [org.id])).rowCount);
    assert.equal(visible, 0);
    const forPlatform = await asUser(db, superadmin, async (c) => (await c.query("select status from core.organizations where id = $1", [org.id])).rows[0]);
    assert.equal(forPlatform.status, "suspended");
  });
});

describe("MFA para administradores", () => {
  test("sin aal2 las acciones administrativas se rechazan", async () => {
    const user = await createUser(db, "nomfa");
    await expectPgError(
      asUser(db, adminA, (c) => c.query("select core.add_organization_member($1, $2, 'user')", [orgA.id, user.email]), { aal: "aal1" }),
      "CA401", "mfa_required",
    );
  });

  test("las lecturas no exigen aal2", async () => {
    const count = await asUser(db, adminA, async (c) => (await c.query("select 1 from core.organizations")).rowCount, { aal: "aal1" });
    assert.equal(count, 1);
  });
});

describe("TEST 012 — auditoría", () => {
  test("cada acción administrativa queda registrada con actor y nivel de autenticación", async () => {
    const user = await createUser(db, "audited");
    const member = await asUser(db, adminA, async (c) =>
      (await c.query("select * from core.add_organization_member($1, $2, 'user')", [orgA.id, user.email])).rows[0]);
    await asUser(db, adminA, (c) => c.query("select core.update_organization_member($1, 'auditor')", [member.id]));
    await asUser(db, adminA, (c) => c.query("select core.remove_organization_member($1)", [member.id]));

    const { rows } = await db.query(
      "select action, actor_user_id, metadata->>'aal' as aal from core.audit_events where target_id = $1 order by created_at",
      [member.id],
    );
    assert.deepEqual(rows.map((r) => r.action), ["member.added", "member.updated", "member.removed"]);
    assert.ok(rows.every((r) => r.actor_user_id === adminA.id && r.aal === "aal2"));
  });

  test("la auditoría no se puede modificar ni borrar, ni siquiera con privilegios", async () => {
    await expectPgError(db.query("update core.audit_events set action = 'x.y'"), "CA403");
    await expectPgError(db.query("delete from core.audit_events"), "CA403");
    await expectPgError(db.query("truncate core.audit_events"), "CA403");
  });

  test("una operación fallida no deja auditoría a medias", async () => {
    const before = (await db.query("select count(*)::int as n from core.audit_events")).rows[0].n;
    await expectPgError(
      asUser(db, adminA, (c) => c.query("select core.add_organization_member($1, 'nadie@x.invalid', 'user')", [orgA.id])),
      "CA404",
    );
    const afterCount = (await db.query("select count(*)::int as n from core.audit_events")).rows[0].n;
    assert.equal(afterCount, before);
  });
});

describe("TEST 011 — idempotencia", () => {
  test("repetir la creación con la misma clave no duplica la organización", async () => {
    const key = `idem-${slug()}`;
    const s = slug("idem");
    const first = await asUser(db, superadmin, async (c) =>
      (await c.query("select * from core.create_organization('Idem', $1, true, $2)", [s, key])).rows[0]);
    const second = await asUser(db, superadmin, async (c) =>
      (await c.query("select * from core.create_organization('Idem', $1, true, $2)", [s, key])).rows[0]);
    assert.equal(first.id, second.id);
    const audits = await db.query("select 1 from core.audit_events where action = 'organization.created' and target_id = $1", [first.id]);
    assert.equal(audits.rowCount, 1);
  });

  test("un slug repetido sin clave da conflicto", async () => {
    await expectPgError(
      asUser(db, superadmin, (c) => c.query("select core.create_organization('Otra', $1, false)", [orgA.slug])),
      "CA409", "slug_taken",
    );
  });
});

describe("resumen con datos reales", () => {
  test("el resumen de plataforma cuenta lo que existe en la base", async () => {
    const summary = await asUser(db, superadmin, async (c) => (await c.query("select core.dashboard_summary() as s")).rows[0].s);
    const real = (await db.query("select count(*)::int as n from core.organizations")).rows[0].n;
    assert.equal(summary.scope, "platform");
    assert.equal(summary.organizations_total, real);
  });

  test("un admin de organización no ve el resumen de plataforma", async () => {
    await expectPgError(asUser(db, adminA, (c) => c.query("select core.dashboard_summary()")), "CA403");
  });
});

describe("privilegios de las funciones", () => {
  test("bootstrap_superadmin no es ejecutable por usuarios", async () => {
    await expectPgError(asUser(db, adminA, (c) => c.query("select core.bootstrap_superadmin($1)", [adminA.email])), "42501");
  });

  test("todas las funciones security definer fijan search_path", async () => {
    const { rows } = await db.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'core' and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    assert.deepEqual(rows, []);
  });

  test("todas las tablas de core tienen RLS activo", async () => {
    const { rows } = await db.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'core' and c.relkind = 'r' and not c.relrowsecurity`);
    assert.deepEqual(rows, []);
  });
});
