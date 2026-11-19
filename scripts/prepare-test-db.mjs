// Recrea la base `captia_test` en el servidor de TEST_DATABASE_URL y aplica:
//   supabase/tests/bootstrap.sql  (réplica mínima de Supabase Auth)
//   supabase/migrations/*.sql     (en orden)
// Imprime la URL resultante en TEST_DATABASE_URL_FILE si se define.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverUrl = process.env.TEST_DATABASE_URL;
if (!serverUrl) throw new Error("TEST_DATABASE_URL no está definida");

const admin = new pg.Client({ connectionString: serverUrl });
await admin.connect();
await admin.query("drop database if exists captia_test with (force)");
await admin.query("create database captia_test");
await admin.end();

const url = new URL(serverUrl);
url.pathname = "/captia_test";
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
try {
  await db.query(await readFile(path.join(root, "supabase/tests/bootstrap.sql"), "utf8"));
  const dir = path.join(root, "supabase/migrations");
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    await db.query(await readFile(path.join(dir, file), "utf8"));
    console.log(`migración aplicada: ${file}`);
  }
} finally {
  await db.end();
}
