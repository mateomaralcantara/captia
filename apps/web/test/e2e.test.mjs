// Prueba de extremo a extremo del panel CAPTIA Control con navegador real (Playwright).
//
// Componentes REALES: panel Next.js (build de producción), API NestJS, PostgreSQL con las migraciones.
// DOBLE DE PRUEBA: Supabase Auth se sustituye por un servidor mínimo que emite JWT HS256 con el mismo
// formato que GoTrue (iss, aud, role, aal). La integración con GoTrue real se ejecuta en CI con
// `supabase start` (ver docs/operations/acceptance-entrega-1.md).
//
// Requisitos: `pnpm run build` hecho y TEST_DATABASE_URL (lo prepara scripts/test-db.sh).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import net from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { SignJWT, decodeJwt } from "jose";
import pg from "pg";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const SECRET = "secreto-e2e-solo-para-pruebas-0123456789abcdef";

function dbUrl() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  url.pathname = "/captia_test";
  return url.toString();
}

async function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitFor(url, ms = 60_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { redirect: "manual" });
      if (r.status < 500) return;
    } catch {
      /* todavía arrancando */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No arrancó: ${url}`);
}

const procs = [];
function start(cmd, args, env, cwd) {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  child.logs = () => log;
  procs.push(child);
  return child;
}

// --- Doble de Supabase Auth -------------------------------------------------------------------
const accounts = new Map(); // email -> { id, password, aal }
const refreshTokens = new Map();
let authUrl;

async function issue(account) {
  const token = await new SignJWT({ email: account.email, role: "authenticated", aal: account.aal, session_id: randomUUID() })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(account.id)
    .setIssuer(`${authUrl}/auth/v1`)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
  const refresh = randomUUID();
  refreshTokens.set(refresh, account);
  return { access_token: token, refresh_token: refresh, expires_in: 3600, user: { id: account.id, email: account.email, factors: [] } };
}

const fakeAuth = createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  const url = new URL(req.url, "http://x");
  const send = (status, payload) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(payload));
  if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
    const account = accounts.get(String(body.email).toLowerCase());
    if (!account || account.password !== body.password) return send(400, { error_code: "invalid_credentials" });
    return send(200, await issue(account));
  }
  if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
    const account = refreshTokens.get(body.refresh_token);
    return account ? send(200, await issue(account)) : send(400, { error_code: "refresh_token_not_found" });
  }
  if (url.pathname === "/auth/v1/user") {
    const claims = decodeJwt(String(req.headers.authorization).replace("Bearer ", ""));
    return send(200, { id: claims.sub, email: claims.email, factors: [] });
  }
  if (url.pathname === "/auth/v1/logout") return res.writeHead(204).end();
  return send(404, { error_code: "not_found" });
});

// --- Arranque ---------------------------------------------------------------------------------
let db;
let browser;
let webUrl;
const users = {};

async function account(label, aal) {
  const email = `${label}-${randomUUID().slice(0, 6)}@e2e.captia.invalid`;
  const { rows } = await db.query("insert into auth.users (email) values ($1) returning id", [email]);
  const acc = { id: rows[0].id, email, password: `clave-${randomUUID()}`, aal };
  accounts.set(email, acc);
  return acc;
}

before(async () => {
  db = new pg.Client({ connectionString: dbUrl() });
  await db.connect();

  const authPort = await freePort();
  authUrl = `http://127.0.0.1:${authPort}`;
  await new Promise((r) => fakeAuth.listen(authPort, "127.0.0.1", r));

  users.root = await account("root", "aal2");
  await db.query("select core.bootstrap_superadmin($1)", [users.root.email]);
  users.member = await account("miembro", "aal2");
  users.noMfa = await account("sin-mfa", "aal1");
  users.other = await account("otra-empresa", "aal2");

  const apiPort = await freePort();
  start("node", ["dist/src/main.js"], {
    NODE_ENV: "test", API_PORT: String(apiPort), DATABASE_URL: dbUrl(), DATABASE_SSL: "disable",
    SUPABASE_URL: authUrl, SUPABASE_JWT_SECRET: SECRET, WEB_ORIGINS: "http://127.0.0.1",
  }, path.join(root, "apps/api"));
  await waitFor(`http://127.0.0.1:${apiPort}/v1/health`);

  const webPort = await freePort();
  webUrl = `http://127.0.0.1:${webPort}`;
  start("node", [path.join(root, "apps/web/node_modules/next/dist/bin/next"), "start", "--port", String(webPort), "--hostname", "127.0.0.1"], {
    CAPTIA_API_URL: `http://127.0.0.1:${apiPort}`, SUPABASE_URL: authUrl, SUPABASE_PUBLISHABLE_KEY: "publishable-e2e",
    NODE_ENV: "production",
  }, path.join(root, "apps/web"));
  await waitFor(`${webUrl}/login`);

  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  for (const p of procs) p.kill("SIGTERM");
  fakeAuth.close();
  await db?.end();
});

