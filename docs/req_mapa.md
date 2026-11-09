# Especificación Técnica Funcional — Ubicaciones y mapa del itinerario

**Versión:** 1.1 · **Fecha:** 08/11/2026 · **Autora:** Emma (Product) · **Estado:** Para implementación
**Base de código:** `main` @ `c39e2e9` (Tailwind v4 + brand_app SoT)
**Reemplaza:** v1.0 (catálogo `places`). El viaje es futuro: se planifica con tiempo.

---

## 1. Objetivo y alcance

Los usuarios quieren **llegar a cada parada** y **ver el itinerario sobre un mapa**. La ubicación de cada parada la **valida una persona** contra Google Maps, copiando un dato (coordenadas o Plus Code) y pegándolo en el planner. No hay geocoding automático.

**En alcance (v1):**

| Fase | Entrega |
|---|---|
| M0 | "Cómo llegar" por tramo con destino/origen en texto, sin coordenadas |
| M1 | Coordenadas por parada y por alojamiento, parser compartido, `version`/`409` |
| M2 | Export/Import MD que preserva coordenadas + snapshot y guarda anti-pérdida |
| M3 | UI de validación (picker, pegado en lote, badges, filtro de pendientes) |
| M4 | Mapa del día (marcadores numerados + trazo esquemático) |

**Fuera de alcance (v1):** geocoding automático, Places API, cálculo de rutas, mapas offline, catálogo de lugares reutilizables, vista global del viaje, resolución de links cortos (ver §15).

---

## 2. Contexto del repo (verificado)

| Hecho | Dónde | Implicancia |
|---|---|---|
| SQLite (`better-sqlite3`, WAL) con migraciones versionadas `001`→`004` | `server/db.mjs`, `server/migrations/` | Migración `005`. Sin otra DB. |
| El import borra y recrea **todas** las paradas y días | `replaceItinerary()` en `server/itinerary/store.mjs:81` | Las coordenadas solo sobreviven si viajan en el MD o si hay snapshot + guarda (§9). |
| `replaceItinerary` inserta paradas **sin** `location_mode` | `store.mjs:88-92` | El default es `pending`: los hubs dejan de heredar después del primer import. Se resuelve en §4.2. |
| `mapStop()`/`mapDay()` devuelven campos fijos | `store.mjs:31`, `store.mjs:48` | Hay que extenderlos con los campos nuevos. |
| `itineraryToCanonical` reconstruye paradas con lista fija de campos | `store.mjs:146` | Es el único input del export y del dump: sin tocarlo, `Ubicación` sale vacía. |
| Export MD determinístico (tabla de paradas) | `server/itinerary/exportMd.mjs` | Suma columnas `Hecho` y `Ubicación`. |
| `exportMd` **no** exporta `done`; trunca `notes` de parada a 500 y de día a 2.000 | `exportMd.mjs:37`, `heuristic.mjs:37`, `heuristic.mjs:143` | Round-trip ya es lossy: se corrige como prerrequisito (§7). |
| `esc()` escapa `\|` en el export, pero `splitRow` corta por todo `\|` | `exportMd.mjs:53`, `heuristic.mjs:147` | Una nota con pipe corre las columnas; con `Ubicación` al final, lee la celda equivocada. |
| `heuristic.mjs` deja `base` siempre vacío | `heuristic.mjs:44` | No es problema: las coordenadas viajan en la celda, no se reconectan por nombre. |
| `mergeRefinedDay` reemplaza el array de paradas con el de la AI | `convert.mjs:121` | Los datos determinísticos deben re-aplicarse **después** del merge y de la validación (§7.3). |
| `validateItineraryJson` reconstruye cada parada con lista fija | `schema.mjs:60`, `schema.mjs:143` | Cualquier coordenada adjunta antes de validar se pierde sin warning (§7.3). |
| `PATCH /stops/:id` sin control de versión | `server/routes/itinerary.mjs:147` | `version` solo en los endpoints de ubicación. |
| `sendError` responde `{ error: { code, message } }` | `server/helpers.mjs` | El `409` necesita además `current`: helper propio. |
| `importItineraryMdStream` descarta `status`/`code`/`data` | `src/lib/apiClient.js:82` | El flujo "Importar igual (force)" es inalcanzable sin propagarlos (§7.4). |
| `GET /expenses/dashboard` ya agrega el itinerario | `routes/expenses.mjs:145` | El progreso global va ahí, no en un endpoint nuevo. |
| `POST /api/v1/import` solo consume `jp:expenses`, `jp:logistics`, `jp:rates`, `jp:sessions` | `routes/import.mjs:120-168` | Un dump con itinerario se restaura incompleto (§9.4). |
| Backup caliente `GET /admin/backup` + volumen `nihon_data` | `routes/admin.mjs`, `docker-compose.yml` | Base para la política de persistencia (§9). |
| El stage `prod` de la imagen copia solo `server` y `dist` | `Dockerfile:43-44` | Un módulo `shared/` no existe en producción: `ERR_MODULE_NOT_FOUND` (§10). |
| `App.jsx` tiene 2.556 líneas; la vista Plan concentra el estado | `src/App.jsx:1159` | Lo nuevo va en componentes aparte. |
| `brand_app/tokens.css` define `--bg`, `--fg`, `--accent`; `src/index.css:41` solo crea aliases | `brand_app/tokens.css` | El mapa recolorea en runtime leyendo esas variables (§8.6). |
| OpenFreeMap sirve estilos `positron`, `bright`, `liberty`, `dark`, `fiord` sin key | verificado 08/11/2026 | Existe estilo oscuro: no hay que construirlo. |
| Los estilos de OpenFreeMap ya hacen `name:latin` → `name_en` → `name` | idem | **No** se sobreescribe `text-field`. |
| Los glyphs de OpenFreeMap sirven kana y kanji | idem | Los topónimos japoneses renderizan; la legibilidad latina es cosmética. |
| `npm test` = `node --test server/test/*.test.mjs` | `package.json:13` | Los tests nuevos siguen ese patrón. |

