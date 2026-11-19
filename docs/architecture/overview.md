# Arquitectura general

```mermaid
flowchart LR
  subgraph Clientes
    WEB[CAPTIA Control · Next.js]
    MOB[App Flutter · pendiente]
    INT[Integraciones API]
  end
  subgraph CP[Control Plane · implementado en Entrega 1]
    API[API NestJS /v1]
    DB[(Supabase Postgres · esquema core + RLS)]
    AUTH[Supabase Auth · JWT + MFA]
  end
  subgraph DDP[Device Data Plane · Entrega 2/6]
    NODE[Nodos KVM + agente]
    RACK[Racks USB + ADB]
  end
  subgraph CDP[Communications Data Plane · Entrega 3/9]
    PBX[Asterisk PJSIP]
  end
  subgraph MDP[Mail Data Plane · Entrega 4]
    MAIL[mailcow / Stalwart]
  end
  subgraph IP[Intelligence Plane · Entrega 8]
    AI[CAPTIA Harness]
  end

  WEB -- cookies httpOnly --> WEB
  WEB -->|Bearer JWT| API
  WEB -->|login / MFA| AUTH
  INT -->|Bearer JWT| API
  API -->|transacción por petición: claims + role authenticated| DB
  AUTH --> DB
  API -. adaptadores .-> NODE & RACK & PBX & MAIL & AI
```

## Planos

| Plano | Responsabilidad | Estado |
|---|---|---|
| Control | Auth, organizaciones, usuarios, RBAC, auditoría, catálogo, API | **Implementado (Entrega 1)** |
| Device data | Hipervisor, instancias Android, ADB, streaming, volúmenes | Pendiente: requiere nodo KVM |
| Communications data | Asterisk, SIP/RTP, buzones de voz, CDR | Pendiente |
| Mail data | SMTP/IMAP, buzones, antispam, webmail | Pendiente: requiere dominio propio |
| Intelligence | Agentes con permisos y aprobación humana | Pendiente |

Regla: el plano de control guarda el **estado deseado**; solo el plano de datos (agentes, PBX,
servidor de correo) confirma el **estado observado**. La UI muestra el observado.

## Flujo de una petición autenticada

1. El panel envía el token de acceso (de su cookie `httpOnly`) como `Authorization: Bearer`.
2. `AuthGuard` verifica el JWT (JWKS o HS256), emisor, audiencia, expiración y rol.
3. `RateLimitGuard` aplica la cuota del usuario.
4. `CoreService` abre una transacción, fija `request.jwt.claims` y `role authenticated`.
5. Lecturas: `select` sobre tablas con RLS. Escrituras: funciones `core.*` que comprueban permiso,
   MFA (`aal2`) y escriben `core.audit_events` en la misma transacción.
6. Errores → `application/problem+json` con código estable.

## Modelo de datos (Entrega 1)

```mermaid
erDiagram
  profiles ||--o{ organization_members : pertenece
  organizations ||--o{ organization_members : tiene
  organization_roles ||--o{ organization_members : asigna
  organizations ||--o{ organization_roles : "roles propios"
  organization_roles ||--o{ role_permissions : concede
  permissions ||--o{ role_permissions : en
  profiles ||--o{ platform_role_assignments : tiene
  platform_roles ||--o{ platform_role_assignments : asigna
  platform_roles ||--o{ platform_role_permissions : concede
  permissions ||--o{ platform_role_permissions : en
  organizations ||--o{ audit_events : registra
```

Tablas: `permissions`, `platform_roles`, `platform_role_permissions`, `platform_role_assignments`,
`organizations`, `organization_roles`, `role_permissions`, `organization_members`, `profiles`,
`audit_events`, `service_catalog`, `feature_flags`, `idempotency_keys`.
Definición completa: `supabase/migrations/20261119000100_core.sql`.