// Capturas opcionales como evidencia (E2E_SCREENSHOTS_DIR=/ruta).
async function shot(page, name) {
  const dir = process.env.E2E_SCREENSHOTS_DIR;
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

async function login(page, acc) {
  await page.goto(`${webUrl}/login`);
  await page.getByLabel("Correo").fill(acc.email);
  await page.getByLabel("Contraseña").fill(acc.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(`${webUrl}/`);
}

test("sin sesión, el panel redirige al login; credenciales malas muestran error", async () => {
  const page = await browser.newPage();
  await page.goto(`${webUrl}/clientes`);
  assert.equal(new URL(page.url()).pathname, "/login");
  await page.getByLabel("Correo").fill(users.root.email);
  await page.getByLabel("Contraseña").fill("incorrecta");
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.getByText("Correo o contraseña incorrectos.").waitFor();
  await shot(page, "00-login");
  await page.close();
});

test("TEST 001/003/009/012 — el administrador inicia sesión, crea una organización y gestiona usuarios", async () => {
  const page = await browser.newPage();
  page.on("dialog", (d) => d.accept());
  await login(page, users.root);

  // Resumen con datos reales de la base.
  await page.getByText("Vista de plataforma").waitFor();
  const total = (await db.query("select count(*)::int as n from core.organizations")).rows[0].n;
  const card = page.locator(".card", { has: page.getByText("Organizaciones", { exact: true }) });
  assert.equal((await card.locator("p").nth(1).textContent()).trim(), String(total));
  await page.getByText("Android virtual").waitFor();
  await shot(page, "01-resumen");

  // Crear organización.
  const slug = `e2e-${randomUUID().slice(0, 8)}`;
  await page.goto(`${webUrl}/clientes`);
  await page.getByLabel("Nombre").fill("Empresa E2E");
  await page.getByLabel("Identificador (slug)").fill(slug);
  await page.getByRole("button", { name: "Crear" }).click();
  await page.getByRole("link", { name: "Empresa E2E" }).first().waitFor();
  const org = (await db.query("select id from core.organizations where slug = $1", [slug])).rows[0];
  assert.ok(org, "la organización existe en la base de datos");

  // Gestionar miembros.
  await page.goto(`${webUrl}/clientes/${org.id}`);
  await page.getByRole("cell", { name: users.root.email }).waitFor();
  await page.getByLabel("Correo").fill(users.member.email);
  await page.locator("#member-role").selectOption("operator");
  await page.getByRole("button", { name: "Añadir miembro" }).click();
  const row = page.getByRole("row", { name: new RegExp(users.member.email) });
  await row.locator("td").nth(1).filter({ hasText: /^Operador$/ }).waitFor();

  await row.getByRole("combobox").selectOption("auditor");
  await row.locator("td").nth(1).filter({ hasText: /^Auditor$/ }).waitFor();
  assert.equal(await row.getByRole("combobox").inputValue(), "auditor", "el selector refleja el rol guardado");

  await shot(page, "02-organizacion-miembros");
  await row.getByRole("button", { name: "Quitar" }).click();
  await row.waitFor({ state: "detached" });

  const { rows } = await db.query(
    "select action from core.audit_events where organization_id = $1 order by created_at", [org.id],
  );
  assert.deepEqual(rows.map((r) => r.action), ["organization.created", "member.added", "member.updated", "member.removed"]);

  // Auditoría en el panel.
  await page.goto(`${webUrl}/auditoria`);
  await page.getByRole("cell", { name: "member.removed" }).first().waitFor();
  await shot(page, "03-auditoria");

  // Cerrar sesión.
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await page.waitForURL(`${webUrl}/login`);
  await page.close();
});

test("sin MFA (aal1) el panel muestra que la acción exige verificación en dos pasos", async () => {
  const org = (await db.query(
    "insert into core.organizations (name, slug) values ('Sin MFA', $1) returning id", [`nomfa-${randomUUID().slice(0, 8)}`],
  )).rows[0];
  await db.query(
    "insert into core.organization_members (organization_id, user_id, role_id) select $1, $2, id from core.organization_roles where key = 'org_admin' and organization_id is null",
    [org.id, users.noMfa.id],
  );
  const page = await browser.newPage();
  await login(page, users.noMfa);
  await page.goto(`${webUrl}/clientes/${org.id}`);
  await page.getByLabel("Correo").fill(users.other.email);
  await page.getByRole("button", { name: "Añadir miembro" }).click();
  await page.getByText("Esta acción requiere verificación en dos pasos").waitFor();
  await page.close();
});

test("TEST 002/014 — un usuario de otra organización no ve ni abre organizaciones ajenas", async () => {
  const mine = (await db.query(
    "insert into core.organizations (name, slug) values ('Otra Empresa', $1) returning id", [`otra-${randomUUID().slice(0, 8)}`],
  )).rows[0];
  await db.query(
    "insert into core.organization_members (organization_id, user_id, role_id) select $1, $2, id from core.organization_roles where key = 'org_admin' and organization_id is null",
    [mine.id, users.other.id],
  );
  const foreign = (await db.query("select id from core.organizations where id <> $1 limit 1", [mine.id])).rows[0];

  const page = await browser.newPage();
  await login(page, users.other);
  await page.goto(`${webUrl}/clientes`);
  const links = await page.locator("table a").allTextContents();
  assert.deepEqual(links, ["Otra Empresa"]);
  const response = await page.goto(`${webUrl}/clientes/${foreign.id}`);
  assert.equal(response.status(), 404);
  await page.close();
});

test("los módulos sin backend muestran su estado real, sin datos simulados; el idioma cambia a inglés", async () => {
  const page = await browser.newPage();
  await login(page, users.root);
  await page.goto(`${webUrl}/modulo/phone.virtual`);
  await page.getByText("Módulo no disponible todavía").waitFor();
  await page.getByText("Requiere un nodo Linux con KVM").waitFor();
  await shot(page, "04-modulo-pendiente");
  await page.getByRole("button", { name: "English" }).click();
  await page.getByRole("link", { name: "Overview" }).waitFor();
  await page.close();
});
