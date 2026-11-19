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
