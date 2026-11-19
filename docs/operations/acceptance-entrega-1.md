# Entrega 1 · Núcleo ejecutable — informe de aceptación

Fecha: 19-11-2026. Resultado de `pnpm run validate` en el entorno de desarrollo: **typecheck, ESLint,
build y 73 pruebas automáticas, 0 fallos.**

| Suite | Pruebas | Qué ejercita |
|---|---|---|
| `packages/validation` | 6 | Normalización y validación de entradas |
| `packages/api-client` | 4 | Cliente tipado, errores RFC 9457, rechazo de respuestas fuera de contrato |
| `tests/db` | 28 | Migración real en PostgreSQL 16: RLS, permisos, MFA, auditoría, idempotencia, privilegios |
| `apps/api/test` | 30 | API HTTP real contra PostgreSQL: JWT (HS256 y ES256/JWKS), multi-tenancy, permisos, errores, rate limit, invitaciones |
| `apps/web/test` | 5 | Navegador Chromium real: panel (build de producción) + API + PostgreSQL |

Comandos para reproducir: `pnpm install && pnpm run validate` (ver [../deployment/local.md](../deployment/local.md)).

## Criterio obligatorio de la Entrega 1

> Un administrador puede iniciar sesión, crear una organización, administrar usuarios y consultar
> recursos reales.

**PASS** en navegador (`apps/web/test/e2e.test.mjs`, prueba 2): inicia sesión, el resumen muestra el
número real de organizaciones de la base, crea «Empresa E2E», añade un miembro como Operador, lo
cambia a Auditor, lo quita (con confirmación) y la auditoría muestra las cuatro acciones; después
cierra sesión. Capturas: `E2E_SCREENSHOTS_DIR=/ruta pnpm run test:web`.

**Limitación:** en este entorno Supabase Auth se sustituyó por un **doble de prueba** que emite JWT con
el formato de GoTrue (no hay proyecto Supabase ni Docker). La API, el panel y la base de datos son
reales. La validación contra Supabase Auth real queda automatizada en CI (`supabase-migrations`
aplica la migración sobre un Supabase local real) y pendiente de un proyecto Supabase del operador.

## Pruebas de aceptación del prompt maestro

| Test | Resultado | Evidencia / motivo |
|---|---|---|
| 001 Autenticación | **PASS** | API: token válido → 200; sin token, falso o caducado → 401 (`api.test.ts`). Navegador: login correcto e incorrecto |
| 002 Multi-tenancy | **PASS** | SQL, API (404 en las 5 rutas de B) y navegador (lista solo su organización; abrir otra → 404) |
| 003 Provisionamiento | **BLOCKED** | Aplica a dispositivos (Entrega 2). Lo equivalente de esta entrega (creación de organización rastreable en auditoría) pasa |
| 004 Android real | **BLOCKED** | Sin KVM en el entorno; Entrega 2 |
| 005 Persistencia | **BLOCKED** | Entrega 2 |
| 006 Telefonía interna | **BLOCKED** | Sin Asterisk; Entrega 3 |
| 007 Correo interno | **BLOCKED** | Sin servidor de correo ni dominio verificado; Entrega 4 |
| 008 Identidad | **BLOCKED** | Entrega 5 (depende de 2, 3 y 4) |
| 009 Permisos | **PASS** | Operador/admin sin permiso → 403; escalada de privilegios y último admin bloqueados; MFA exigido |
| 010 Facturación | **BLOCKED** | Entrega 7. El mecanismo de idempotencia ya existe y se reutilizará |
| 011 Recuperación | **PASS (parcial)** | Reintento con la misma `Idempotency-Key` no duplica; operación fallida no deja auditoría parcial. Las sagas de aprovisionamiento llegan en la Entrega 5 |
| 012 Auditoría | **PASS** | Cada acción con actor, correo y `aal`; inmutable incluso para superusuario |
| 013 Fallos externos | **BLOCKED** | No hay proveedores telefónicos todavía. Análogo probado: invitación con Auth no configurado → 503 `not_configured` sin efectos |
| 014 Seguridad | **PASS** | Acceso cruzado imposible en SQL, API y navegador; `anon` sin acceso; RLS en todas las tablas |
| 015 Agentes | **BLOCKED** | Entrega 8 |

## A–I · Resumen de la entrega

**A. Funcionalidad.** Plano de control: autenticación con Supabase Auth (contraseña + MFA TOTP),
organizaciones (crear, editar, suspender/reactivar), miembros (añadir, invitar, cambiar rol,
suspender, quitar), 3 roles de plataforma y 5 de organización con permisos configurables, auditoría
inmutable, catálogo de servicios honesto, resumen con datos reales, API REST v1 con OpenAPI 3.1,
panel CAPTIA Control (18 secciones de menú; las no implementadas muestran su estado real), es/en.

**B. Archivos.** Ver `git show --stat` del commit de la entrega.

**C. Base de datos.** `supabase/migrations/20261119000100_core.sql` (reversión:
`supabase/rollback/20261119000100_core.down.sql`).

**D. APIs.** [../api/README.md](../api/README.md).

**E. Pruebas.** Tabla de arriba.

**F. Ejecución.** [../deployment/local.md](../deployment/local.md).

**G. Infraestructura.** Necesaria: proyecto Supabase (o `supabase start`), un servidor para API y panel.
Estado: ninguna conectada en este entorno (ver [discovery-entrega-0.md](discovery-entrega-0.md)).

**H. Limitaciones.**
- No validado contra Supabase Auth real en local (doble de prueba); sí en CI.
- Rate limiting en memoria: una sola réplica de API hasta la Entrega 2.
- Sin app Flutter todavía (la especificación OpenAPI ya permite generar su cliente).
- La gestión de roles personalizados existe en el modelo de datos, pero aún no tiene pantalla ni endpoint de edición.
- El push al repositorio está bloqueado hasta instalar la app de Claude en GitHub.

**I. Siguiente fase.** Entrega 2 — primer Android virtual: requiere un servidor Linux con KVM.
Se implementará el agente de nodo (registro con certificado, heartbeat, trabajos idempotentes),
plantillas, ciclo de vida de instancias, Redis + BullMQ y streaming. Sin KVM, se entregarán los
contratos, el agente y sus pruebas, y el aprovisionamiento real quedará marcado como pendiente de
hardware.
