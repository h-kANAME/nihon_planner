# Design tokens — legacy (kyz + Material)

> **Deprecado como SoT.** La fuente de verdad actual es [`../brand_app/`](../brand_app/) (ver [`brand.md`](./brand.md)).  
> Este documento describe el sistema anterior (verde kyz). El runtime ya cruza a hi-no-maru / paper / Space Grotesk vía `brand_app` + Tailwind.

Tokens semánticos legacy. Código bridge: [`src/theme.js`](../src/theme.js).

## Modos

| Modo | Default | Persistencia |
|------|---------|--------------|
| `dark` | Sí (o `prefers-color-scheme`) | `localStorage` clave `nihon-theme` |
| `light` | Si el SO prefiere light | Toggle 明/暗 en header y login |

CSS: `document.documentElement[data-theme]` + variables `--surface`, `--primary`, etc.

## Paleta semántica

| Token | Dark | Light | Uso |
|-------|------|-------|-----|
| `surface` | `#2d2e32` | `#F4F6F5` | canvas |
| `surfaceDim` | `#202022` | `#E8ECEA` | fondo profundo / filled input |
| `surfaceContainer` | `#25262a` | `#FFFFFF` | cards, nav |
| `surfaceContainerHigh` | `#2f3035` | `#EEF2F0` | chips idle, inputs |
| `onSurface` | `#f3f4f6` | `#1A1C1E` | texto primario |
| `onSurfaceVariant` | `#9ca3af` | `#5C6560` | texto secundario |
| `outline` / `outlineVariant` | `#374151` / `#2a2f36` | `#C5CDC8` / `#E1E8E4` | bordes |
| `primary` | `#15eb80` | `#0B8F55` | CTA, focus, nav activo |
| `onPrimary` | `#042016` | `#FFFFFF` | texto sobre primary |
| `primaryContainer` | `rgba(21,235,128,.14)` | `#C8F7DC` | chip/nav selected |
| `onPrimaryContainer` | `#64f4ac` | `#045C38` | texto en container |
| `secondary` | `#64f4ac` | `#3D6B5C` | labels / eyebrow |
| `error` / `errorContainer` | `#e57373` / tint | `#B3261E` / `#F9DEDC` | errores |
| `hanko` | `#BC002D` | `#BC002D` | brand only (hinomaru) |

Aliases legacy (`bg`, `ink`, `card`, `accent`, …) siguen mapeados para no romper pantallas.

## Tipografía (Material)

Familia: **Roboto** + system fallback. Roles: `display` 28/700 · `title` 22/700 · `body` 14/400 · `label` 12/600 · `caption` 11/400.

## Forma / elevación

- Radios: 8 / 12 / 16 / pill (chips).
- Elevation 1: cards + nav. Elevation 2: sheets/FAB (futuro).
- Inputs: filled (`surfaceContainerHigh` + underline 2px primary on focus).
- Nav: indicator pill + `primaryContainer` en tab activo + `safe-area-inset-bottom`.
- Targets táctiles ≥ 44–48 px.

## UX (auditoría)

Problemas abordados en este refactor: tokens no semánticos, nav sin indicador/safe-area, inputs sin focus, chips/CTAs inconsistentes, type scale ad-hoc.

Sin MUI: se copian principios MD3 (elevation, state containers, type roles), no la librería.

## Gate de diseño

Revisar Resumen en **light y dark** antes de merge definitivo a main.
