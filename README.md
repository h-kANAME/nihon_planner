# Nihon Planner 旅

Planificador de viaje a Japón: itinerario día a día, gastos híbridos (monto opcional + checklist de docs/vuelos/reservas/alojamiento), dashboard Resumen, cotizaciones y asistente AI.

**Stack:** React (Vite) + Fastify + SQLite · Auth Google (ID token) · AI Google Gemini + DeepSeek (failover) · 100% Docker.

## Requisitos

- Docker + Docker Compose
- No hace falta Node en la máquina local (`node_modules` solo dentro del contenedor)

## Setup

```bash
cp .env.example .env
# Completar: GOOGLE_CLIENT_ID, VITE_GOOGLE_CLIENT_ID, ALLOWED_EMAILS,
# SESSION_SECRET, GEMINI_API_KEY, DEEPSEEK_API_KEY
```

### Google Cloud Console

1. Crear OAuth Client ID tipo **Web application**.
2. Authorized JavaScript origins: `http://localhost:5173` (dev) y el dominio prod.
3. Pegar el Client ID en `GOOGLE_CLIENT_ID` y `VITE_GOOGLE_CLIENT_ID`.
4. Whitelist de mails en `ALLOWED_EMAILS`.

## Desarrollo

```bash
docker compose --profile dev up --build
```

- Front: http://localhost:5173  
- API: http://localhost:8787/health  

Hot reload vía bind mount. Volumen anónimo en `/app/node_modules` (no se materializa en el host).

Tests:

```bash
docker compose run --rm app-dev npm test
```

## Producción (VPS)

```bash
git pull
docker compose --profile prod up -d --build
```

Un solo contenedor sirve API + SPA (`SERVE_STATIC=true`). Datos SQLite en el volumen `nihon_data` (`/app/data/nihon.db`).

Backup en frío:

```bash
docker compose --profile prod cp app:/app/data/nihon.db ./nihon-backup.db
```

O en caliente (sesión autenticada): `GET /api/v1/admin/backup`.

Detrás de Traefik/Caddy: HTTPS + `COOKIE_SECURE=true`.

## AI

Pipeline con **failover**: primary Google (`gemini-flash-lite-latest`) → fallback DeepSeek si hay cuota/429/5xx. Tras el primer failover, el proceso queda en DeepSeek (sticky) para no romper imports largos.

| Rol | Env | Valor típico |
|-----|-----|----------------|
| Primary | `AI_PROVIDER` / `AI_MODEL` / `GEMINI_API_KEY` | `google` / `gemini-flash-lite-latest` |
| Fallback | `AI_FALLBACK_PROVIDER` / `DEEPSEEK_API_KEY` | `deepseek` / `deepseek-chat` |

La key de Gemini: [Google AI Studio](https://aistudio.google.com/apikey) → `GEMINI_API_KEY` (no confundir con `GOOGLE_CLIENT_ID`).

`GET /health` expone `primary`, `fallback`, `stickyFallback` y `lastFailover`.

Bench:

```bash
npm run bench:ai
```

## Brand / estilos

- **SoT:** [`brand_app/`](./brand_app/) (`tokens.css`, `tokens.json`, brandbook).
- **Runtime:** Tailwind CSS v4 + bridge `src/theme.js` (hi-no-maru, paper/sumi, Space Grotesk / IBM Plex, light-first).
- Índice: [`docs/brand.md`](./docs/brand.md). Hinomaru también en favicon / `public/manifest.webmanifest`.

## Itinerario (Plan)

El tab **Plan** es el itinerario día a día (import/export `.md` híbrido). **Gastos** concentra comida/transporte/… más documentación, vuelos, reservas y alojamiento (monto opcional + hecho/pendiente). **Resumen** es el dashboard (KPIs + preview del plan).

Detalle del contrato: [`docs/itinerary-import.md`](./docs/itinerary-import.md). Ejemplo: [`docs/plan.example.md`](./docs/plan.example.md).

## API

Colección: [`api.http`](./api.http). Prefijo `/api/v1`. Auth por cookie `httpOnly` tras `POST /auth/google`.

## Migración desde localStorage / artifact

Exportá JSON desde el artifact o usá `POST /api/v1/import` con dump `{ jp:expenses, jp:logistics, jp:rates, jp:sessions }` o formato `{herramienta, tipo, sesion}`. Upsert idempotente por `id`.

## Estructura

```
server/           Fastify + better-sqlite3
  migrations/     SQL versionado
  ai/             AIProvider (DeepSeek / Anthropic)
  routes/         REST
src/lib/          apiClient + storage adapter (Fase 1)
src/theme.js      tokens kyz
Dockerfile        multi-stage (deps / dev / build / prod)
docker-compose.yml  profiles: dev | prod
```
