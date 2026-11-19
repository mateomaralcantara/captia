// Pruebas HTTP de extremo a extremo contra PostgreSQL real (migraciones aplicadas) con JWT firmados
// como los de Supabase Auth. Cada bloque cita el TEST de aceptación del prompt maestro.
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { ROUTES } from "../src/openapi.js";
import { call, createUser, grantPlatformRole, slug, startHarness, tokenFor, type Harness, type TestUser } from "./helpers.js";

let h: Harness;
let superadmin: TestUser;
let adminA: TestUser;
let adminB: TestUser;
let operatorA: TestUser;
let orgA: { id: string; slug: string };
let orgB: { id: string };
let tSuper: string;
let tA: string;
let tB: string;

before(async () => {
  h = await startHarness();
  superadmin = await createUser(h.db, "superadmin");
  await grantPlatformRole(h.db, superadmin.id, "superadmin");
  adminA = await createUser(h.db, "admin-a");
  adminB = await createUser(h.db, "admin-b");
  operatorA = await createUser(h.db, "operator-a");
  tSuper = await tokenFor(superadmin);
  tA = await tokenFor(adminA);
  tB = await tokenFor(adminB);

  const a = await call(h, "POST", "/v1/organizations", { token: tSuper, body: { name: "Empresa A", slug: slug("a"), addCreatorAsMember: false } });
  const b = await call(h, "POST", "/v1/organizations", { token: tSuper, body: { name: "Empresa B", slug: slug("b"), addCreatorAsMember: false } });
  assert.equal(a.status, 201);
  orgA = a.body;
  orgB = b.body;
  for (const [org, user, role] of [[orgA, adminA, "org_admin"], [orgB, adminB, "org_admin"], [orgA, operatorA, "operator"]] as const) {
    const r = await call(h, "POST", `/v1/organizations/${org.id}/members`, { token: tSuper, body: { email: user.email, roleKey: role } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
});

after(async () => {
  await h?.close();
});

describe("sistema", () => {
  test("salud: comprueba la base de datos y declara las integraciones no configuradas", async () => {
    const r = await call(h, "GET", "/v1/health");
    assert.equal(r.status, 200);
    assert.equal(r.body.checks.database.status, "ok");
    assert.equal(r.body.checks.invitations.status, "not_configured");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.ok(r.headers.get("x-request-id"));
  });

  test("el catálogo de servicios es honesto: solo el núcleo está implementado", async () => {
    const r = await call(h, "GET", "/v1/service-catalog");
    const implemented = r.body.data.filter((s: { status: string }) => s.status === "implemented").map((s: { key: string }) => s.key);
    assert.deepEqual(implemented, ["control.core"]);
  });

  test("la especificación OpenAPI describe todas las rutas", async () => {
    const r = await call(h, "GET", "/v1/openapi.json");
    assert.equal(r.body.openapi, "3.1.0");
    for (const route of ROUTES) assert.ok(r.body.paths[route.path]?.[route.method], `${route.method} ${route.path}`);
  });

  test("cada ruta del registro OpenAPI existe en la API (no responde con la página 404 genérica de rutas)", async () => {
    const fakeId = "00000000-0000-4000-8000-000000000000";
    for (const route of ROUTES) {
      const path = route.path.replaceAll(/\{\w+\}/g, fakeId);
      const r = await call(h, route.method.toUpperCase(), path, { token: tA, body: route.body ? {} : undefined });
      assert.ok(r.status !== 404 || r.body.code !== "not_found", `${route.method} ${route.path} → ${r.status} ${r.body?.code}`);
    }
  });
});

describe("TEST 001 — autenticación", () => {
  test("un usuario válido accede a su perfil", async () => {
    const r = await call(h, "GET", "/v1/me", { token: tA });
    assert.equal(r.status, 200);
    assert.equal(r.body.email, adminA.email);
    assert.equal(r.body.memberships[0].organizationId, orgA.id);
    assert.ok(r.body.memberships[0].permissions.includes("members.manage"));
  });

  test("sin token, con token falso o caducado: 401 problem+json", async () => {
    for (const token of [undefined, "abc.def.ghi", await tokenFor(adminA, { expiresIn: "-1m" })]) {
      const r = await call(h, "GET", "/v1/me", { token });
      assert.equal(r.status, 401);
      assert.equal(r.body.code, "unauthenticated");
      assert.match(r.headers.get("content-type") ?? "", /application\/problem\+json/);
    }
  });
});

describe("TEST 002 / 014 — multi-tenancy", () => {
  test("el admin de A solo lista su organización", async () => {
    const r = await call(h, "GET", "/v1/organizations", { token: tA });
    assert.deepEqual(r.body.data.map((o: { id: string }) => o.id), [orgA.id]);
  });

  test("el admin de A recibe 404 en todo lo de B (no se revela su existencia)", async () => {
    const paths = [
      `/v1/organizations/${orgB.id}`,
      `/v1/organizations/${orgB.id}/members`,
      `/v1/organizations/${orgB.id}/roles`,
      `/v1/organizations/${orgB.id}/audit-events`,
      `/v1/dashboard/summary?organizationId=${orgB.id}`,
    ];
    for (const p of paths) {
      const r = await call(h, "GET", p, { token: tA });
      assert.equal(r.status, 404, p);
    }
    const write = await call(h, "PATCH", `/v1/organizations/${orgB.id}`, { token: tA, body: { name: "Hackeada" } });
    assert.equal(write.status, 404);
    const add = await call(h, "POST", `/v1/organizations/${orgB.id}/members`, { token: tA, body: { email: adminA.email, roleKey: "org_admin" } });
    assert.equal(add.status, 404);
  });

  test("no se puede manipular un miembro de B a través de la ruta de A", async () => {
    const membersB = await call(h, "GET", `/v1/organizations/${orgB.id}/members`, { token: tB });
    const memberB = membersB.body.data[0].id;
    const r = await call(h, "DELETE", `/v1/organizations/${orgA.id}/members/${memberB}`, { token: tA });
    assert.equal(r.status, 404);
    const still = await call(h, "GET", `/v1/organizations/${orgB.id}/members`, { token: tB });
    assert.equal(still.body.data.length, 1);
  });
});

describe("TEST 009 — permisos", () => {
  test("un operador ve su organización pero no puede gestionar miembros ni leer auditoría", async () => {
    const t = await tokenFor(operatorA);
    assert.equal((await call(h, "GET", `/v1/organizations/${orgA.id}`, { token: t })).status, 200);
    assert.equal((await call(h, "GET", `/v1/organizations/${orgA.id}/members`, { token: t })).status, 403);
    assert.equal((await call(h, "GET", `/v1/organizations/${orgA.id}/audit-events`, { token: t })).status, 403);
    const add = await call(h, "POST", `/v1/organizations/${orgA.id}/members`, { token: t, body: { email: adminB.email, roleKey: "user" } });
    assert.equal(add.status, 403);
  });

  test("un admin de organización no puede crear organizaciones ni ver datos de plataforma", async () => {
    assert.equal((await call(h, "POST", "/v1/organizations", { token: tA, body: { name: "Nueva", slug: slug() } })).status, 403);
    assert.equal((await call(h, "GET", "/v1/platform/audit-events", { token: tA })).status, 403);
    assert.equal((await call(h, "GET", "/v1/dashboard/summary", { token: tA })).status, 403);
  });

  test("un admin de organización no puede suspender su organización", async () => {
    const r = await call(h, "PATCH", `/v1/organizations/${orgA.id}`, { token: tA, body: { status: "suspended" } });
    assert.equal(r.status, 403);
  });

  test("las acciones administrativas sin MFA devuelven 401 mfa_required", async () => {
    const t = await tokenFor(adminA, { aal: "aal1" });
    const r = await call(h, "POST", `/v1/organizations/${orgA.id}/members`, { token: t, body: { email: adminB.email, roleKey: "user" } });
    assert.equal(r.status, 401);
    assert.equal(r.body.code, "mfa_required");
  });

  test("datos inválidos devuelven 422 con la lista de errores", async () => {
    const r = await call(h, "POST", "/v1/organizations", { token: tSuper, body: { name: "", slug: "NO VALIDO!" } });
    assert.equal(r.status, 422);
    assert.ok(r.body.errors.length >= 2);
    const bad = await call(h, "POST", "/v1/organizations", { token: tSuper, body: "{no-json" });
    assert.equal(bad.status, 422);
  });
});

describe("gestión de miembros", () => {
  test("el admin añade, cambia de rol y quita un miembro; no puede quitarse siendo el último admin", async () => {
    const user = await createUser(h.db, "nuevo");
    const added = await call(h, "POST", `/v1/organizations/${orgA.id}/members`, { token: tA, body: { email: user.email, roleKey: "user" } });
    assert.equal(added.status, 201);
    assert.equal(added.body.roleKey, "user");

    const changed = await call(h, "PATCH", `/v1/organizations/${orgA.id}/members/${added.body.id}`, { token: tA, body: { roleKey: "auditor" } });
    assert.equal(changed.body.roleKey, "auditor");

    assert.equal((await call(h, "DELETE", `/v1/organizations/${orgA.id}/members/${added.body.id}`, { token: tA })).status, 204);

    const members = await call(h, "GET", `/v1/organizations/${orgA.id}/members`, { token: tA });
    const me = members.body.data.find((m: { userId: string }) => m.userId === adminA.id);
    const self = await call(h, "DELETE", `/v1/organizations/${orgA.id}/members/${me.id}`, { token: tA });
    assert.equal(self.status, 409);
    assert.equal(self.body.code, "last_admin");
  });

  test("añadir un correo sin cuenta: 404 explicativo, o 503 si se pide invitar y no está configurado", async () => {
    const missing = await call(h, "POST", `/v1/organizations/${orgA.id}/members`, { token: tA, body: { email: "nadie@test.captia.invalid", roleKey: "user" } });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "user_not_found");
    const invite = await call(h, "POST", `/v1/organizations/${orgA.id}/members`, {
      token: tA, body: { email: "nadie@test.captia.invalid", roleKey: "user", invite: true },
    });
    assert.equal(invite.status, 503);
    assert.equal(invite.body.code, "not_configured");
  });
});

describe("TEST 012 — auditoría", () => {
  test("las acciones quedan registradas con actor y son visibles para quien tiene permiso", async () => {
    const r = await call(h, "GET", `/v1/organizations/${orgA.id}/audit-events?limit=100`, { token: tA });
    assert.equal(r.status, 200);
    const actions = r.body.data.map((e: { action: string }) => e.action);
    for (const a of ["organization.created", "member.added", "member.updated", "member.removed"]) assert.ok(actions.includes(a), a);
    const created = r.body.data.find((e: { action: string }) => e.action === "organization.created");
    assert.equal(created.actorEmail, superadmin.email);
  });

  test("la auditoría de plataforma pagina por fecha", async () => {
    const first = await call(h, "GET", "/v1/platform/audit-events?limit=2", { token: tSuper });
    assert.equal(first.body.data.length, 2);
    const next = await call(h, "GET", `/v1/platform/audit-events?limit=2&before=${encodeURIComponent(first.body.data[1].createdAt)}`, { token: tSuper });
    assert.ok(next.body.data.every((e: { createdAt: string }) => e.createdAt < first.body.data[1].createdAt));
  });
});

describe("TEST 011 — idempotencia", () => {
  test("la misma Idempotency-Key devuelve la misma organización", async () => {
    const body = { name: "Idempotente", slug: slug("idem") };
    const headers = { "Idempotency-Key": `clave-${slug()}` };
    const one = await call(h, "POST", "/v1/organizations", { token: tSuper, body, headers });
    const two = await call(h, "POST", "/v1/organizations", { token: tSuper, body, headers });
    assert.equal(one.status, 201);
    assert.equal(two.body.id, one.body.id);
  });
});

describe("resumen", () => {
  test("la plataforma ve contadores reales", async () => {
    const r = await call(h, "GET", "/v1/dashboard/summary", { token: tSuper });
    assert.equal(r.status, 200);
    const { rows } = await h.db.query("select count(*)::int as n from core.organizations");
    assert.equal(r.body.summary.organizationsTotal, rows[0].n);
    assert.ok(r.body.services.length > 0);
  });

  test("el admin de A ve el resumen de su organización", async () => {
    const r = await call(h, "GET", `/v1/dashboard/summary?organizationId=${orgA.id}`, { token: tA });
    assert.equal(r.body.summary.scope, "organization");
    assert.ok(r.body.summary.membersActive >= 2);
  });
});

describe("invitaciones con Supabase Auth (adaptador)", () => {
  let fake: Server;
  let invited: string[] = [];
  let h2: Harness;

  before(async () => {
    // Simula la API de administración de Supabase Auth: crea el usuario en auth.users como hace GoTrue.
    fake = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      if (req.url === "/auth/v1/invite" && req.method === "POST" && req.headers.apikey === "service-key-test") {
        const { email } = JSON.parse(raw) as { email: string };
        invited.push(email);
        await h.db.query("insert into auth.users (email) values ($1)", [email]);
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ email }));
        return;
      }
      res.writeHead(401).end();
    });
    await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
    const port = (fake.address() as { port: number }).port;
    // Mismo emisor de tokens; solo cambia la URL de la API de administración.
    h2 = await startHarness({ SUPABASE_SERVICE_ROLE_KEY: "service-key-test" });
    const { APP_CONFIG } = await import("../src/config.js");
    const config = h2.app.get(APP_CONFIG) as { supabase: { url: string } };
    config.supabase.url = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await h2?.close();
    fake?.close();
  });

  test("invita al correo inexistente y lo añade como miembro", async () => {
    invited = [];
    const email = `invitado-${slug()}@test.captia.invalid`;
    const r = await call(h2, "POST", `/v1/organizations/${orgA.id}/members`, { token: tA, body: { email, roleKey: "user", invite: true } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.email, email);
    assert.deepEqual(invited, [email]);
  });

  test("quien no puede gestionar miembros no puede provocar invitaciones", async () => {
    invited = [];
    const t = await tokenFor(operatorA);
    const r = await call(h2, "POST", `/v1/organizations/${orgA.id}/members`, {
      token: t, body: { email: `spam-${slug()}@test.captia.invalid`, roleKey: "user", invite: true },
    });
    assert.equal(r.status, 403);
    assert.deepEqual(invited, []);
  });
});

describe("límite de peticiones", () => {
  test("responde 429 al superar la cuota de escrituras", async () => {
    const h3 = await startHarness({ RATE_LIMIT_WRITES_PER_MINUTE: "2" });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 3; i++) {
        statuses.push((await call(h3, "PATCH", `/v1/organizations/${orgA.id}`, { token: tA, body: { name: "Empresa A" } })).status);
      }
      assert.deepEqual(statuses, [200, 200, 429]);
    } finally {
      await h3.close();
    }
  });
});
