// Concede el rol de superadministrador a un usuario YA registrado en Supabase Auth.
// Uso: DATABASE_URL=... pnpm --filter @captia/api run bootstrap-admin -- correo@dominio
// Se ejecuta con acceso directo a la base de datos (operador de la plataforma), nunca vía API.
import pg from "pg";

const email = process.argv.slice(2).find((a) => a.includes("@"));
if (!email) {
  console.error("Uso: bootstrap-admin <correo>");
  process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Define DATABASE_URL (conexión directa a Postgres de Supabase).");
  process.exit(2);
}
const client = new pg.Client({
  connectionString: url,
  ssl: process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: process.env.DATABASE_SSL === "verify-full" },
});
await client.connect();
try {
  const { rows } = await client.query("select core.bootstrap_superadmin($1) as id", [email]);
  console.log(`Superadministrador concedido a ${email} (usuario ${rows[0].id}).`);
} catch (error) {
  console.error(`No se pudo conceder: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
