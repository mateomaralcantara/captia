# services/

Servicios del plano de datos. **Ninguno existe todavía**; se crean en su entrega y se comunican con la
API mediante contratos versionados en `packages/`.

| Servicio | Entrega | Responsabilidad |
|---|---|---|
| `device-controller` | 2 | Agente de nodo KVM (Go): ciclo de vida de instancias Android, volúmenes, métricas |
| `streaming-gateway` | 2 | Sesiones WebRTC autenticadas hacia la pantalla de los dispositivos |
| `voice-adapter` | 3 | Provisión de extensiones en Asterisk (PJSIP Realtime) y eventos ARI |
| `mail-adapter` | 4 | Provisión de dominios, buzones, alias y cuotas en el servidor de correo |
| `physical-device-agent` | 6 | Agente de racks USB: descubrimiento ADB, estado, sesiones |
| `ai-orchestrator` | 8 | CAPTIA Harness: coordinador de agentes con permisos y aprobación humana |
