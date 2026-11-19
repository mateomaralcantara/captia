import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import globals from "globals";
import tseslint from "typescript-eslint";

const WEB = "apps/web/**/*.{ts,tsx,js,jsx,mjs}";
const scopeToWeb = (config) => ({
  ...config,
  files: config.files ? config.files.map((f) => `apps/web/${f.replace(/^\*\*\//, "**/")}`) : [WEB],
  settings: { ...config.settings, next: { rootDir: "apps/web" } },
});

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-test/**",
      "**/.next/**",
      "apps/web/next-env.d.ts",
      "packages/api-client/openapi.json",
    ],
  },
  // API, paquetes, scripts y pruebas (Node).
  {
    files: ["**/*.{js,mjs}"],
    ignores: [WEB],
    ...js.configs.recommended,
    languageOptions: { globals: globals.node },
  },
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ["apps/api/**/*.ts", "packages/**/*.ts"] })),
  {
    files: ["apps/api/**/*.ts", "packages/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["apps/api/test/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  // Panel web (reglas de Next.js).
  ...nextVitals.map(scopeToWeb),
  ...nextTs.map(scopeToWeb),
];
