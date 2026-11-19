import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await createApp(config);
await app.listen(config.port, config.host);
console.log(`CAPTIA API escuchando en http://${config.host}:${config.port} (OpenAPI: /v1/openapi.json)`);