---

## 3. Decisiones

### 3.1 Navegación antes que mapa (M0)

Maps URLs acepta texto como origen y destino:

```
https://www.google.com/maps/dir/?api=1&origin=Ikebukuro,+Tokyo&destination=Senso-ji,+Asakusa,+Tokyo&travelmode=transit
```

Una parada **no** necesita ubicación validada para tener "Cómo llegar". Esto entrega valor el primer día, desacopla la navegación de la validación y elimina la presión de validar 150 paradas antes de usar la app.

La versión con coordenadas (M3) es más precisa y se ofrece cuando existe, pero no es requisito.

### 3.2 Coordenadas en la parada y en el día (sin catálogo)

- La parada guarda `lat`/`lng` propios.
- El día guarda `stay_lat`/`stay_lng` para el alojamiento.
- Los hubs (`hub_out`/`hub_back`) heredan la ubicación del alojamiento del día.
- No hay tabla `places` ni `@slug`: la misma ubicación repetida se valida dos veces. En el plan real son ~10 repeticiones (Kyoto Station, estaciones), y el hotel (el caso dominante) queda cubierto por `inherit_stay`.

Motivo: el catálogo existía para sobrevivir al `DELETE` del import. Con las coordenadas dentro del MD exportado, el import no las pierde y el catálogo deja de pagar su costo (tabla, slugs, alias, apéndice, CRUD, versión propia).

### 3.3 Parser compartido

`shared/location-parse.mjs`: función pura, sin APIs de Node, importada por:

- el **cliente** (preview en vivo, sin red): el picker la carga con `import()` dinámico para no engordar el chunk principal;
- el **servidor** (validación al escribir): nunca confía en coordenadas del cliente, solo parsea `raw_input`.

Un solo módulo, dos llamadores, mismos fixtures. El stage `prod` de la imagen debe copiar `shared/` (§10).

### 3.4 Render: MapLibre GL JS + OpenFreeMap

Se mantiene la decisión de v1.0 (costo cero, sin credenciales, estilo versionable, bajo lock-in). Correcciones verificadas:

- El estilo oscuro **existe**: `https://tiles.openfreemap.org/styles/dark`.
- No se sobreescribe `text-field`: los estilos ya priorizan escritura latina sobre `name_en`/`name`.
- Los colores de marca se aplican **en runtime**, no en el JSON (§8.6).

### 3.5 Persistencia

SQLite sigue siendo la fuente de verdad en ejecución; el Markdown sigue siendo el formato de intercambio humano. El import es un **reemplazo deliberado**, nunca un sync. Ver §9.

### 3.6 Concurrencia

- `itinerary_stops.version` y `itinerary_days.version` (entero, `DEFAULT 1`).
- Toda escritura de ubicación envía la `version` leída. Si no coincide → `409 VERSION_CONFLICT` con el registro actual en el body.
- La UI ofrece **Ver la actual** / **Reemplazar con la mía** (reintenta con la versión nueva).
- El resto de las escrituras (texto de la parada, día) sigue sin control de versión: fuera de alcance.

---

## 4. Modelo de datos — migración `005_locations.sql`

### 4.1 DDL

```sql
ALTER TABLE itinerary_stops ADD COLUMN lat REAL;
ALTER TABLE itinerary_stops ADD COLUMN lng REAL;
ALTER TABLE itinerary_stops ADD COLUMN location_mode TEXT NOT NULL DEFAULT 'pending'
  CHECK (location_mode IN ('pending', 'coords', 'not_applicable', 'inherit_stay'));
ALTER TABLE itinerary_stops ADD COLUMN location_precision TEXT
  CHECK (location_precision IN ('place', 'view'));
ALTER TABLE itinerary_stops ADD COLUMN raw_input TEXT;
ALTER TABLE itinerary_stops ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE itinerary_days ADD COLUMN stay_lat REAL;
ALTER TABLE itinerary_days ADD COLUMN stay_lng REAL;
ALTER TABLE itinerary_days ADD COLUMN stay_precision TEXT
  CHECK (stay_precision IN ('place', 'view'));
ALTER TABLE itinerary_days ADD COLUMN stay_raw_input TEXT;
ALTER TABLE itinerary_days ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- Backfill: hubs heredan del alojamiento
UPDATE itinerary_stops SET location_mode = 'inherit_stay'
WHERE kind IN ('hub_out', 'hub_back');
```

Notas de implementación:

