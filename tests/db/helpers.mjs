import { randomUUID } from "node:crypto";
import pg from "pg";

export function testDatabaseUrl() {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error("Ejecuta las pruebas con scripts/test-db.sh (TEST_DATABASE_URL no definida)");
  const url = new URL(raw);
  url.pathname = "/captia_test";
  return url.toString();
}

export async function connect() {
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  return client;
}

/** Crea un usuario en auth.users (el trigger crea su perfil). */
export async function createUser(db, label = "user") {
  const email = `${label}-${randomUUID().slice(0, 8)}@test.captia.invalid`;
  const { rows } = await db.query("insert into auth.users (email) values ($1) returning id, email", [email]);
  return rows[0];
}

export async function grantPlatformRole(db, userId, roleKey) {
  await db.query(
    `insert into core.platform_role_assignments (user_id, role_id)
     select $1, id from core.platform_roles where key = $2`,
    [userId, roleKey],
  );
}

/**
 * Ejecuta `fn` como el usuario indicado, igual que la API: transacción, claims del JWT y rol
 * `authenticated` (RLS activo). Revierte siempre salvo `commit: true`.
 */
export async function asUser(db, user, fn, { aal = "aal2", commit = true } = {}) {
  await db.query("begin");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: user.id, role: "authenticated", aal }),
    ]);
    await db.query("set local role authenticated");
    const result = await fn(db);
    await db.query(commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

export async function expectPgError(promise, code, messageIncludes) {
  try {
    await promise;
  } catch (error) {
    if (error.code !== code) {
      throw new Error(`Se esperaba SQLSTATE ${code} y llegó ${error.code}: ${error.message}`);
    }
    if (messageIncludes && !String(error.message).includes(messageIncludes)) {
      throw new Error(`Se esperaba "${messageIncludes}" y llegó "${error.message}"`);
    }
    return error;
  }
  throw new Error(`Se esperaba el error ${code} y la operación terminó bien`);
}

export function slug(prefix = "org") {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
