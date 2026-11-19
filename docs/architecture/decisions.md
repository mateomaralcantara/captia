# Decisiones de arquitectura (ADR)

Cada decisión indica estado: **Vigente** (implementada), **Propuesta** (para una entrega futura,
revisable con datos reales).

## ADR-001 · Monorepo con pnpm workspaces — Vigente

`apps/` (web, api), `packages/` (validation, api-client), `supabase/` (migraciones), `tests/`, `docs/`.
pnpm por su resolución estricta y velocidad. Sin Turborepo/Nx de momento: los scripts raíz construyen
primero `packages/*` y después `apps/*`; se añadirá caché de tareas cuando el tiempo de CI lo justifique.

## ADR-002 · API NestJS 12 (ESM) con validación zod — Vigente

- NestJS 12 es ESM; la API compila con `tsc` (`module: nodenext`) y se ejecuta con Node 22.
- La validación usa **zod** en lugar de class-validator: los mismos esquemas (`@captia/validation`)
  validan la entrada en la API, tipan el cliente web y generan la especificación **OpenAPI 3.1**
  (`z.toJSONSchema`). Una sola fuente de verdad para el contrato.
- La inyección de dependencias usa `@Inject(...)` explícito: no depende de `emitDecoratorMetadata`.
- Pruebas con `node --test` sobre el código compilado (sin transformadores que rompan decoradores).

## ADR-003 · Autorización en PostgreSQL, por petición — Vigente

La API no usa la `service_role` para servir a usuarios. Cada petición se ejecuta en una transacción
con `set_config('request.jwt.claims', <claims verificados>)` y `set local role authenticated`, igual
que la Data API de Supabase. Consecuencias:

- **RLS** filtra todas las lecturas, aunque la API tuviera un fallo de autorización.
- Las escrituras solo existen como **funciones `security definer`** que comprueban permiso, MFA y
  escriben auditoría en la misma transacción. Una operación fallida no deja auditoría a medias.
- El esquema `core` no se expone por la Data API de Supabase (`supabase/config.toml`).
- Errores de negocio con SQLSTATE propios (`CA401/403/404/409/422`) que la API traduce a
  `application/problem+json` (RFC 9457) sin filtrar mensajes internos.

## ADR-004 · Supabase Auth como proveedor de identidad — Vigente

- Login, refresh, MFA TOTP y logout contra la API REST de Supabase Auth (GoTrue) desde el servidor de
  Next.js; los tokens viven en cookies `httpOnly`, nunca en el navegador.
- La API verifica JWT con las **claves públicas del proyecto (JWKS, RS256/ES256)** o, si el proyecto
  aún usa el secreto heredado, HS256. Exige `iss`, `aud=authenticated`, `exp`, `sub` UUID y
  `role=authenticated`.
- **MFA para administradores** se aplica en SQL: las funciones administrativas exigen `aal=aal2`
  mientras el flag `mfa_required_for_admins` esté activo (lo está por defecto).

## ADR-005 · Límite de peticiones en memoria (temporal) — Vigente

Ventana fija por usuario (o IP) con cuota menor para escrituras. Correcto para una instancia de API.
**Se sustituye por Redis** en la Entrega 2, cuando entra BullMQ para los trabajos de dispositivos y la
API pase a varias réplicas.

## ADR-006 · Catálogo de servicios como fuente de verdad del estado — Vigente

`core.service_catalog` declara cada servicio como `implemented`, `pending_infrastructure`,
`pending_authorization`, `experimental` o `unavailable`, con motivo y entrega. El panel construye su
menú y las páginas de módulos pendientes a partir de él: nada se muestra como activo sin estarlo.

## ADR-007 · Virtualización Android — Propuesta (Entrega 2)

Candidato principal: **Cuttlefish (AOSP) sobre KVM**, diseñado por AOSP para servidores, con varias
instancias por host, WebRTC integrado y ADB. Alternativa: Android Emulator (headless) para
laboratorio. Descartado como base: Redroid (comparte kernel del host, aislamiento insuficiente entre
clientes). Docker solo para servicios auxiliares. Sin GMS sin licencia. Sin IMEI/SIM ficticios.
La elección final se confirma con un benchmark en el primer nodo (arranque, RAM/CPU por instancia,
latencia de streaming, fallos).

## ADR-008 · Telefonía interna — Propuesta (Entrega 3)

**Asterisk 22 LTS con PJSIP Realtime sobre PostgreSQL** y ARI: crear una extensión = escribir filas
desde el plano de control, sin recargar ficheros. WebRTC (WSS + DTLS-SRTP) para el softphone y
coturn para NAT. Kamailio + rtpengine delante cuando la escala lo justifique.

## ADR-009 · Correo — Propuesta (Entrega 4)

Según la especificación, **mailcow** como implementación inicial (Postfix + Dovecot + Rspamd +
SOGo/ClamAV, con API REST para dominios, buzones, alias y cuotas), integrado mediante un adaptador
`MailProvider`. **Stalwart** se evalúa con el mismo adaptador (un binario, API de administración,
JMAP); se sustituirá solo si las pruebas de carga y operación lo justifican.
Un buzón se declara creado solo con respuesta real del servidor de correo; un correo, entregado solo
con evento de entrega del MTA.

## ADR-010 · Sin Kubernetes al inicio — Vigente

Docker Compose + Ansible para servicios auxiliares; Nomad o Kubernetes solo cuando haya varios nodos
y un beneficio medido.
