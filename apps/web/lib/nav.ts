import type { Dictionary } from "./i18n";

/**
 * Menú principal (18 secciones). Las que todavía no tienen backend apuntan a /modulo/<clave>, que
 * muestra el estado real del catálogo de servicios del servidor, nunca datos simulados.
 */
export const NAV: { key: keyof Dictionary["nav"]; href: string; catalogKey?: string }[] = [
  { key: "overview", href: "/" },
  { key: "virtualPhones", href: "/modulo/phone.virtual", catalogKey: "phone.virtual" },
  { key: "physicalPhones", href: "/modulo/phone.physical", catalogKey: "phone.physical" },
  { key: "cloudDevices", href: "/modulo/phone.cloud", catalogKey: "phone.virtual" },
  { key: "voip", href: "/modulo/voice.internal", catalogKey: "voice.internal" },
  { key: "numbers", href: "/modulo/voice.public", catalogKey: "voice.public" },
  { key: "mail", href: "/modulo/mail.mailboxes", catalogKey: "mail.mailboxes" },
  { key: "identities", href: "/modulo/id.identities", catalogKey: "id.identities" },
  { key: "networks", href: "/modulo/control.network", catalogKey: "control.network" },
  { key: "infrastructure", href: "/modulo/control.infrastructure", catalogKey: "control.infrastructure" },
  { key: "aiAgents", href: "/modulo/ai.harness", catalogKey: "ai.harness" },
  { key: "automations", href: "/modulo/ai.automations", catalogKey: "ai.automations" },
  { key: "customers", href: "/clientes" },
  { key: "subscriptions", href: "/modulo/billing.subscriptions", catalogKey: "billing.subscriptions" },
  { key: "billing", href: "/modulo/billing.invoices", catalogKey: "billing.invoices" },
  { key: "security", href: "/seguridad" },
  { key: "audit", href: "/auditoria" },
  { key: "settings", href: "/configuracion" },
];

/** Alias de rutas de módulo a claves del catálogo (p. ej. "phone.cloud" depende de "phone.virtual"). */
export function catalogKeyFor(moduleKey: string): string | null {
  return NAV.find((n) => n.href === `/modulo/${moduleKey}`)?.catalogKey ?? null;
}
