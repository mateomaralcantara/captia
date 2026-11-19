// Desarrollo de la API, multiplataforma (Windows, macOS, Linux):
// compila una vez, luego recompila en modo watch y reinicia el servidor cuando cambia dist/.
// Carga las variables del .env de la raíz del monorepo.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsc = createRequire(path.join(apiDir, "package.json")).resolve("typescript/bin/tsc");
const envFile = path.resolve(apiDir, "../../.env");

const first = spawnSync(process.execPath, [tsc, "-p", "tsconfig.json"], { cwd: apiDir, stdio: "inherit" });
if (first.status !== 0) {
  console.error("\nLa API no compila. Si faltan @captia/validation: ejecuta `pnpm run build:packages` en la raíz.");
  process.exit(first.status ?? 1);
}
if (!existsSync(envFile)) console.warn(`Aviso: no existe ${envFile}; copia .env.example a .env en la raíz.`);

const children = [
  spawn(process.execPath, [tsc, "-p", "tsconfig.json", "--watch", "--preserveWatchOutput"], { cwd: apiDir, stdio: "inherit" }),
  spawn(
    process.execPath,
    [...(existsSync(envFile) ? [`--env-file=${envFile}`] : []), "--watch", "dist/src/main.js"],
    { cwd: apiDir, stdio: "inherit" },
  ),
];
const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const c of children) c.on("exit", (code) => code && code !== 0 && console.error(`Proceso terminó con código ${code}`));
