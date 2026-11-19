// Desarrollo de la API, multiplataforma (Windows, macOS, Linux).
// Arranca TypeScript en modo watch y, cuando termina la primera compilación sin errores, arranca la
// API con `node --watch` (se reinicia sola cuando cambia dist/). Carga el .env de la raíz.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsc = createRequire(path.join(apiDir, "package.json")).resolve("typescript/bin/tsc");
const envFile = path.resolve(apiDir, "../../.env");
if (!existsSync(envFile)) console.warn(`Aviso: no existe ${envFile}; copia .env.example a .env en la raíz.`);

let server = null;
const watcher = spawn(process.execPath, [tsc, "-p", "tsconfig.json", "--watch", "--preserveWatchOutput"], {
  cwd: apiDir,
  stdio: ["ignore", "pipe", "inherit"],
});
watcher.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (!server && /Found 0 errors/.test(text)) {
    server = spawn(
      process.execPath,
      [...(existsSync(envFile) ? [`--env-file=${envFile}`] : []), "--watch", "dist/src/main.js"],
      { cwd: apiDir, stdio: "inherit" },
    );
  } else if (!server && /Found [1-9]\d* errors?/.test(text)) {
    console.error("La API no compila. Si faltan @captia/validation: ejecuta `pnpm run build:packages` en la raíz.");
  }
});

const stop = () => {
  watcher.kill();
  server?.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
