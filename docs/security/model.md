# Modelo de seguridad (Entrega 1)

| Control | Implementación | Prueba |
|---|---|---|
| Autenticación | Supabase Auth; la API verifica firma (JWKS/HS256), `iss`, `aud`, `exp`, `sub`, `role` | `apps/api/test/unit.test.ts`, TEST 001 |
| Sesiones web | Tokens en cookies `httpOnly`, `SameSite=Lax`, `Secure` en producción; renovación en `proxy.ts`; logout revoca en Auth | E2E |
| MFA administradores | Funciones SQL exigen `aal2` (flag `mfa_required_for_admins`, activo) | `tests/db`, API y E2E |
| RBAC | 8 roles: los 7 de la especificación más «auditor de plataforma» (superadmin, platform_admin, platform_auditor; org_admin, supervisor, operator, user, auditor); permisos en tabla; roles personalizados por organización | `tests/db` TEST 009 |
| Escalada de privilegios | No se puede conceder/modificar un rol con permisos que el actor no tiene | `tests/db` |
| Último administrador | Una organización no puede quedarse sin miembros con `members.manage` | `tests/db`, API |
| Aislamiento multi-tenant | RLS en las 13 tablas; API ejecuta como `authenticated`; 404 sin revelar existencia | TEST 002/014 en SQL, API y navegador |
| Escrituras | Solo vía funciones `security definer` con `search_path=''`; `authenticated` sin INSERT/UPDATE/DELETE | `tests/db` (comprobación automática de search_path y RLS) |
| Auditoría | `core.audit_events` solo inserción (trigger bloquea UPDATE/DELETE/TRUNCATE incluso a superusuario), actor, correo y `aal` | TEST 012 |
| Idempotencia | `Idempotency-Key` en creación de organizaciones | TEST 011 parcial |
| Rate limiting | Por usuario/IP, cuota de escrituras separada; 429 + `Retry-After` | API |
| Cabeceras | API: `nosniff`, `DENY`, `no-referrer`, `no-store`; Web: CSP estricta (`connect-src 'self'`), HSTS | — |
| Errores | `problem+json`; errores internos registrados con id de petición, nunca devueltos | unit |
| Secretos | Solo variables de entorno del servidor; `service_role` solo para invitaciones; nada en el cliente | revisión |
| Invitaciones | Se comprueba `members.manage` antes de llamar a Supabase Auth (no se puede usar para enviar correos) | API |

## Pendiente (siguientes entregas)

- Rate limiting distribuido en Redis (ADR-005).
- Gestor de secretos (Vault/OpenBao) cuando existan credenciales SIP, de correo y de nodos.
- Exportación automática de auditoría a almacenamiento inmutable.
- Pruebas de seguridad dinámicas (OWASP ZAP) en CI contra staging.
- Política de contraseñas y bloqueo progresivo: se configuran en Supabase Auth (Auth → Policies).
