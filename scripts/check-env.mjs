#!/usr/bin/env node
// Verifica la configuración de CAPTIA (.env de la raíz) y prueba las conexiones reales.
// Uso: pnpm run check        (Windows, macOS y Linux)
// Nunca imprime contraseñas ni claves: solo hosts, usuarios y resultados.
import { readFileSync, existsSync } from "node:fs";
import { lookup } from "node:dns/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

let problems = 0;
let warnings = 0;
const ok = (msg) => console.log(`  ✔ ${msg}`);
const bad = (msg, fix) => {
  problems++;
  console.log(`  ✖ ${msg}`);
  if (fix) console.log(`      → ${fix}`);
};
const warn = (msg, fix) => {
  warnings++;
  console.log(`  ⚠ ${msg}`);
  if (fix) console.log(`      → ${fix}`);
};
const section = (title) => console.log(`\n${title}`);

// --- 1. Archivo .env ---------------------------------------------------------------------------
section("1. Archivo .env");
if (!existsSync(envPath)) {
  bad(`No existe ${envPath}`, "Copia .env.example a .env en la raíz del proyecto (Copy-Item .env.example .env)");
  finish();
  process.exit(1);
}
ok(`Encontrado: ${envPath}`);

const env = {};
const seen = new Map();
readFileSync(envPath, "utf8")
  .split(/\r?\n/)
  .forEach((line, i) => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) return;
    const [, key, raw] = m;
    let value = raw.replace(/\s+#.*$/, "").trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (seen.has(key)) bad(`${key} aparece dos veces (líneas ${seen.get(key)} y ${i + 1})`, "Deja una sola línea con ese nombre");
    seen.set(key, i + 1);
    env[key] = value;
  });

const PLACEHOLDER = /TU-PROYECTO|CAMBIAR|\[YOUR-PASSWORD\]|YOUR-PASSWORD|xxxxxxxx/i;
function required(key, fix) {
  const v = env[key];
  if (!v) return bad(`${key} está vacía`, fix), null;
  if (PLACEHOLDER.test(v)) return bad(`${key} todavía tiene el texto de ejemplo`, fix), null;
  return v;
}

// --- 2. Variables -----------------------------------------------------------------------------
section("2. Variables");
const poolerFix = "Supabase → tu proyecto → Connect → Session pooler: copia la cadena y pon tu contraseña";
const dbUrlRaw = required("DATABASE_URL", poolerFix);
const supaUrlRaw = required("SUPABASE_URL", "Supabase → Project Settings → API → Project URL (https://<ref>.supabase.co)");
const pubKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
if (!pubKey) bad("SUPABASE_PUBLISHABLE_KEY está vacía", "Supabase → Project Settings → API Keys → Publishable key (o anon)");
else if (PLACEHOLDER.test(pubKey)) bad("SUPABASE_PUBLISHABLE_KEY tiene el texto de ejemplo");
else ok("SUPABASE_PUBLISHABLE_KEY definida");
const apiUrl = env.CAPTIA_API_URL || "";
if (!apiUrl) bad("CAPTIA_API_URL está vacía", "Pon CAPTIA_API_URL=http://127.0.0.1:4000");
if (env.SUPABASE_SERVICE_ROLE_KEY) ok("SUPABASE_SERVICE_ROLE_KEY definida (invitaciones activas; no la compartas)");
else console.log("  · SUPABASE_SERVICE_ROLE_KEY vacía: las invitaciones por correo quedan desactivadas (opcional)");

let dbUrl = null;
if (dbUrlRaw) {
  try {
    dbUrl = new URL(dbUrlRaw);
  } catch {
    bad("DATABASE_URL no es una URL válida", "Si la contraseña tiene @ # / ? o espacios, cámbiala en Supabase por una solo con letras y números");
  }
}
let ref = null;
if (dbUrl) {
  const host = dbUrl.hostname;
  const user = decodeURIComponent(dbUrl.username);
  console.log(`  · Base de datos: ${host}:${dbUrl.port || "5432"} · usuario ${user}`);
  if (!/^postgres(ql)?:$/.test(dbUrl.protocol)) bad("DATABASE_URL debe empezar por postgresql://");
  if (!dbUrl.password && !["localhost", "127.0.0.1"].includes(host)) bad("DATABASE_URL no tiene contraseña", "Formato: postgresql://usuario:CONTRASEÑA@host:5432/postgres");
  if (/^db\.[a-z0-9]+\.supabase\.co$/.test(host)) {
    warn("Usas la conexión directa (db.<ref>.supabase.co): solo funciona en redes IPv6", poolerFix);
    ref = host.split(".")[1];
  } else if (/pooler\.supabase\.com$/.test(host)) {
    ok("Host del Session pooler");
    const m = /^postgres\.([a-z0-9]+)$/.exec(user);
    if (!m) bad(`Con el pooler el usuario debe ser postgres.<ref-del-proyecto> y es «${user}»`, poolerFix);
    else ref = m[1];
    if (dbUrl.port === "6543") warn("Puerto 6543 (modo transacción): funciona, pero se recomienda 5432 (Session pooler)");
  } else if (["localhost", "127.0.0.1"].includes(host)) {
    ok("Base de datos local");
  }
}
let supaUrl = null;
if (supaUrlRaw) {
  try {
    supaUrl = new URL(supaUrlRaw);
    ok(`SUPABASE_URL: ${supaUrl.origin}`);
    const supaRef = /^([a-z0-9]+)\.supabase\.co$/.exec(supaUrl.hostname)?.[1];
    if (ref && supaRef && ref !== supaRef) {
      bad(`DATABASE_URL es del proyecto «${ref}» y SUPABASE_URL del proyecto «${supaRef}»`, "Ambas deben ser del mismo proyecto");
    }
  } catch {
    bad("SUPABASE_URL no es una URL válida");
  }
}
const ssl = env.DATABASE_SSL || "require";
if (!["disable", "require", "verify-full"].includes(ssl)) bad(`DATABASE_SSL=${ssl} no es válido`, "Usa require");

