# Entrega 0 · Discovery y validación

Inspección del entorno realizada el **19-11-2026** en el contenedor de desarrollo donde se construyó la
Entrega 1. Esta matriz describe **ese** entorno; el entorno de producción hay que inventariarlo de nuevo.

## Matriz de capacidades

| # | Elemento | Estado | Detalle | Consecuencia |
|---|---|---|---|---|
| 1 | Repositorio | ✅ | `mateomaralcantara/captia` vacío (sin commits) | Monorepo creado desde cero; nada que conservar |
| 2 | Herramientas | ✅ | Node 22, pnpm 10, Go 1.27, Git, Chromium + Playwright | Suficiente para web, API, pruebas y futuros agentes Go |
| 3 | Sistema operativo | ✅ | Linux x86_64, 4 vCPU, 15 GB RAM | — |
| 4 | Supabase | ❌ | Sin proyecto ni credenciales | Migraciones probadas en PostgreSQL 16 local con réplica mínima de `auth`; aplicación real pendiente (ver despliegue) |
| 5 | Linux / KVM | ❌ | `/dev/kvm` no existe; CPU sin `vmx/svm` expuesto | **No se puede ejecutar Android virtual aquí.** Entrega 2 necesita un nodo con KVM |
| 6 | Dispositivos físicos | ❌ | Sin USB/ADB | Entrega 6 necesita un nodo con teléfonos conectados |
| 7 | Dominios | ❌ | Ninguno verificado; `mmail.com` **no** consta como propiedad del operador | CAPTIA Mail no se activa hasta verificar un dominio propio |
| 8 | PBX | ❌ | Sin Asterisk ni IP pública | Entrega 3 necesita un servidor con IP pública o red privada para SIP/RTP |
| 9 | Docker | ⚠️ | Cliente instalado, sin demonio | `supabase start` no disponible localmente; se ejecuta en CI |
| 10 | PostgreSQL | ✅ | 16 local | Pruebas SQL y E2E reales en base desechable |
| 11 | GitHub | ⚠️ | Lectura sí; **escritura (push) rechazada** | Hay que instalar la app de Claude en el repositorio para publicar ramas |

## Restricciones detectadas

- No se piden ni se guardan claves en el código. `.env.example` documenta cada variable.
- La verificación con Supabase Auth real (GoTrue) no se pudo ejecutar en este contenedor; queda
  automatizada en CI (`supabase start`). En local, la prueba E2E usa un doble de Auth identificado
  como tal.

## Riesgos y decisiones tempranas

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Dominio `mmail.com` sin propiedad demostrada | Crítico para CAPTIA Mail | Verificar titularidad o usar un dominio propio; el dominio es configurable |
| Sin hardware KVM | Bloquea Entrega 2 | Contratar un servidor dedicado con KVM (≥16 núcleos, ≥64 GB, NVMe) y medir capacidad real |
| Regulación de telecomunicaciones (INDOTEL, Ley 153-98) | Bloquea telefonía pública | Asesoría legal antes de la Entrega 9; las extensiones internas no la necesitan |
| Google Play / GMS | Limita el valor del Android virtual | Imágenes AOSP sin GMS hasta tener licencia; declararlo al cliente |
| Licencias copyleft (Asterisk GPL, mailcow GPL, componentes AGPL) | Obligaciones al operar como SaaS | Revisión legal por componente antes de comercializar |
| Alcance muy amplio | Retrasos | Entregas estrictas; no se empieza una sin cerrar la anterior |

Decisiones técnicas: ver [../architecture/decisions.md](../architecture/decisions.md).
