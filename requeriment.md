# Especificación Técnica Funcional — Backend Nihon Planner

**Versión:** 1.1 · **Fecha:** 15/07/2026 · **Autora:** Emma (Product) · **Estado:** Para implementación

**Changelog v1.1:** proveedor AI configurable (DeepSeek para test), dockerización 100% (sin dependencias locales), login con Google (Client ID only) con whitelist de mails por `.env`, lineamientos de UI mobile-first con estilos del portfolio kyz.com.ar e ícono hinomaru.

---

## 1. Objetivo y alcance

Implementar un backend liviano que reemplace la persistencia local (localStorage) del frontend React existente (`nihon-planner`), centralizando datos de gastos, logística, cotizaciones y —clave— las **conversaciones con el asistente AI**, hoy atadas al navegador.

**En alcance (v1):**
- API REST para gastos, ítems de plan, cotizaciones y sesiones de chat AI.
- Persistencia en SQLite.
- Capa AI con **proveedor configurable**: DeepSeek en test, Claude en producción, con persistencia automática de mensajes.
- **Autenticación con Google** (Client ID only) y whitelist de mails autorizados por `.env`.
- **Entorno 100% dockerizado** para desarrollo local y VPS. Sin `node_modules` en la máquina local.
- Importación de datos exportados desde el artifact/localStorage.

**Fuera de alcance (v1):** registro abierto de usuarios, sync en tiempo real, panel de administración.

---

## 2. Decisión de base de datos: SQLite

**Se elige SQLite sobre MongoDB.** Justificación frente a los dos criterios pedidos:

| Criterio | SQLite | MongoDB |
|---|---|---|
| Consumo | Embebida en el proceso Node, archivo único, ~0 MB extra de RAM, cero servicios | Proceso `mongod` separado, ~200–500 MB RAM base |
| Amigable con modelos conversacionales | Mensajes como filas append-only + columnas JSON (JSON1) para metadata flexible + **FTS5** para búsqueda full-text en el historial | Documentos flexibles, pero overkill para este volumen |
| Operación | Backup = copiar un archivo; deploy en cualquier VPS/Raspberry/fly.io | Requiere administración o Atlas (dependencia externa) |

El patrón conversacional (sesiones → mensajes ordenados con `role`/`content`) es naturalmente relacional. La flexibilidad de esquema que da Mongo se cubre con columnas `TEXT` con JSON validado.

---

## 3. Stack propuesto

- **Runtime:** Node.js ≥ 20 (nativo `fetch`), **exclusivamente dentro de contenedores** (ver §9).
- **Framework:** Fastify 4 (footprint mínimo, validación por JSON Schema integrada). Alternativa aceptada: Express 4.
- **DB driver:** `better-sqlite3` (sincrónico, sin pool, el más rápido para este caso). Sin ORM: queries preparadas.
- **Validación:** JSON Schema de Fastify (o `zod` si se usa Express).
- **Auth:** verificación de ID tokens de Google con `google-auth-library` (solo verifica firma contra JWKS públicos — no requiere client secret).
- **Config:** variables de entorno (inyectadas por Docker Compose / `--env-file`).

Dependencias totales estimadas: 4–5 paquetes. Objetivo de consumo: **< 80 MB RAM** por contenedor de app.

### 3.1 Capa AI multi-proveedor

Abstracción `AIProvider` con una única función `chat({system, messages}) → {content, usage}` y dos implementaciones seleccionables por env:

| Env | Test | Producción |
|---|---|---|
| `AI_PROVIDER` | `deepseek` / `google` | `anthropic` |
| `AI_MODEL` | `deepseek-chat` / `gemini-flash-lite-latest` | `claude-sonnet-4-6` |
| `AI_BASE_URL` | DeepSeek o Gemini OpenAI-compat | `https://api.anthropic.com` |
| `AI_API_KEY` / `GEMINI_API_KEY` | key del provider activo | key de Anthropic |

Notas de implementación:
- DeepSeek expone API **compatible con formato OpenAI** (`/chat/completions`, system como primer mensaje `role: "system"`); Anthropic usa `/v1/messages` con `system` como campo separado y header `anthropic-version`. La abstracción normaliza ambos, incluyendo el mapeo de `usage` (tokens in/out) a `ai_messages.meta`.
- El formato persistido en DB es siempre el neutro `{role: 'user'|'assistant', content}` — cambiar de proveedor no toca datos.
- Prohibido hardcodear proveedor o modelo fuera de la capa: el resto del backend consume solo `AIProvider`.