- SQLite permite `CHECK` sobre columnas agregadas con `ALTER TABLE ... ADD COLUMN` (verificado). `NULL` siempre pasa el CHECK, así que `precision` puede quedar nula.
- Lo que **no** se puede con `ALTER` es un CHECK que cruce columnas (`mode = 'coords'` ⇒ `lat`/`lng` no nulos): esas invariantes viven en la aplicación y se cubren con tests (§4.4).
- `raw_input` (≤ 2.000 chars): lo que pegó el usuario, para auditar y re-parsear. No se exporta ni se envía al cliente.
- `location_precision` / `stay_precision`: `'place'` (coordenada del lugar) o `'view'` (centro de vista, aproximada).
- El backfill solo cubre los datos existentes; las inserciones nuevas fijan el modo en código (§4.2).

### 4.2 `location_mode` (parada)

| Valor | Significado | Requiere |
|---|---|---|
| `pending` | Sin validar (default) | — |
| `coords` | Coordenada validada | `lat` y `lng` no nulos |
| `not_applicable` | "No requiere ubicación" | `lat` y `lng` nulos |
| `inherit_stay` | Usa el alojamiento del día (default de `hub_out`/`hub_back`) | `stay_lat`/`stay_lng` del día |

**Derivación al insertar:** toda inserción de paradas (`replaceItinerary`, `POST /days/:dayId/stops`) fija `location_mode` desde `kind`: hubs → `inherit_stay`, resto → `pending`, salvo que §7.3 aplique una ubicación explícita. Sin esto, el primer import devuelve los hubs a `pending`.

### 4.3 Ubicación efectiva

`effectiveLocation(stop, day)`:

- `coords` → `{ lat, lng }`.
- `inherit_stay` → `{ lat: day.stay_lat, lng: day.stay_lng }` si existen; si no, `null`.
- `pending` / `not_applicable` → `null`.

Una parada **cuenta como resuelta** si es `coords`, `not_applicable`, o `inherit_stay` con alojamiento ubicado. El **total** de una parada concreta incluye hubs; el progreso se define en §8.3.

### 4.4 Invariantes (validadas en la aplicación, con tests)

1. `mode = coords` ⇒ `lat` y `lng` presentes, `lat ∈ [-90, 90]`, `lng ∈ [-180, 180]`, `precision` no nula.
2. `mode ∈ {pending, not_applicable, inherit_stay}` ⇒ `lat` y `lng` nulos (se limpian al cambiar de modo).
3. `version` se incrementa en cada escritura de ubicación y nunca se acepta del cliente.

### 4.5 Ciclo de vida

- Ningún import ni borrado de paradas o días toca datos de otras entidades.
- Editar la ubicación de una parada es una operación independiente de editar su texto.

---

## 5. Parser de ubicaciones — `shared/location-parse.mjs`

```js
parseLocationInput(input, { reference } = {})
```

`reference` es un punto opcional `{ lat, lng }` para Plus Codes cortos (en la UI: el alojamiento del día).

Devuelve:

```js
{ ok: true, lat, lng, source, precision: 'place' | 'view', suggested_name?, warnings: [] }
// o
{ ok: false, error, warnings: [] }
```

### 5.1 Formatos soportados (orden de detección)

| # | Formato | Ejemplo | Regla |
|---|---|---|---|
| 1 | Decimal | `35.7147651, 139.7966553` | Separador `,`, `;` o espacio; orden **lat, lng**. Un solo número → error. |
| 2 | DMS | `35°42'53.2"N 139°47'47.9"E` | Hemisferio S/W → negativo. |
| 3 | URL completa | `…/maps/place/Senso-ji/@35.71,139.79,17z/data=…!3d35.7147651!4d139.7966553` | Prioridad `!3d!4d` → `precision: 'place'`. Si el `pb` trae varios pares (centro de vista `!1m5` + lugar `!3m5`), se usa el **último**, que es el lugar. Luego `?q=`, `query=`, `ll=`, `destination=` con lat,lng → `place`. Al final `@lat,lng` (centro de vista) → `precision: 'view'` + warning "coordenada aproximada". |
| 4 | Plus Code global | `8Q7XPQ7W+V2` | Decodificación local. |
| 5 | Plus Code corto | `PQ7W+V2 Taito City, Tokyo` | `recoverNearest(reference)`. Sin `reference` → error pidiendo el código completo. Si la distancia al punto de referencia supera 25 km → warning `SHORT_CODE_FAR`. |

**Anclaje de las reglas:** las reglas 1, 2, 4 y 5 se aplican al input completo (`trim`) y el match debe cubrir toda la cadena; si no, se pasa a la siguiente. Así una URL con `@35.71,139.79` no puede ser capturada por la regla decimal.

**Desempate de coma:** si los dos tokens son enteros sin punto decimal (`35,7`), no es coordenada → error. Una latitud japonesa siempre tiene parte decimal.

- **`suggested_name`:** si la URL contiene `/place/<Nombre>/`, se decodifica (`+` → espacio, `%xx`).
- **Warning (no error):** coordenada fuera del rango aproximado de Japón (lat 20–46, lng 122–154). Señal típica de lat/lng invertidos.
- **Error:** texto sin formato reconocible. El mensaje sugiere "click derecho en el mapa → copiar coordenadas".

### 5.2 Plus Codes

Usar `open-location-code@1.0.3` (port oficial de Google, Apache-2.0) para `decode` y `recoverNearest`. En el cliente se carga junto con el picker (chunk aparte).

Si el paquete presenta problemas de interoperabilidad ESM/CJS o de bundle, la alternativa es portar esas dos funciones a `shared/pluscode.mjs` (~80 líneas) y validarlas contra los pares fijos del repo oficial. La decisión se toma en M1 con los tests en mano; el contrato de `parseLocationInput` no cambia.

