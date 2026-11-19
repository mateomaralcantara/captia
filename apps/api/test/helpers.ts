import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { SignJWT } from "jose";
import pg from "pg";
import { createApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config.js";

export const JWT_SECRET = "secreto-de-pruebas-que-no-se-usa-en-produccion-1234";
export const SUPABASE_URL = "http://supabase.test.invalid";

export function testDatabaseUrl(): string {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error("Ejecuta con scripts/test-db.sh (TEST_DATABASE_URL no definida)");
  const url = new URL(raw);
  url.pathname = "/captia_test";
  return url.toString();
}

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: testDatabaseUrl(),
    DATABASE_SSL: "disable",
    SUPABASE_URL,
    SUPABASE_JWT_SECRET: JWT_SECRET,
    WEB_ORIGINS: "http://localhost:3000",
    ...overrides,
  });
}

export interface TestUser {
  id: string;
  email: string;
}

export async function createUser(db: pg.Client, label: string): Promise<TestUser> {
  const email = `${label}-${randomUUID().slice(0, 8)}@test.captia.invalid`;
  const { rows } = await db.query("insert into auth.users (email) values ($1) returning id, email", [email]);
  return rows[0] as TestUser;
}

export async function grantPlatformRole(db: pg.Client, userId: string, role: string): Promise<void> {
  await db.query(
    "insert into core.platform_role_assignments (user_id, role_id) select $1, id from core.platform_roles where key = $2",
    [userId, role],
  );
}

/** Firma un token igual que Supabase Auth (HS256 heredado). */
export async function tokenFor(
  user: TestUser,
  opts: { aal?: "aal1" | "aal2"; expiresIn?: string; audience?: string; issuer?: string; role?: string; secret?: string } = {},
): Promise<string> {
  return new SignJWT({ email: user.email, role: opts.role ?? "authenticated", aal: opts.aal ?? "aal2", session_id: randomUUID() })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuer(opts.issuer ?? `${SUPABASE_URL}/auth/v1`)
    .setAudience(opts.audience ?? "authenticated")
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? "5m")
    .sign(new TextEncoder().encode(opts.secret ?? JWT_SECRET));
}

export interface Harness {
  app: INestApplication;
  baseUrl: string;
  db: pg.Client;
  close(): Promise<void>;
}

export async function startHarness(overrides: Record<string, string> = {}): Promise<Harness> {
  const app = await createApp(testConfig(overrides), { logger: false });
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as { port: number };
  const db = new pg.Client({ connectionString: testDatabaseUrl() });
  await db.connect();
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    db,
    async close() {
      await db.end();
      await app.close();
    },
  };
}

export async function call(
  h: Harness,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(h.baseUrl + path, {
    method,
    headers,
    body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

export const slug = (p = "org") => `${p}-${randomUUID().slice(0, 8)}`;