---

## 4. Modelo de datos (DDL)

```sql
PRAGMA journal_mode = WAL;          -- concurrencia lectura/escritura
PRAGMA foreign_keys = ON;

CREATE TABLE expenses (
  id          TEXT PRIMARY KEY,      -- nanoid/uuid generado por el backend
  description TEXT NOT NULL,
  amount      REAL NOT NULL CHECK (amount > 0),
  currency    TEXT NOT NULL CHECK (currency IN ('ARS','USD','JPY')),
  category    TEXT NOT NULL CHECK (category IN ('comida','transporte','alojamiento','actividades','compras','otros')),
  spent_at    TEXT NOT NULL,         -- ISO 8601
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Modelo polimórfico para toda la logística (vuelos, alojamientos, reservas, docs)
CREATE TABLE plan_items (
  id             TEXT PRIMARY KEY,
  type           TEXT NOT NULL CHECK (type IN ('flight','stay','booking','doc')),
  title          TEXT NOT NULL,      -- ruta / hotel / actividad / ítem de checklist
  done           INTEGER NOT NULL DEFAULT 0,   -- 0 pendiente, 1 realizado
  datetime_start TEXT,               -- ISO 8601 (salida / check-in / fecha reserva)
  datetime_end   TEXT,               -- ISO 8601 (check-out; NULL para el resto)
  meta           TEXT NOT NULL DEFAULT '{}',   -- JSON: {code, city, notes, ...}
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_plan_type_dt ON plan_items(type, datetime_start);

-- Config/KV: cotizaciones y ajustes ({usdArs, usdJpy, source, updatedAt})
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                -- JSON
);

-- ===== Núcleo conversacional =====
CREATE TABLE ai_sessions (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  mode       TEXT NOT NULL CHECK (mode IN ('planificar','consultar')),
  summary    TEXT,                   -- resumen compactado (ver §7.3)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ai_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,  -- orden garantizado
  session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT NOT NULL,
  meta       TEXT NOT NULL DEFAULT '{}',         -- JSON: {model, tokens_in, tokens_out}
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_msg_session ON ai_messages(session_id, id);

-- Búsqueda full-text sobre el historial conversacional
CREATE VIRTUAL TABLE ai_messages_fts USING fts5(
  content, content='ai_messages', content_rowid='id'
);
-- Mantener sincronizada vía triggers AFTER INSERT/UPDATE/DELETE sobre ai_messages.
```

---

## 5. API REST

Base: `/api/v1`. Formato: JSON. Errores: `{ error: { code, message } }` con HTTP status semántico (400 validación, 404 no existe, 502 upstream AI).

### 5.1 Gastos
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/expenses` | Lista, orden `spent_at DESC`. Query opcional: `?category=`, `?from=`, `?to=` |
| POST | `/expenses` | Crea. Body: `{description, amount, currency, category, spent_at}` |
| PUT | `/expenses/:id` | Actualiza campos parciales |
| DELETE | `/expenses/:id` | Elimina |
| GET | `/expenses/totals` | `{USD, ARS, JPY, byCat}` calculado server-side con la cotización vigente |

### 5.2 Plan
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/plan-items?type=flight\|stay\|booking\|doc` | Lista filtrada, orden `datetime_start` |
| POST | `/plan-items` | Crea `{type, title, datetime_start?, datetime_end?, meta?}` |
| PUT | `/plan-items/:id` | Actualiza (incluye toggle `done`) |
| DELETE | `/plan-items/:id` | Elimina |
| GET | `/plan-items/timeline` | Todos los tipos con fecha, mergeados y ordenados cronológicamente |

### 5.3 Cotizaciones
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/rates` | Devuelve settings `rates` |
| PUT | `/rates` | Override manual `{usdArs?, usdJpy?}` → `source: "manual"` |
| POST | `/rates/refresh` | El backend consulta `open.er-api.com` + `dolarapi.com` (blue), persiste y devuelve. Cache: no refrescar si `updatedAt` < 30 min salvo `?force=true` |

### 5.4 Conversacional (núcleo)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/sessions` | Lista con `{id, name, mode, message_count, updated_at}` |
| POST | `/sessions` | Crea `{name?, mode}` |
| DELETE | `/sessions/:id` | Elimina en cascada |
| GET | `/sessions/:id/messages` | Historial completo ordenado |
| POST | `/sessions/:id/chat` | **Endpoint principal.** Body: `{content}`. El backend: (1) persiste el mensaje user, (2) arma el contexto (§7), (3) llama a Anthropic, (4) persiste la respuesta, (5) devuelve `{message, session}`. La API key vive SOLO acá |
| POST | `/sessions/:id/reset` | Borra mensajes, conserva la sesión |
| GET | `/sessions/:id/export` | JSON compatible con el export actual del front (`{herramienta, version, tipo, sesion}`) |
| GET | `/search?q=` | Búsqueda FTS5 sobre `ai_messages` → `[{session_id, snippet, created_at}]` |

