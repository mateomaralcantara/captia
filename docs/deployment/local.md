# Ejecución local y despliegue de la Entrega 1

## Requisitos

| Componente | Linux | Windows |
|---|---|---|
| Node.js ≥ 22.12 y pnpm 10 (`corepack enable`) | ✅ | ✅ PowerShell |
| PostgreSQL 16/17 para las pruebas | ✅ binarios locales o `TEST_DATABASE_URL` | ✅ con `TEST_DATABASE_URL` (o WSL2) |
| Docker + Supabase CLI (opcional, Supabase local) | ✅ | ✅ Docker Desktop |
| KVM para Android virtual (Entrega 2) | ✅ solo en anfitrión Linux con KVM | ❌ requiere servidor Linux |

## 1. Instalar

```bash
corepack enable
pnpm install
cp .env.example .env
```

## 2. Base de datos

### Opción A: proyecto Supabase (recomendado)

1. Crea un proyecto en Supabase.
2. Aplica la migración: `supabase link --project-ref <ref>` y `supabase db push`
   (o ejecuta `supabase/migrations/20261119000100_core.sql` en el editor SQL).
3. En `.env`: `DATABASE_URL` (Settings → Database), `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`.
4. Auth → Providers → Email activado; Auth → MFA → TOTP activado.
5. Registro de cuentas (`/registro` en el panel):
   - Authentication → Sign In / Providers → **Allow new users to sign up** activado (si lo desactivas,
     el panel muestra «registro desactivado»).
   - **Confirm email** activado (recomendado): el usuario recibe un enlace y luego inicia sesión.
     Añade `http://localhost:3000/login` (y tu dominio en producción) en Authentication → URL
     Configuration → **Redirect URLs** para que el enlace vuelva al panel.
   - El correo integrado de Supabase tiene un límite de pocos envíos por hora: para uso real configura
     un SMTP propio en Authentication → Emails → SMTP Settings.
   - Una cuenta nueva no pertenece a ninguna organización ni tiene permisos: un administrador la añade
     desde Clientes → organización → Añadir miembro.

### Opción B: Supabase local (Docker)

```bash
supabase start
supabase db reset
```

Usa `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`,
`DATABASE_SSL=disable`, `SUPABASE_URL=http://127.0.0.1:54321` y la clave publicable que imprime
`supabase start`.

## 3. Primer superadministrador

1. Regístrate (o crea el usuario en Auth → Users).
2. Concede el rol (usa `DATABASE_URL` del `.env` de la raíz; nunca se hace desde la API):

```bash
pnpm run bootstrap-admin -- tu-correo@dominio.com
```

3. Inicia sesión en el panel, ve a **Seguridad** y activa la verificación en dos pasos: sin ella las
   acciones administrativas responden `mfa_required`. Cierra sesión y vuelve a entrar con el código.

## 4. Arrancar

```bash
pnpm run build
```

```bash
pnpm run dev:api
```

```bash
pnpm run dev:web
```

`dev:api` y `dev:web` compilan antes los paquetes compartidos y leen el único `.env` de la raíz.
Funcionan igual en PowerShell, macOS y Linux.

Panel: http://localhost:3000 · API: http://127.0.0.1:4000/v1/health · OpenAPI: `/v1/openapi.json`.

Las pruebas con base de datos (`pnpm test`, `pnpm run validate`) usan un script bash: en Windows
ejecútalas desde Git Bash o WSL, con `TEST_DATABASE_URL` apuntando a un PostgreSQL desechable (la
prueba crea y borra `captia_test`). Para usar el panel no hacen falta.

## 5. Validar

```bash
pnpm run validate
```

Ejecuta typecheck, ESLint, pruebas unitarias, SQL y de API (PostgreSQL desechable), build y la prueba
E2E del panel con Chromium. Para guardar capturas: `E2E_SCREENSHOTS_DIR=/ruta pnpm run test:web`.

## Producción (mínimo de la Entrega 1)

- API detrás de un proxy inverso con TLS (Caddy/Nginx), `TRUST_PROXY_HOPS=1`, una réplica (ver ADR-005).
- Panel con `next start` detrás del mismo proxy; `NODE_ENV=production` activa cookies `Secure` y HSTS.
- `DATABASE_SSL=verify-full` cuando el certificado de la base lo permita.
- Backups: los de Supabase (PITR) + exportación diaria de `core.audit_events` a almacenamiento
  inmutable. Restauración: `supabase db` desde PITR; la auditoría no se puede borrar desde SQL.
- Health check: `GET /v1/health` (503 si la base de datos no responde).
