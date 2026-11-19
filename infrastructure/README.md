# infrastructure/

Aprovisionamiento reproducible. En la Entrega 1 la infraestructura es Supabase (gestionado o local
con `supabase start`) + la API y el panel; no hace falta nada más aquí.

| Carpeta prevista | Entrega | Contenido |
|---|---|---|
| `ansible/` | 2 | Preparación de nodos Linux con KVM (kernel, paquetes de Cuttlefish, firewall, agente) |
| `docker/` | 2 | Compose de servicios auxiliares (Redis, observabilidad) |
| `monitoring/` | 2 | Prometheus, Grafana, Loki, OpenTelemetry Collector, Alertmanager |
| `networking/` | 2 | Perfiles de red, firewall y VPN (WireGuard) por organización |
| `pbx/` | 3 | Asterisk con PJSIP Realtime, coturn |
| `mail/` | 4 | Servidor de correo, DNS (MX, SPF, DKIM, DMARC, MTA-STS) |
| `terraform/` | 9 | Recursos cloud cuando se usen |
