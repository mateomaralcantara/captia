# CAPTIA OS

Plataforma para crear, administrar y comercializar dispositivos Android (virtuales y físicos),
telefonía IP propia, correo propio, identidades digitales y agentes de IA, gestionada desde
**CAPTIA Control**.

> **Estado actual: Entrega 1 (núcleo) completada.** Funciona: autenticación con MFA, organizaciones,
> usuarios, roles y permisos, auditoría, API v1 y panel. **Aún no existen** Android, telefonía, correo,
> identidades, facturación ni IA: el panel lo muestra así, sin datos simulados.

## Estado por producto

| Producto | Estado | Entrega |
|---|---|---|
| CAPTIA Control (organizaciones, usuarios, RBAC, auditoría) | ✅ Implementado y probado | 1 |
| CAPTIA Phone — Android virtual | ⛔ No disponible (requiere nodo KVM) | 2 |
| CAPTIA Voice — telefonía interna | ⛔ No disponible | 3 |
| CAPTIA Mail | ⛔ No disponible (requiere dominio propio verificado) | 4 |
| CAPTIA ID | ⛔ No disponible | 5 |
| CAPTIA Phone — Android físico | ⛔ No disponible | 6 |
| Comercialización y facturación | ⛔ No disponible | 7 |
| CAPTIA AI (Harness) | ⛔ No disponible | 8 |
| Telefonía pública (DID, SIP trunks) | ⏳ Pendiente de autorización regulatoria | 9 |

## Inicio rápido

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm run validate
```

Configuración de Supabase, primer superadministrador y arranque: [docs/deployment/local.md](docs/deployment/local.md).

## Estructura

```
apps/api            API NestJS (REST v1, OpenAPI 3.1)
apps/web            CAPTIA Control (Next.js 16 + Tailwind 4)
packages/validation Contratos zod compartidos, permisos y códigos de error
packages/api-client Cliente tipado + openapi.json
supabase/           Migraciones, reversiones y réplica mínima de Auth para pruebas
tests/db            Pruebas SQL (RLS, permisos, auditoría)
services/           Servicios del plano de datos (entregas 2+)
infrastructure/     Aprovisionamiento (entregas 2+)
docs/               Arquitectura, API, despliegue, seguridad, operaciones
```

## Documentación

- [Prototipo visual del producto completo](docs/prototipo/README.md) (maqueta con datos de ejemplo; abre `docs/prototipo/captia-prototipo.html`)

- [Entrega 0 · Discovery](docs/operations/discovery-entrega-0.md)
- [Arquitectura](docs/architecture/overview.md) · [Decisiones (ADR)](docs/architecture/decisions.md)
- [API](docs/api/README.md) · [Seguridad](docs/security/model.md)
- [Aceptación de la Entrega 1](docs/operations/acceptance-entrega-1.md)

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm run check` | Verifica el `.env` y las conexiones (base de datos, migración, Supabase, API) |
| `pnpm run dev:api` / `pnpm run dev:web` | Desarrollo |
| `pnpm run typecheck` | TypeScript estricto en todo el monorepo |
| `pnpm run lint` | ESLint |
| `pnpm test` | Paquetes + SQL + API (PostgreSQL desechable) |
| `pnpm run test:web` | E2E del panel con Chromium (requiere `pnpm run build`) |
| `pnpm run validate` | Todo lo anterior + build |
