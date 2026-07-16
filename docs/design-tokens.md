# Design tokens — kyz.com.ar → Nihon Planner

Extraídos manualmente del CSS del portfolio (https://kyz.com.ar) el 15/07/2026.

## Paleta

| Token | Valor | Origen |
|-------|-------|--------|
| `bg` | `#2d2e32` | `bg-dark-200` header |
| `bgDeep` | `#202022` | fondos profundos |
| `card` / superficie | `#25262a` | `dark-100` |
| `ink` (texto primario) | `#f3f4f6` | gray-100 |
| `soft` (texto secundario) | `#9ca3af` | gray-400 |
| `line` | `#374151` | gray-700 |
| `accent` | `#15eb80` | `green-100` hover/CTA |
| `accentDim` | `#047857` | `green-600` chips |
| `matcha` | `#64f4ac` | labels |
| `danger` | `#be6464` | errores portfolio |
| `hanko` | `#BC002D` | hinomaru (branding Nihon, no portfolio) |

## Tipografía

- Familia: `ui-sans-serif, system-ui, -apple-system, Segoe UI` (igual que el CSS compilado de Tailwind del portfolio).
- Display / body: misma familia; pesos 400–800.

## Forma

- Radios: chips/tags `3px` (como badges del hero); inputs/cards `10–14px`.
- Sombras: mínimas; atmósfera con gradiente radial suave del acento.
- Botones: outline acento o fill `accentDim`; targets ≥ 44px.

## Modo

El portfolio es **dark-first**. Nihon Planner adopta dark como default (sin toggle claro en v1).

## Gate de diseño

Pantalla Resumen renderizada con estos tokens — pendiente de aprobación explícita de Product (Emma) antes del merge definitivo a main.
