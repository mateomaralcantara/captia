# API de CAPTIA (v1)

- Especificación: `GET /v1/openapi.json` (OpenAPI 3.1, generada desde los esquemas zod de
  `@captia/validation`). Copia versionada: `packages/api-client/openapi.json`
  (`pnpm --filter @captia/api run openapi`), útil para generar el cliente Dart/Flutter.
- Cliente TypeScript tipado: `@captia/api-client` (valida cada respuesta con el contrato).
- Autenticación: `Authorization: Bearer <access_token de Supabase Auth>`.
- Errores: `application/problem+json` (RFC 9457) con `code` estable:

| HTTP | `code` |
|---|---|
| 401 | `unauthenticated`, `mfa_required` |
| 403 | `forbidden`, `cannot_grant_role` |
| 404 | `not_found`, `organization_not_found`, `member_not_found`, `user_not_found`, `role_not_found` |
| 409 | `conflict`, `slug_taken`, `already_member`, `last_admin` |
| 422 | `validation_failed` (con `errors[]`), `invalid_organization`, `invalid_status`, `role_from_other_organization` |
| 429 | `rate_limited` (+ `Retry-After`) |
| 503 | `not_configured`, `service_unavailable` |

## Rutas (Entrega 1)

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/v1/health` | público |
| GET | `/v1/service-catalog` | público |
| GET | `/v1/openapi.json` | público |
| GET | `/v1/me` | sesión |
| GET | `/v1/permissions` | sesión |
| GET | `/v1/dashboard/summary[?organizationId=]` | `dashboard.read` / `platform.dashboard.read` |
| GET | `/v1/platform/audit-events` | `platform.audit.read` |
| GET | `/v1/organizations` | filtrado por RLS |
| POST | `/v1/organizations` (`Idempotency-Key`) | `platform.organizations.create` + MFA |
| GET | `/v1/organizations/{id}` | `organization.read` |
| PATCH | `/v1/organizations/{id}` | `organization.update` (estado: `platform.organizations.suspend`) + MFA |
| GET | `/v1/organizations/{id}/members` | `members.read` |
| POST | `/v1/organizations/{id}/members` | `members.manage` + MFA |
| PATCH | `/v1/organizations/{id}/members/{memberId}` | `members.manage` + MFA |
| DELETE | `/v1/organizations/{id}/members/{memberId}` | `members.manage` + MFA |
| GET | `/v1/organizations/{id}/roles` | `roles.read` |
| GET | `/v1/organizations/{id}/audit-events` | `audit.read` |

Las rutas de dispositivos, voz, correo, identidad, aprovisionamiento y facturación de la
especificación se añaden en sus entregas; no existen todavía y no se simulan.