// --- 3. Conexiones reales ---------------------------------------------------------------------
section("3. Conexiones");
if (dbUrl) {
  let resolved = false;
  try {
    const { address } = await lookup(dbUrl.hostname);
    ok(`DNS: ${dbUrl.hostname} → ${address}`);
    resolved = true;
  } catch {
    bad(`Tu PC no encuentra el servidor ${dbUrl.hostname}`, poolerFix);
  }
  if (resolved) {
    const client = new pg.Client({
      connectionString: dbUrl.toString(),
      ssl: ssl === "disable" ? false : { rejectUnauthorized: ssl === "verify-full" },
      connectionTimeoutMillis: 10_000,
    });
    try {
      await client.connect();
      ok("Conexión a la base de datos");
      const { rows } = await client.query(
        "select to_regclass('core.organizations') is not null as core, to_regprocedure('core.my_context()') is not null as fn",
      );
      if (rows[0].core && rows[0].fn) {
        ok("Migración de CAPTIA aplicada (esquema core)");
        const admins = await client.query("select count(*)::int as n from core.platform_role_assignments");
        if (admins.rows[0].n === 0) {
          warn("Todavía no hay superadministrador", "Crea tu usuario en Supabase → Authentication y ejecuta: pnpm run bootstrap-admin -- tu-correo");
        } else ok(`Administradores de plataforma: ${admins.rows[0].n}`);
      } else {
        bad("Faltan las tablas de CAPTIA", "Supabase → SQL Editor: pega supabase/migrations/20261119000100_core.sql y pulsa Run");
      }
    } catch (error) {
      const code = error.code ?? "";
      const msg = String(error.message ?? "");
      if (code === "28P01" || /password authentication failed/i.test(msg)) {
        bad("Contraseña de la base de datos incorrecta", "Supabase → Project Settings → Database → Reset database password");
      } else if (/tenant or user not found/i.test(msg)) {
        bad("Usuario del pooler incorrecto", "Debe ser postgres.<ref> exactamente como en Connect → Session pooler");
      } else if (/ssl|certificate/i.test(msg)) {
        bad("Error de SSL", "Pon DATABASE_SSL=require");
      } else {
        bad(`No se pudo conectar a la base de datos (${code || "sin código"})`, poolerFix);
      }
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}

if (supaUrl && pubKey && !PLACEHOLDER.test(pubKey)) {
  try {
    const r = await fetch(`${supaUrl.origin}/auth/v1/settings`, {
      headers: { apikey: pubKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) {
      const s = await r.json();
      ok("Supabase Auth responde y acepta la clave publicable");
      if (s.disable_signup) warn("El registro de cuentas está desactivado en Supabase", "Authentication → Sign In / Providers → Allow new users to sign up");
      if (s.external && s.external.email === false) bad("El proveedor Email está desactivado", "Authentication → Sign In / Providers → Email");
    } else if (r.status === 401) {
      bad("Supabase rechaza SUPABASE_PUBLISHABLE_KEY", "Cópiala de nuevo de Project Settings → API Keys (y que sea del mismo proyecto)");
    } else {
      bad(`Supabase Auth respondió ${r.status}`);
    }
  } catch {
    bad(`No se pudo contactar con ${supaUrl.origin}`, "Revisa SUPABASE_URL y tu conexión a internet");
  }
}

if (apiUrl) {
  try {
    const r = await fetch(`${apiUrl.replace(/\/+$/, "")}/v1/health`, { signal: AbortSignal.timeout(5_000) });
    const h = await r.json();
    if (h.status === "ok") ok(`API de CAPTIA en marcha y sana (${apiUrl})`);
    else warn(`La API responde pero está degradada: ${h.checks?.database?.detail ?? h.checks?.migrations?.detail ?? "ver /v1/health"}`,
      "Si arreglaste el .env, reinicia la API (Ctrl+C y pnpm run dev:api): el .env solo se lee al arrancar");
  } catch {
    console.log(`  · La API no está en marcha en ${apiUrl} (arráncala con: pnpm run dev:api)`);
  }
}

finish();

function finish() {
  console.log("");
  if (problems === 0) {
    console.log(warnings ? `✔ Configuración correcta, con ${warnings} aviso(s).` : "✔ Todo correcto.");
  } else {
    console.log(`✖ Hay ${problems} problema(s). Corrige lo marcado con ✖ y vuelve a ejecutar: pnpm run check`);
  }
  // exitCode en lugar de process.exit(): en Windows, salir con conexiones HTTP aún cerrándose
  // provoca «Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)» en Node 24.
  process.exitCode = problems === 0 ? 0 : 1;
}