### 5.3 Fixtures

`server/test/fixtures/locations.json` con **entradas reales** copiadas desde desktop y celular. Mínimo: 2 decimales, 2 DMS, 2 URLs con `!3d!4d`, 1 URL solo con `@`, 1 Plus Code global, 1 corto, 1 basura, 1 par invertida, 1 `35,7`.

Los links cortos quedan fuera de v1 (§15): el picker instructa copiar coordenadas o la URL expandida del navegador.

---

## 6. API REST

Sesión autenticada (hook existente). Formato de error actual: `sendError`. El `409` de conflicto usa un helper que agrega `current`.

### 6.1 Ubicación de paradas y alojamientos

| Método | Ruta | Body | Notas |
|---|---|---|---|
| `PUT` | `/api/v1/itinerary/stops/:id/location` | `{ version, mode, raw_input? }` | `mode ∈ pending \| coords \| not_applicable \| inherit_stay`. `mode = coords` **exige** `raw_input` (`400 RAW_INPUT_REQUIRED` si falta): el servidor parsea y deriva `lat`/`lng`/`precision`. Las coordenadas del cliente no se aceptan en ningún caso. `409` si `version` no coincide. |
| `PUT` | `/api/v1/itinerary/days/:id/stay-location` | `{ version, raw_input }` o `{ version, clear: true }` | Mismo contrato: el servidor parsea `raw_input`. `clear: true` limpia el alojamiento. `409` igual. |

**Respuesta de éxito:** ambos endpoints devuelven la parada o el día actualizado, **incluida la `version` nueva**, para que el cliente actualice su estado sin refetchear el itinerario completo.

Respuesta de `409`:

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "Otra persona actualizó esta ubicación",
    "current": { "id": "…", "version": 4, "location_mode": "coords", "lat": 35.714765, "lng": 139.796655 }
  }
}
```

### 6.2 Cambios en endpoints existentes

- `GET /api/v1/itinerary`: cada parada incluye `lat`, `lng`, `location_mode`, `location_precision`, `version`; cada día incluye `stay_lat`, `stay_lng`, `stay_precision`, `version`. **No** se envía un objeto `effective_location` duplicado: el cliente lo deriva con la regla de §4.3. `raw_input` no se expone.
- `GET /api/v1/expenses/dashboard`: `itinerary.locations = { total, resolved, pending }` calculado con una consulta agregada sobre `location_mode` y las coordenadas del día.
- `PATCH /api/v1/itinerary/stops/:id`: **sin** `version` en v1. Agregarla haría fallar el guardado de texto cuando otro usuario tocó la ubicación.
- `POST /api/v1/itinerary/import-md` y `/import-json`: §7.
- `GET /api/v1/export/dump` y `POST /api/v1/import`: §9.4.

---

## 7. Export / Import MD

### 7.1 Export (`exportMd.mjs`)

La tabla de paradas suma dos columnas al final: **`Hecho`** y **`Ubicación`**.

```markdown
| # | Parada | Detalle | Cómo llegar | Est. | Notas | Kind | Hecho | Ubicación |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3 | Sensō-ji | Templo | Metro ~20 min | 90 min | | stop | x | 35.714765,139.796655 |
| 4 | Almuerzo | | | 45 min | | stop | | — |
| 5 | Retorno | | | | | hub_back | | stay |
| 6 | Mirador | | | 30 min | | stop | | ~35.709000,139.810000 |
```

- `Ubicación`: `lat,lng` con 6 decimales · `~lat,lng` si `precision = 'view'` · `—` → `not_applicable` · `stay` → `inherit_stay` · vacío → `pending`.
- `Hecho`: `x` si `done`, vacío si no.
- Debajo de `**Alojamiento:**` se agrega `**Ubicación alojamiento:** 34.985849,135.758767` (o `~lat,lng` si es aproximada) cuando existe.
- **Se debe tocar `itineraryToCanonical` (`store.mjs:146`)**, no solo `exportMd`: es el único input del export y hoy descarta `lat`/`lng`/`location_mode`/`precision` y `stay_*`. Sin ese cambio la columna sale vacía.
- **No hay apéndice de lugares.** El MD es autosuficiente con la columna.
- Las notas dejan de truncarse: parada y día usan el mismo límite que el schema (4.000).

### 7.2 Import: extracción determinística

- `heuristic.mjs` lee `Base`, `Ubicación`, `Ubicación alojamiento` y `Hecho` **directamente del MD**, sin AI.
- Orden de resolución de la celda `Ubicación`:
  1. `—` → `not_applicable`.
  2. `stay` → `inherit_stay`.
  3. `/^\s*~?\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/` → `coords`, con `precision = 'view'` si empieza con `~`.
  4. Cualquier otro valor no vacío → warning `LOCATION_UNPARSABLE` y `pending`.
  5. Vacío → `pending`.
- `**Ubicación alojamiento:**` se parsea con el mismo formato, anclado a la línea (`^\*\*Ubicación alojamiento:\*\*`). El regex de `Alojamiento` debe anclarse a `^\*\*Alojamiento:\*\*`, porque el fallback actual `/Alojamiento:\s*(.+)/i` captura la línea de ubicación y contamina `stay_label`.
- **Celdas con pipe:** `splitRow` debe cortar por `|` **no escapado** y des-escapar `\|`; `exportMd` ya escapa (una nota con `|` corre todas las columnas).
- **Apéndice viejo:** si el MD trae `## Ubicaciones` (export de v1.0), se parsea por compatibilidad, se aplica y se **quita antes** de trocear por días.
- `importPrompt.mjs`: la AI **no** recibe ni devuelve ubicaciones. Se instruye a no inventarlas.

