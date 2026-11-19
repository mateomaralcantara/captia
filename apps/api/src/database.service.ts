import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import pg from "pg";
import { APP_CONFIG, type AppConfig } from "./config.js";
import type { AuthContext } from "./auth/jwt-verifier.js";

export type Db = Pick<pg.PoolClient, "query">;

/**
 * Acceso a PostgreSQL. Toda consulta de usuario se ejecuta con `asUser`: una transacción con los
 * claims del JWT (`request.jwt.claims`) y `set local role authenticated`, igual que la Data API de
 * Supabase. Así RLS y las comprobaciones de las funciones SQL aplican siempre, también si la API
 * tuviera un fallo de autorización.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  readonly pool: pg.Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const ssl =
      config.database.ssl === "disable"
        ? false
        : { rejectUnauthorized: config.database.ssl === "verify-full" };
    this.pool = new pg.Pool({
      connectionString: config.database.url,
      max: config.database.poolMax,
      ssl,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
      application_name: "captia-api",
    });
    this.pool.on("error", (error) => this.logger.error(`Error del pool de PostgreSQL: ${error.message}`));
  }

  async asUser<T>(auth: AuthContext, fn: (db: Db) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(auth.claims)]);
      await client.query("set local role authenticated");
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Diagnóstico para /v1/health y el arranque: conexión y presencia del esquema de CAPTIA.
   * Los detalles son categorías genéricas (no se exponen mensajes del servidor de base de datos).
   */
  async diagnose(): Promise<{ database: { ok: boolean; detail?: string }; migrations: { ok: boolean; detail?: string } }> {
    try {
      const { rows } = await this.pool.query(
        "select to_regclass('core.organizations') is not null as core, to_regprocedure('core.my_context()') is not null as fn",
      );
      const row = rows[0] as { core: boolean; fn: boolean };
      return {
        database: { ok: true },
        migrations: row.core && row.fn
          ? { ok: true }
          : { ok: false, detail: "Faltan las tablas de CAPTIA: aplica supabase/migrations/*.sql en Supabase" },
      };
    } catch (error) {
      return { database: { ok: false, detail: describeDatabaseError(error) }, migrations: { ok: false } };
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query("select 1");
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

/** Traduce errores de conexión a una explicación genérica y útil para el operador. */
export function describeDatabaseError(error: unknown): string {
  const code = String((error as { code?: unknown })?.code ?? "");
  const message = String((error as { message?: unknown })?.message ?? "");
  if (code === "28P01" || code === "28000") return "Usuario o contraseña de la base de datos incorrectos (revisa DATABASE_URL)";
  if (code === "3D000") return "La base de datos indicada en DATABASE_URL no existe";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "No se encuentra el servidor de DATABASE_URL (revisa el host; usa la cadena «Session pooler» de Supabase)";
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ENETUNREACH" || /timeout/i.test(message)) {
    return "No se puede conectar con la base de datos (host, puerto o red; usa la cadena «Session pooler» de Supabase)";
  }
  if (/ssl|tls|certificate/i.test(message)) return "Error de SSL con la base de datos (prueba DATABASE_SSL=require)";
  if (/tenant or user not found/i.test(message)) return "Usuario del pooler incorrecto: en Supabase debe ser postgres.<ref-del-proyecto>";
  return "Error de conexión con la base de datos";
}
