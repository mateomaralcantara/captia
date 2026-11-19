import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { DatabaseService } from "./database.service.js";


const config = loadConfig();
const app = await createApp(config);

// Diagnóstico al arrancar: avisa en consola si la base de datos o la migración no están listas.
const diag = await app.get(DatabaseService).diagnose();
if (!diag.database.ok) console.warn(`⚠ Base de datos: ${diag.database.detail}`);
else if (!diag.migrations.ok) console.warn(`⚠ ${diag.migrations.detail}`);
else console.log("Base de datos y migraciones: OK");
await app.listen(config.port, config.host);
console.log(`CAPTIA API escuchando en http://${config.host}:${config.port} (OpenAPI: /v1/openapi.json)`);