### 7.3 Aplicación de datos determinísticos (dentro de `replaceItinerary`)

El refine de la AI puede reordenar o renombrar paradas, y `validateItineraryJson` reconstruye cada parada con una lista fija de campos (`schema.mjs:143`): **cualquier coordenada adjunta antes de validar se pierde en silencio**. Por eso el orden es:

1. Heurística → `days[]` (sin ubicaciones) + `locationsByDay: Map<day_number, [{ index, name, location, done }]>`, en el orden de la tabla.
2. Refine AI + `mergeRefinedDay`, como hoy.
3. `validateItineraryJson` final. La AI nunca vio ni emitió coordenadas.
4. Dentro de `replaceItinerary`, **antes de insertar** y **después de validar**, resolver cada parada final contra `locationsByDay` del día (`convertMarkdownToItinerary` lo devuelve junto con `data`; la ruta lo pasa como `replaceItinerary(db, data, { locationsByDay })`):
   - a. por `name_norm` unívoco dentro del día;
   - b. solo si la cantidad de paradas del día coincide con la del MD, por índice **y** con `name_norm` igual;
   - c. si no hay match → `pending` + warning `LOCATION_UNMATCHED`.
   Los hubs sin ubicación explícita quedan `inherit_stay` (§4.2).
5. Insertar con `location_mode`, `lat`, `lng`, `location_precision`, `raw_input` y `done`.

