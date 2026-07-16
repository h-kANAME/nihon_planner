# Nihon Planner — contexto para Claude Code

## Qué es
Herramienta personal de planificación de un viaje a Japón (20 días, pareja argentina).
Nació como artifact de Claude.ai y se migró a este proyecto Vite + React + backend Fastify/SQLite.

## Usuaria
Emma — Systems Analyst / PM en Yoizen. Nivel técnico avanzado.
Prefiere UIs single-purpose, mobile-first, UX limpia, respuestas concisas.

## Funcionalidad
- **Resumen / Gastos / Conversor / Plan / Asistente AI** (ver requeriment.md).
- Persistencia en SQLite vía API REST (`/api/v1`). Auth Google (ID token) + whitelist `ALLOWED_EMAILS`.
- AI multi-proveedor: DeepSeek (test) / Anthropic (prod) vía `AIProvider`.
- Compactación de memoria de sesiones al superar `COMPACT_THRESHOLD`.

## Arquitectura
- `src/App.jsx` — UI (Fase 2 AI tipada; Fase 1 storage adapter para jp:*).
- `src/lib/storage.js` + `apiClient.js` — adapter → API.
- `src/theme.js` — tokens kyz.com.ar + hinomaru.
- `server/` — Fastify + better-sqlite3, migraciones en `server/migrations/`.
- Docker 100%: `docker compose --profile dev|prod up`.

## Cómo correr
```bash
cp .env.example .env   # completar keys
docker compose --profile dev up --build
```
Front http://localhost:5173 · API http://localhost:8787

## Convenciones
- Idioma: español rioplatense.
- Estilos: tokens en `theme.js` (dark kyz + acento verde + hanko).
- Persistencia DB: expenses, plan_items, settings, ai_sessions, ai_messages (+ FTS5).

## Spec
Ver `requeriment.md` (v1.1).
