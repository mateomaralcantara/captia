import { z } from "zod";

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().default("127.0.0.1"),
  /** Conexión directa a Postgres de Supabase (rol `postgres`). Solo backend. */
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_SSL: z.enum(["disable", "require", "verify-full"]).default("require"),
  /** https://<ref>.supabase.co — emisor de los JWT y base de la API de Auth. */
  SUPABASE_URL: z.url(),
  /** Secreto HS256 heredado de Supabase. Si falta, se verifica con las claves públicas (JWKS). */
  SUPABASE_JWT_SECRET: optionalString,
  /** Solo para invitar usuarios por correo. Sin ella, las invitaciones quedan "pendientes de configuración". */
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  /** Orígenes del panel web autorizados por CORS, separados por comas. */
  WEB_ORIGINS: z.string().default("http://localhost:3000"),
  /** Detrás de un proxy inverso de confianza (número de saltos). 0 = no confiar en X-Forwarded-For. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_WRITES_PER_MINUTE: z.coerce.number().int().min(1).default(60),
});

export type AppConfig = {
  env: "development" | "test" | "production";
  port: number;
  host: string;
  database: { url: string; poolMax: number; ssl: "disable" | "require" | "verify-full" };
  supabase: { url: string; issuer: string; jwtSecret?: string; serviceRoleKey?: string; jwksUrl: string };
  webOrigins: string[];
  trustProxyHops: number;
  rateLimit: { perMinute: number; writesPerMinute: number };
  version: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuración inválida de la API:\n${lines}`);
  }
  const e = parsed.data;
  const supabaseUrl = e.SUPABASE_URL.replace(/\/+$/, "");
  return {
    env: e.NODE_ENV,
    port: e.API_PORT,
    host: e.API_HOST,
    database: { url: e.DATABASE_URL, poolMax: e.DATABASE_POOL_MAX, ssl: e.DATABASE_SSL },
    supabase: {
      url: supabaseUrl,
      issuer: `${supabaseUrl}/auth/v1`,
      jwksUrl: `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
      ...(e.SUPABASE_JWT_SECRET ? { jwtSecret: e.SUPABASE_JWT_SECRET } : {}),
      ...(e.SUPABASE_SERVICE_ROLE_KEY ? { serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY } : {}),
    },
    webOrigins: e.WEB_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
    trustProxyHops: e.TRUST_PROXY_HOPS,
    rateLimit: { perMinute: e.RATE_LIMIT_PER_MINUTE, writesPerMinute: e.RATE_LIMIT_WRITES_PER_MINUTE },
    version: process.env.npm_package_version ?? "0.1.0",
  };
}

export const APP_CONFIG = Symbol("APP_CONFIG");
