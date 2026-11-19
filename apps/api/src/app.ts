import "reflect-metadata";
import { Module, type DynamicModule, type INestApplication } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { APP_CONFIG, type AppConfig } from "./config.js";
import { AuthGuard } from "./auth/auth.guard.js";
import { JwtVerifier } from "./auth/jwt-verifier.js";
import { ProblemFilter, RateLimitGuard, securityHeaders } from "./common/http.js";
import { DatabaseService } from "./database.service.js";
import { SupabaseAdminAdapter } from "./supabase-admin.adapter.js";
import { OrganizationsController, SystemController } from "./modules/controllers.js";
import { CoreService } from "./modules/core.service.js";

@Module({})
export class AppModule {
  static forConfig(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [SystemController, OrganizationsController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: JwtVerifier, useFactory: () => new JwtVerifier(config.supabase) },
        DatabaseService,
        SupabaseAdminAdapter,
        CoreService,
        // Orden importa: primero autenticación, luego límite (por usuario si hay sesión, por IP si no).
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_FILTER, useClass: ProblemFilter },
      ],
    };
  }
}

export async function createApp(config: AppConfig, options: { logger?: boolean } = {}): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forConfig(config), {
    logger: options.logger === false ? false : ["error", "warn", "log"],
    bodyParser: true,
  });
  app.set("trust proxy", config.trustProxyHops);
  app.disable("x-powered-by");
  app.useBodyParser("json", { limit: "100kb" });
  app.use(securityHeaders);
  app.enableCors({
    origin: config.webOrigins,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id", "RateLimit-Limit", "RateLimit-Remaining", "Retry-After"],
    maxAge: 600,
  });
  app.enableShutdownHooks();
  return app;
}
