# CLAUDE.md

Guía para Claude Code y cualquier colaborador de CAPTIA OS.

## Reglas del proyecto

- **Nada se presenta como activo si no lo es.** Lo que no tenga backend real usa el catálogo
  `core.service_catalog` (estado + motivo + entrega) y la página `/modulo/<clave>`. Nunca datos de ejemplo.
- Un dispositivo solo es «conectado» si su agente lo confirmó; un correo solo es «entregado» con
  evento del MTA; un número solo es «activo» con asignación real del operador.
- Sin IMEI/SIM ficticios, sin ocultar emuladores, sin interceptar códigos de terceros, sin funciones
  para evadir antifraude o políticas de plataformas externas.
- Entregas en orden (ver `docs/operations/acceptance-entrega-1.md`); no se cierra una con errores críticos.
- Textos visibles al usuario en `apps/web/lib/i18n.ts` (español por defecto, inglés).

## Comandos

```bash
pnpm install
pnpm run validate   # typecheck, lint, pruebas (paquetes, SQL, API), build y E2E del panel
pnpm test           # sin E2E
pnpm run test:db    # solo SQL
```

Las pruebas con base de datos usan `scripts/test-db.sh`: con `TEST_DATABASE_URL` usa ese servidor
(crea y BORRA `captia_test`); sin ella arranca un PostgreSQL temporal con los binarios locales.

## Base de datos

- Migraciones en `supabase/migrations/` (nombre `AAAAMMDDHHMMSS_descripcion.sql`) con su reversión en
  `supabase/rollback/`. Nunca edites una migración ya aplicada en un entorno compartido: crea otra.
- Esquema `core`, no expuesto por la Data API. RLS en **todas** las tablas (lo comprueba una prueba).
- Los usuarios no escriben tablas: solo funciones `security definer` con `set search_path = ''`, nombres
  calificados, comprobación de permiso (`core.assert_org_permission`), `core.assert_admin_mfa()` en
  acciones administrativas y `core.write_audit(...)` en la misma transacción.
- Errores de negocio: `raise exception '<codigo>' using errcode = 'CA4xx'`; el código debe existir en
  `ERROR_CODES` (`packages/validation`).
- `supabase/tests/bootstrap.sql` replica lo mínimo de Supabase para pruebas; nunca se aplica en Supabase.

## API (apps/api)

- NestJS 12 ESM; `@Inject(...)` explícito en constructores.
- Toda consulta de usuario va por `DatabaseService.asUser(auth, fn)` (claims + `role authenticated`).
  La conexión privilegiada (`pool` directo) solo para datos públicos (catálogo) o salud.
- Entradas validadas con los esquemas de `@captia/validation` (`parseInput`); IDs con `parseId`.
- Errores con `ProblemError`; nunca devolver mensajes internos.
- Al añadir una ruta: controlador + registro en `src/openapi.ts` (una prueba comprueba que coinciden) +
  método en `@captia/api-client` + `pnpm --filter @captia/api run openapi`.

## Web (apps/web)

- Next.js 16 (`proxy.ts`), componentes de servidor por defecto; mutaciones con server actions en
  `app/actions.ts` que llaman a la API con el token del usuario.
- Tokens solo en cookies `httpOnly`; el navegador nunca habla con Supabase ni con la API directamente
  (`connect-src 'self'`).
- Acciones destructivas con confirmación.