### 5.5 Migración
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/import` | Acepta el JSON exportado por el artifact (sesiones) y/o un dump del localStorage (`jp:expenses`, `jp:logistics`, `jp:rates`, `jp:sessions`) y lo vuelca a las tablas. Idempotente por `id` (upsert) |

---

## 6. Integración con el frontend React

**Fase 1 — swap del adapter (sin tocar App.jsx):** crear `src/lib/apiClient.js` y reescribir `src/lib/storage.js` para que `get/set` de las claves `jp:*` llamen a los endpoints equivalentes. Valida el backend end-to-end con riesgo cero.

**Fase 2 — integración tipada:** reemplazar los `useEffect` de persistencia por llamadas directas a la API (fetch on mount + mutaciones optimistas). Mover `askClaude` a `POST /sessions/:id/chat` y eliminar la construcción del system prompt del cliente. El componente `Asistente` pasa a ser un cliente puro del historial servido por el backend.

CORS: permitir solo el origin del front (`FRONTEND_ORIGIN` en `.env`).

---

## 7. Lógica conversacional server-side

### 7.1 Construcción de contexto
El backend arma el system prompt según `mode` de la sesión (mismos textos actuales de `App.jsx`, en español rioplatense), inyectando el **estado del viaje leído de la DB** (gastos, plan con `done → CUMPLIDO ✓/pendiente`, cotizaciones). Fuente de verdad única: la DB, nunca el cliente.

### 7.2 Llamada al modelo
Vía capa `AIProvider` (§3.1): DeepSeek en test, Claude en producción, seleccionado por env. `max_tokens` 1000 (configurable `AI_MAX_TOKENS`). Timeout 60 s. Reintento: 1, solo ante 429/5xx. Los prompts en español rioplatense deben validarse contra **ambos** proveedores (criterio de aceptación §12.8).

### 7.3 Compactación de memoria (requisito, no opcional)
Cuando una sesión supere `COMPACT_THRESHOLD` mensajes (default 40):
1. Tomar los mensajes más antiguos (todos menos los últimos 10).
2. Pedir al modelo un resumen de decisiones tomadas e información acordada (≤ 300 palabras).
3. Guardar en `ai_sessions.summary` y marcar los mensajes resumidos con `meta.compacted = true` (no se envían más al modelo, pero **nunca se borran**: el historial completo sigue consultable y exportable).
4. Contexto de las siguientes llamadas: system prompt + summary + últimos 10 mensajes.

### 7.4 Métricas
Persistir en `ai_messages.meta` los tokens de entrada/salida que devuelve la API (`usage`) para monitorear costo por sesión.

---

## 8. Autenticación: Google Sign-In (Client ID only)

**Objetivo:** login con Google **sin client secret** (no hay flujo OAuth server-side de authorization code; solo verificación de ID tokens). Nada sensible viaja al repo ni al frontend.

### 8.1 Flujo
1. Frontend integra **Google Identity Services** (botón oficial / One Tap) con `VITE_GOOGLE_CLIENT_ID` (el Client ID es público por diseño — puede ir en el bundle).
2. Google devuelve un **ID token (JWT)** al frontend.
3. Frontend lo envía a `POST /api/v1/auth/google` `{credential}`.
4. Backend verifica con `google-auth-library` (`verifyIdToken`): firma contra JWKS públicos de Google, `aud === GOOGLE_CLIENT_ID`, expiración y `email_verified === true`.
5. Backend valida el email contra la whitelist (§8.2). Si no está autorizado → `403 { error: { code: "EMAIL_NOT_ALLOWED" } }`.
6. Si es válido: emite **cookie de sesión propia** `httpOnly; Secure; SameSite=Lax` (token firmado con `SESSION_SECRET`, expiración 30 días). Alternativa aceptada: JWT propio en header.
7. Todos los endpoints de datos (§5) requieren sesión válida. Públicos: `/auth/google`, `/health`.

### 8.2 Whitelist de mails por `.env`
```env
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
ALLOWED_EMAILS=emma@ejemplo.com,pareja@ejemplo.com   # separados por coma, case-insensitive, trim
SESSION_SECRET=<random-64-chars>
```
- La comparación se hace **server-side en cada login y en cada request autenticada** (el email viaja en la sesión firmada). Cambiar la whitelist solo requiere editar env y reiniciar el contenedor.
- Registrar en log (info) todo intento de login rechazado con el email ofuscado (`e***@dominio`).

### 8.3 Endpoints de auth
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/google` | Body `{credential}` → set-cookie de sesión + `{user: {email, name, picture}}` |
| POST | `/auth/logout` | Invalida la cookie |
| GET | `/auth/me` | Sesión actual o 401 (el front lo usa al montar para decidir si muestra login) |

