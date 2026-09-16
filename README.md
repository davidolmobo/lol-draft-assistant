# lol-draft-assistant

App de escritorio (Electron) estilo OP.GG para League of Legends, con recomendación de pick/ban durante la fase de selección según el contexto de la partida.

## Estructura

- `apps/desktop` — app Electron (UI del asistente de pick/ban, se conecta a LCU API y Live Client Data API en local)
- `apps/worker` — script de recolección de datos vía Riot API, pensado para correr como cron en GitHub Actions
- `packages/shared` — código compartido entre `desktop` y `worker` (cliente de Riot API, acceso a base de datos, tipos)

## Estado

En construcción. Ver progreso paso a paso.