`name_norm`: NFKC → minúsculas → sin diacríticos → sin marcas markdown (`*`, `_`, `` ` ``) → sin paréntesis finales → espacios colapsados → `trim`.

El fallback por índice **nunca** se aplica si la cantidad de paradas cambió: mover una coordenada a otra parada es peor que dejarla pendiente.

### 7.4 Guarda anti-pérdida

Preflight, **antes** de la AI, **antes** del `hijack` del stream y **antes** del snapshot de §9.3:

- Contar **celdas importables** del MD: celdas no vacías de la columna `Ubicación` + líneas `**Ubicación alojamiento:**`. Tokens válidos: `lat,lng`, `~lat,lng`, `stay`, `—`.
- Si el total importable es `0` y la DB tiene paradas resueltas `> 0` → `409 LOCATIONS_AT_RISK { resolved: n }`.
- La UI muestra: "Este Markdown no trae ubicaciones. Tu itinerario tiene 87 ubicaciones validadas y se van a perder." con **Cancelar** / **Importar igual** (`force: true`).
- Con `force`, el import procede y el reporte incluye `warnings: ["87 ubicaciones descartadas"]`.
- `importItineraryMdStream` debe propagar `status`, `code` y `data` del response en el `Error` (hoy los descarta, `apiClient.js:82`), o el diálogo no puede mostrar el conteo ni reintentar con `force`.

La guarda mira **datos, no cabeceras**: un MD con la columna presente pero todas las celdas vacías también dispara el 409.

### 7.5 Reporte

`relink_report: { located, not_applicable, inherited, pending, warnings[] }`. La UI muestra "142 ubicadas · 6 pendientes" al terminar.

---

## 8. Frontend

### 8.1 Componentes nuevos

| Archivo | Responsabilidad |
|---|---|
| `src/lib/locations.js` | `mapsSearch`, `mapsDirections`, `effectiveLocation`, `locationProgress` (funciones puras) |
| `src/components/LocationBadge.jsx` | Chip de estado: Pendiente · Ubicada · Heredada · No aplica · Aproximada |
| `src/components/LocationPicker.jsx` | Flujo de validación (parada y alojamiento) + modo lote |
| `src/components/DayMap.jsx` | Mapa del día. **Única** pieza que conoce MapLibre |

`App.jsx` solo agrega el cableado: estado y apertura.

### 8.2 M0 — "Cómo llegar" sin coordenadas

- Botón por parada en la lista del día y por tramo en el detalle del día.
- Origen: parada anterior ubicada, o el nombre de la parada anterior, o el `stay_label` del día.
- Destino: `"<nombre parada>, <base o stay_label>, Japón"`.
- `travelmode=transit`. Sin key, sin costo.
- Si hay coordenadas, se usan (`origin=lat,lng`), porque son más precisas.
- También "Ver en Google Maps" desde el buscador de texto.

### 8.3 Progreso y badges

- `locationProgress(day)` → `{ total, resolved, pending }`. `total` = todas las paradas del día, **incluidos los hubs**; `resolved` = §4.3.
- Badge por día en Plan: `6/8 ubicadas`, con color de token (`--accent` completo, `--warn` parcial).
- Filtro en Plan: **"Pendientes de ubicar"**.
- Card en Resumen: porcentaje global desde `expenses.dashboard.itinerary.locations`; el agregado del servidor debe usar exactamente la misma definición que `locationProgress`, con un test que compare ambos.
- El mapa del día lista debajo las paradas sin ubicar, con CTA que abre el picker.

### 8.4 LocationPicker

1. **Estado actual** con `LocationBadge`. Si tiene coordenadas: nombre, "Ver en Google Maps", "Reemplazar".
2. **"Buscar en Google Maps"** → `maps/search/?api=1&query=<nombre parada> <base>` en pestaña nueva.
3. **Campo "Pegar ubicación"**: textarea + botón **Pegar** (`navigator.clipboard.readText()`, best-effort). Ayuda contextual colapsable: desktop (click derecho → copiar coordenadas), celular (mantener presionado el punto → tocar las coordenadas).
4. **Parseo en vivo** con el módulo compartido, debounce 300 ms, **sin red**. Muestra formato detectado, warnings, y mini-preview (un pin) + "Verificar en Google Maps". Si `precision = 'view'`, muestra "Coordenada aproximada".
5. **Confirmar ubicación**: deshabilitado hasta `ok`. Envía `{ version, mode: 'coords', raw_input }`.
6. **Modo lote** (el flujo real de escritorio): textarea con N líneas, una por parada, en formato `nombre<TAB>dato` o solo `dato` (se aplica en orden a las paradas pendientes del día). Parsea todo localmente, lista el resultado con estado por línea y confirma en bloque.
   - Se aplica con `PUT` secuencial; cada respuesta trae la parada actualizada con su `version`.
   - Se guarda el resultado por línea. Al primer `409` se detiene y muestra el conflicto; al reintentar se omiten las líneas ya aplicadas (por `stop_id` + `version`).
7. **Acciones secundarias**: "No requiere ubicación" · "Heredar del alojamiento" (hubs).
8. **Conflicto `409`**: reusar `ConfirmDialog` con "Ver la actual" / "Reemplazar con la mía" (reintenta con la versión nueva).

### 8.5 DayMap

- Se abre desde `ItineraryDayDetailModal` y desde el día en Plan (toggle **Lista / Mapa**).
- **Marcadores** numerados por `sort_order`; el alojamiento va con marcador distinto.
- **Trazo:** línea punteada recta entre paradas consecutivas ubicadas. Es esquemático, **no es una ruta**, y la leyenda lo dice.
- **Tap en marcador** → card con nombre, `how_to_get`, `est_duration`, y botones **Cómo llegar** / **Ver lugar**.
- **Encuadre:** `fitBounds` a los puntos del día con padding. Sin puntos → estado vacío con CTA.
- Si no hay red o fallan los tiles: el mapa muestra un mensaje y la lista sigue siendo la vía principal.

### 8.6 Estilo y marca

- URLs por env, con default: `VITE_MAP_STYLE_LIGHT=https://tiles.openfreemap.org/styles/positron`, `VITE_MAP_STYLE_DARK=https://tiles.openfreemap.org/styles/dark`.
- **Recoloreo en runtime:** al crear el mapa se hace `fetch` del estilo, se sobrescriben las capas de fondo, agua y vías leyendo `--bg`, `--bg-sunken`, `--fg-muted`, `--border` con `getComputedStyle`. El resto del estilo queda como viene. `glyphs` y `sprite` se mantienen.
- **Dark legible:** las vías bajan su opacidad (0.38; casing 0.65) y los labels usan `text-color: --fg` + halo `--bg` (≥1.2). El estilo dark de OpenFreeMap trae labels oscuros pensados para su fondo casi negro; sobre el sumi de marca no se leían. No se toca `text-field`.
- Cambio de tema → `map.setStyle(nuevoEstilo)` y se re-crean marcadores y trazo.
- **Marcadores:** colores desde variables CSS (`--accent` seleccionado, `--fg`/`--bg` numeración, `--warn` alojamiento), tipografía IBM Plex Mono en los números.
- **No se overridea `text-field`.** Atribución OSM/OpenFreeMap visible (la agrega MapLibre).

### 8.7 Performance

- `maplibre-gl` y su CSS se cargan con `import()` dinámico al abrir un mapa o una preview.
- `shared/location-parse.mjs` (+ Plus Codes) se carga con `import()` dinámico al abrir el picker.
- **Criterio:** el chunk principal no crece más de 10 KB gzip. El chunk del mapa se mide en M4 y se documenta.

---

## 9. Persistencia y backups

### 9.1 Decisión

| Capa | Rol |
|---|---|
| SQLite | Fuente de verdad en ejecución (días, paradas, coordenadas, gastos, sesiones). |
| Markdown | Formato de intercambio humano y respaldo legible. Se importa y se exporta a mano. |
| Snapshot `.db` | Red de seguridad automática antes de cada operación destructiva. |

No hay sync ni merge continuo entre archivo y DB: el import es un reemplazo deliberado.

### 9.2 Por qué no Markdown como fuente de verdad

- El itinerario es relacional (días → paradas con orden y FK) y hoy convive con gastos, sesiones y cotizaciones en la misma base.
- Dos usuarios editando necesitan transacciones y `version`; un archivo no las da.
- El pipeline de import es AI + heurístico y es deliberadamente lossy: no sirve como capa de lectura.
- `done`, orden y notas no son contenido del plan; contaminarían el documento que hoy se edita a mano.
- El markdown ya existe como archivo: convertirlo en SoT no agrega nada que el export no dé.

### 9.3 Por qué el SQL solo no alcanza (para ubicaciones)

Las coordenadas existen **solo** en la DB. Un import de un MD viejo (sin columna `Ubicación`) las borra. Tres mitigaciones, todas obligatorias:

1. **El export es autosuficiente:** la columna `Ubicación` viaja en el MD, así que exportar → reimportar no pierde nada.
2. **Snapshot antes de importar:** en el mismo preflight de §7.4, antes de la AI y antes del `hijack`:
   - directorio: `join(dirname(config.dbPath), "backups")`, creado con `mkdirSync(..., { recursive: true })`. SQLite **no** crea directorios, y el stage `prod` solo crea `/app/data`.
   - `VACUUM INTO` con timestamp. Si falla, el import se aborta con `500 SNAPSHOT_FAILED` antes de tocar datos (fail closed), también en modo stream: el error se emite antes del `writeHead`, así que llega como `409`/`500` normal y no como evento NDJSON.
   - `VACUUM INTO` no puede correr dentro de una transacción: por eso va antes de `replaceItinerary`.
   - Fallback si el SQLite de la imagen rechaza el parámetro: `db.backup(path)` (async).
   - Retención: las últimas 5 copias. `data/` ya está en `.gitignore`.
3. **Guarda de import (§7.4):** 409 + confirmación explícita cuando el MD entrante no trae ubicaciones y la DB tiene datos que se perderían.

### 9.4 Export completo y restauración

- `GET /api/v1/export/dump` suma `"jp:itinerary"` (JSON canónico con coordenadas, `done` y orden).
- `POST /api/v1/import` consume `"jp:itinerary"` y lo aplica con `replaceItinerary`.
- Para que las coordenadas sobrevivan, `validateItineraryJson(raw, { trustLocations })`:
  - `true` (dump e `import-json`): conserva y valida `lat`, `lng`, `location_mode`, `location_precision`, `raw_input` y `stay_*`.
  - `false` (import MD y salida de la AI): los descarta. Así la AI no puede inyectar coordenadas aunque las alucine.

### 9.5 Operación

- Backup caliente manual: `GET /api/v1/admin/backup` (ya existe).
- Backup en frío antes de la migración `005`: procedimiento del README.
- Los snapshots de import son automáticos y no requieren intervención.

---

## 10. Requisitos no funcionales

- **Sin API keys nuevas** ni billing.
- **Seguridad:** todos los endpoints detrás de la sesión existente; `raw_input` limitado a 2.000 caracteres; el servidor **siempre** re-parsea y nunca acepta `lat`/`lng` del cliente (§6.1).
- **CSP:** si se agrega, permitir `tiles.openfreemap.org` (estilos, tiles, glyphs y sprites).
- **Logs:** fuente detectada y fallos de parseo; no loggear `raw_input` completo en `info`.
- **Docker:** sin servicios nuevos. Dependencias: `maplibre-gl` (prod) y `open-location-code` (si se usa). El stage `prod` copia solo `server` y `dist` (`Dockerfile:43-44`): agregar **`COPY shared ./shared`**, o el servidor falla al arrancar con `ERR_MODULE_NOT_FOUND`. Respetar `.cursor/rules/docker-rebuild-after-changes.mdc`.
- **Accesibilidad:** el mapa no es la única vía; la lista con "Cómo llegar" por tramo cubre la misma función. Targets ≥ 44 px.
- **Sin red:** la lista y los deep links funcionan; el mapa degrada con mensaje.

---

## 11. Testing

| Área | Tests |
|---|---|
| Parser | Fixtures reales de los 5 formatos, lat/lng invertidas → warning, basura → error, `!3d!4d` gana sobre `@`, `@` marca `precision: 'view'`, `35,7` → error, URL con `@lat,lng` no capturada por la regla decimal, pb con lugar + centro → bloque del lugar, pares fuera de rango → se ignoran |
| Plus Code | Global, corto con referencia cercana, corto lejos → `SHORT_CODE_FAR`, sin referencia → error |
| Invariantes | `mode=coords` sin `raw_input` → `400`; `mode=not_applicable` limpia coordenadas; rango de `lat`/`lng` |
| Concurrencia | Dos `PUT location` con la misma `version` → el segundo recibe `409` con `current` |
| Migración | Correr `005` sobre una copia de una DB real: hubs quedan `inherit_stay`, resto `pending` |
| Hubs | Importar un itinerario y verificar que los hubs siguen en `inherit_stay` y que el progreso no los cuenta como pendientes |
| Round-trip | Validar → exportar → reimportar el mismo MD → 100 % de ubicaciones, `precision`, `done` y notas (incluida una nota con `\|` y una nota de día de 3.000 chars) |
| Merge | La AI reordena/renombra paradas → las coordenadas se re-aplican por nombre; si cambia la cantidad, no se usa el índice y queda `pending` + warning |
| Guarda | MD con columna pero celdas vacías + DB con ubicaciones → `409 LOCATIONS_AT_RISK`; con `force` → importa y reporta; el error del stream conserva `code` y `data` |
| Snapshot | Primer import en un volumen sin `data/backups` crea el directorio y el snapshot; con 6 snapshots se conservan 5; si falla, el import no se ejecuta y responde error, no NDJSON |
| Dump | `export/dump` → `import` restaura itinerario con coordenadas y `done` |
| Progreso | `na` cuenta como resuelta; `inherit_stay` sin alojamiento no cuenta; agregado del dashboard == `locationProgress` del cliente |

Los tests corren en el pipeline actual (`npm test`, `node --test`). Los del parser son los mismos fixtures para cliente y servidor.

---

## 12. Plan de entrega

| Fase | Contenido | Estimación |
|---|---|---|
| **M0 — Navegación por texto** | `locations.js` + botones "Cómo llegar" en lista y detalle | 0,5 d |
| **M1 — Datos y parser** | Migración `005`, `shared/location-parse.mjs`, 2 endpoints, `version`/`409`, `COPY shared`, tests | 2 d |
| **M2 — Round-trip** | `itineraryToCanonical`, columnas `Ubicación`/`Hecho`, lectura heurística, re-aplicación post-validación, guarda, snapshot | 2 d |
| **M3 — Validación (UI)** | `LocationPicker` (incluye modo lote), `LocationBadge`, progreso y filtro, card en Resumen | 2,5 d |
| **M4 — Mapa** | `DayMap`, deep links por tramo, recoloreo por tokens, lazy load | 2 d |
| M5 — Opcional | Links cortos con allowlist SSRF, sugerencias difusas, vista global del viaje | — |

**Total v1: ~9 días** + 2–4 h de carga de ubicaciones (menos con el modo lote).

Orden justificado: M0 entrega valor sin datos; M2 protege lo que M1 crea antes de que M3 invite a cargar 150 paradas.

---

## 13. Criterios de aceptación

- [ ] **M0:** "Cómo llegar" abre Google Maps con origen/destino correctos y modo transporte público, **sin ninguna ubicación validada**.
- [ ] Pegar decimal, DMS, URL con `!3d!4d`, URL con `@` y Plus Code (global y corto con referencia) produce la ubicación correcta en la preview.
- [ ] No se puede confirmar una ubicación sin parseo exitoso; una parada `pending` no aparece en el mapa.
- [ ] `precision: 'view'` se muestra como "coordenada aproximada" y **sobrevive** al round-trip.
- [ ] Los hubs toman la ubicación del alojamiento del día sin validación extra, **también después de un import**.
- [ ] El progreso por día y el global reflejan `resolved/total`; "No requiere ubicación" cuenta como resuelta; el agregado del servidor coincide con el del cliente.
- [ ] **Exportar → reimportar el mismo MD conserva el 100 % de ubicaciones, `precision`, `done` y notas**, incluida una nota con `|`.
- [ ] Reimportar un MD sin ubicaciones (sin columna **o** con celdas vacías) avisa cuántas se pierden y no procede sin confirmación.
- [ ] Todo import crea un snapshot previo, incluso en un volumen nuevo; con 6 snapshots se conservan 5.
- [ ] `export/dump` → `import` restaura el itinerario con coordenadas.
- [ ] Dos usuarios editando la misma ubicación: el segundo recibe el aviso y puede elegir.
- [ ] "Cómo llegar" desde el mapa usa coordenadas cuando existen y texto cuando no.
- [ ] El mapa respeta tema light/dark, usa tokens de `brand_app` y el cambio de tema no rompe marcadores.
- [ ] El chunk principal no crece más de 10 KB gzip; MapLibre y el parser se cargan bajo demanda.
- [ ] La imagen `prod` arranca con `shared/` incluido.
- [ ] `npm test` en verde, incluidos los tests nuevos.

---

## 14. Riesgos

| Riesgo | Mitigación |
|---|---|
| Volumen de validación (~150 paradas) | M0 desacopla la navegación; modo lote; `inherit_stay`; "No requiere ubicación"; filtro de pendientes |
| Import de un MD viejo borra coordenadas | Columna en el export + snapshot + guarda 409 por conteo de celdas |
| La AI reordena paradas y desalinea coordenadas | Re-aplicación por nombre después de validar; el índice solo con la misma cantidad; la AI nunca emite coordenadas |
| Etiquetas solo en japonés | Verificado: los glyphs CJK se sirven y el estilo prioriza `name:latin`/`name_en`. Si un POI queda en japonés, los marcadores numerados y la lista dan la función |
| Servicio de OpenFreeMap no disponible | Estilo por env → cambio de proveedor sin tocar código; `DayMap` aísla el vendor; la lista sigue funcionando |
| Sin conectividad durante el viaje | Lista + deep links funcionan offline; el mapa degrada con mensaje |
| Renombrar una parada rompe la reconexión | Las coordenadas viajan en la celda, no dependen del nombre; solo el match tras el refine usa el nombre, con fallback por índice condicionado |

---

## 15. Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Catálogo `places` + `@slug` + apéndice + alias (v1.0) | Resolvía la pérdida de coordenadas en el import a cambio de ~2 días y 6 piezas móviles. La columna `Ubicación` resuelve lo mismo; el catálogo se puede extraer después desde las coordenadas sin migración traumática. |
| Markdown como fuente de verdad | Rompe transacciones, concurrencia y consultas; el pipeline de import es lossy por diseño (§9.2). |
| Google Maps JS | Requiere billing y key; el mapa es de contexto, no de navegación. |
| Sobreescribir `text-field` para forzar latín | Los estilos de OpenFreeMap ya hacen el `coalesce` correcto sobre 19 capas symbol. |
| Resolver links cortos en v1 | ~1 día de código sensible (SSRF, redirects, mocks) para un atajo que se reemplaza copiando la URL expandida del navegador. Queda como M5, con allowlist de hosts, `redirect: manual`, máximo 3 saltos y timeout de 5 s. |
| Endpoint `GET /location-progress` | El dashboard ya agrega el itinerario y el cliente ya tiene los días; era un tercer cálculo del mismo dato. |
| `version` en `PATCH /stops/:id` | Haría fallar el guardado de texto por un cambio de ubicación ajeno. |