---

## 9. Dockerización (obligatoria)

**Regla dura: cero `npm install` en la máquina local.** Todo el ciclo (desarrollo, test, build, producción) corre en contenedores. `node_modules` existe solo dentro de las imágenes/volúmenes de Docker.

### 9.1 Estructura
- `Dockerfile` multi-stage:
  - `deps` → `npm ci` (capa cacheada).
  - `dev` → hot reload (`vite dev` / `node --watch`).
  - `build` → `vite build` del front.
  - `prod` → imagen final `node:20-alpine`, solo `server/` + `dist/` + deps de producción, usuario no-root. Target: **imagen < 200 MB**.
- `docker-compose.yml` con profiles:
  - **`dev`**: servicio `app-dev` con bind mount del código fuente (hot reload) y **volumen anónimo sobre `/app/node_modules`** para que las dependencias del contenedor nunca se materialicen en el filesystem local.
  - **`prod`**: servicio `app` (imagen prod), pensado para VPS.
- Volumen nombrado `nihon_data` montado en `/app/data` → el archivo SQLite **sobrevive redeploys** y se respalda con `docker cp` o el endpoint de backup.

### 9.2 Comandos de referencia
```bash
docker compose --profile dev up            # desarrollo local con hot reload
docker compose --profile prod up -d        # VPS
docker compose run --rm app-dev npm test   # tests, también en contenedor
```

### 9.3 Requisitos
- `.env` nunca se copia a la imagen (`.dockerignore` incluye `.env`, `node_modules`, `data/`, `dist/`); se inyecta con `env_file` en compose.
- `HEALTHCHECK` contra `GET /health`.
- Compatible con `linux/amd64` y `linux/arm64` (VPS baratos suelen ser ARM). Atención: `better-sqlite3` compila nativo → usar imagen con toolchain en stage `deps` o prebuilds.
- Documentar en README el deploy a VPS: `git pull && docker compose --profile prod up -d --build`.

---

## 10. UI: mobile-first y sistema visual

### 10.1 Mobile-first (requisito, ya vigente en el front)
- Diseño base para viewport ~380 px; breakpoints solo para mejorar en pantallas grandes (max-width 520 centrado se mantiene).
- Targets táctiles ≥ 44 px, inputs con `inputmode` correcto, datepickers nativos (`datetime-local`).
- La app se usará en Japón con conectividad irregular: optimizar bundle y estados de carga/error visibles.

