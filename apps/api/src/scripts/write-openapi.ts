// Escribe la especificación OpenAPI en packages/api-client/openapi.json (para clientes Flutter, etc.).
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiDocument } from "../openapi.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const target = path.join(root, "packages/api-client/openapi.json");
await writeFile(target, JSON.stringify(buildOpenApiDocument({ version: "0.1.0" }), null, 2) + "\n");
console.log(`OpenAPI escrita en ${target}`);
