import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { DatabaseService } from "./database.service.js";


const config = loadConfig();
const app = await createApp(config);

// Diagnóstico al arrancar: avisa en consola si la base de datos o la migración no están listas.
try {
  const u = new URL(config.database.url);
  console.log(`Base de datos: ${u.hostname}:${u.port || "5432"} · usuario ${decodeURIComponent(u.username)} · SSL ${config.database.ssl}`);
} catch {
  console.warn("⚠ DATABASE_URL no es una URL válida (¿la contraseña tiene @, # o /? cámbiala por una solo con letras y números)");
}
const diag = await app.get(DatabaseService).diagnose();
if (!diag.database.ok) console.warn(`⚠ Base de datos: ${diag.database.detail}`);
else if (!diag.migrations.ok) console.warn(`⚠ ${diag.migrations.detail}`);
else console.log("Base de datos y migraciones: OK");
try {
  await app.listen(config.port, config.host);
} catch (error) {
  if ((error as { code?: string }).code === "EADDRINUSE") {
    console.error(
      `\n✖ El puerto ${config.port} ya está en uso: hay otra API (u otro programa) escuchando.\n` +
        "  Cierra la otra terminal de la API o cambia API_PORT (y CAPTIA_API_URL) en el .env.\n",
    );
    process.exit(1);
  }
  throw error;
}
console.log(`CAPTIA API escuchando en http://${config.host}:${config.port} (OpenAPI: /v1/openapi.json)`);