### 10.2 Estilos del portfolio kyz.com.ar
El sistema visual debe alinearse al portfolio personal de la autora (**https://kyz.com.ar**). Nota: el sitio bloquea scraping automatizado (robots.txt), por lo que la extracción es manual.

Tarea del desarrollador — extraer del portfolio y documentar como design tokens (`src/theme.js` o CSS variables):
- Paleta: fondo, superficie, texto primario/secundario, acento(s), estados (éxito/error).
- Tipografías: familia display y body, escala y pesos usados.
- Radios de borde, sombras, espaciado base y estilo de botones/inputs.
- Modo claro/oscuro si el portfolio lo define.

Los tokens reemplazan a la paleta provisoria actual (`C` en `App.jsx`). **Gate de diseño:** antes de aplicar, presentar a Product (Emma) una pantalla de muestra (Resumen) con los tokens extraídos para aprobación.

### 10.3 Ícono / branding
- Ícono de la app: **bandera de Japón (hinomaru)** — círculo rojo `#BC002D` sobre fondo blanco, proporción oficial 3:2 para la bandera; para favicon/app icon usar versión cuadrada con el disco centrado (diámetro ≈ 3/5 del alto).
- Entregar: `favicon.svg` (vector), `favicon-32.png`, `apple-touch-icon-180.png`, `icon-512.png` + `manifest.webmanifest` (nombre "Nihon Planner", `theme_color` según tokens del portfolio) — deja la base lista para PWA (backlog).
- El hinomaru es simbología nacional de uso libre; no usar logos de terceros.

---

## 11. Requisitos no funcionales

- **Consumo:** proceso único Node por contenedor, RAM < 80 MB, DB en `/app/data/nihon.db` (WAL) sobre el volumen `nihon_data`.
- **Arranque:** un solo contenedor `prod` sirve API + build estático del front (`SERVE_STATIC=true`) → deploy de un proceso en el VPS.
- **Backup:** endpoint `GET /admin/backup` (requiere sesión autenticada) que devuelve el archivo `.db`, más instrucción documentada de `docker cp` en frío.
- **Logs:** logger de Fastify (pino) nivel `info`; errores de upstream AI con request id; logins rechazados con email ofuscado.
- **Seguridad:** API keys (AI) y `SESSION_SECRET` solo en env del server, jamás en imagen ni en el bundle. El único valor "público" permitido en el front es `GOOGLE_CLIENT_ID` (público por diseño). Cookies `httpOnly; Secure` — el VPS debe servir HTTPS (reverse proxy Caddy/Traefik sugerido, fuera de alcance detallarlo).
- **Zona horaria:** almacenar todo en ISO 8601 UTC; el front formatea a `es-AR`.

---

## 12. Criterios de aceptación

1. **Gastos:** alta desde el front en JPY se refleja en `GET /expenses/totals` en las 3 monedas usando la cotización de la DB (no la del cliente).
2. **Plan:** marcar un ítem como realizado vía `PUT` y preguntarle al asistente en modo *consultar* "¿qué me falta?" → el ítem aparece como cumplido en la respuesta.
3. **Conversacional:** enviar 3 mensajes a una sesión, reiniciar el server, `GET /sessions/:id/messages` devuelve los 6 (user+assistant) en orden.
4. **Compactación:** con threshold seteado en 6 para test, al 7.º mensaje la sesión tiene `summary` no nulo y la llamada al modelo incluye ≤ 10 mensajes + summary (verificable por log).
5. **Import:** el JSON exportado por el artifact (formato `{herramienta, version, tipo, sesion}`) se importa y la sesión queda consultable y continuable desde el front. Re-importar el mismo archivo no duplica.
6. **Búsqueda:** `GET /search?q=kyoto` devuelve mensajes que contengan el término con snippet.
7. **Consumo:** el contenedor `prod` en idle no supera 80 MB RSS (`docker stats`).
8. **Proveedor AI:** con `AI_PROVIDER=deepseek` y con `AI_PROVIDER=anthropic`, el mismo `POST /sessions/:id/chat` responde correctamente y persiste `usage` en `meta`, sin cambios de código ni de datos.
9. **Auth:** (a) login con un mail de `ALLOWED_EMAILS` → cookie de sesión y acceso a `/expenses`; (b) login con Google válido pero mail fuera de la whitelist → 403 `EMAIL_NOT_ALLOWED`; (c) request a `/expenses` sin sesión → 401. No existe ningún client secret en repo, imagen ni bundle.
10. **Docker:** clonar el repo en una máquina limpia (sin Node instalado) y correr `docker compose --profile dev up` deja la app funcionando; no se crea `node_modules` en el filesystem local. `docker compose --profile prod up -d` en el VPS sirve front + API en un contenedor y los datos sobreviven a `down && up`.
11. **UI:** la pantalla Resumen renderizada con los tokens extraídos de kyz.com.ar fue aprobada por Product antes del merge; el favicon hinomaru se ve en pestaña del navegador y como ícono al agregar a home screen en mobile.

---

## 13. Entregables

- Repo con `/server` (Fastify + better-sqlite3), migraciones SQL versionadas en `/server/migrations`, `Dockerfile` multi-stage, `docker-compose.yml` (profiles dev/prod), `.dockerignore`, `.env.example` completo (AI, Google, whitelist, secrets) y README de operación (incluye deploy a VPS).
- Front actualizado: Fase 1 mínimo (Fase 2 deseable), pantalla de login con Google Identity Services, design tokens de kyz.com.ar aplicados, set de íconos hinomaru + manifest.
- Colección de requests (`.http` o Bruno/Postman) cubriendo todos los endpoints, incluido el flujo de auth.
- Estimación sugerida: API + auth + docker ~5–6 días dev; Fase 2 front + compactación + tokens de diseño ~3 días adicionales.