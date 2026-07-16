# Nihon Planner 旅

Planificador de viaje a Japón: gastos multi-moneda (ARS/USD/JPY), logística, cotizaciones y asistente AI con persistencia server-side.

**Stack:** React (Vite) + Fastify + SQLite · Auth Google (ID token) · AI multi-proveedor (DeepSeek / Claude) · 100% Docker.

## Requisitos

- Docker + Docker Compose
- No hace falta Node en la máquina local (`node_modules` solo dentro del contenedor)

## Setup

```bash
cp .env.example .env
# Completar: GOOGLE_CLIENT_ID, VITE_GOOGLE_CLIENT_ID, ALLOWED_EMAILS,
# SESSION_SECRET, AI_API_KEY (y AI_PROVIDER)
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

| Env | Test | Prod |
|-----|------|------|
| `AI_PROVIDER` | `deepseek` | `anthropic` |
| `AI_MODEL` | `deepseek-chat` | `claude-sonnet-4-6` |
| `AI_BASE_URL` | `https://api.deepseek.com/v1` | `https://api.anthropic.com` |
| `AI_API_KEY` | key DeepSeek | key Anthropic |

## Design tokens (kyz.com.ar)

Documentados en `src/theme.js` (dark `#2d2e32` / `#25262a`, acento `#15eb80`, tipografía system-ui). Branding Nihon: hinomaru `#BC002D` en favicon/icons + `public/manifest.webmanifest`.

**Gate de diseño:** revisar pantalla Resumen con los tokens aplicados antes del merge definitivo.

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
