import { Inject, Injectable } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "./config.js";
import { ProblemError } from "./common/problem.js";

/**
 * Adaptador de la API de administración de Supabase Auth (GoTrue). Solo se usa para invitar usuarios
 * por correo. Sin SUPABASE_SERVICE_ROLE_KEY queda en estado "pendiente de configuración" y lo dice
 * explícitamente en lugar de simular la invitación.
 */
@Injectable()
export class SupabaseAdminAdapter {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get configured(): boolean {
    return Boolean(this.config.supabase.serviceRoleKey);
  }

  async inviteUser(email: string): Promise<void> {
    const key = this.config.supabase.serviceRoleKey;
    if (!key) {
      throw new ProblemError("not_configured", "Las invitaciones requieren SUPABASE_SERVICE_ROLE_KEY en la API");
    }
    const response = await fetch(`${this.config.supabase.url}/auth/v1/invite`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);

    if (!response) throw new ProblemError("service_unavailable", "Supabase Auth no respondió");
    if (response.status === 422) {
      throw new ProblemError("conflict", "Supabase Auth rechazó la invitación (¿el usuario ya existe?)");
    }
    if (!response.ok) throw new ProblemError("service_unavailable", `Supabase Auth respondió ${response.status}`);
  }
}
