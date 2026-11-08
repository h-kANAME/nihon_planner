# Brand App — fuente de verdad visual (Nihon Planner)

**Esta carpeta es la source of truth (SoT) de identidad visual** para el producto y para el próximo cross a todo el sistema (`src/theme.js`, CSS, componentes, docs).

| Archivo | Rol |
|---|---|
| [`tokens.json`](./tokens.json) | Tokens DTCG v1.1 (primitivos + semánticos light/dark + type/space/radius/motion/layout) |
| [`tokens.css`](./tokens.css) | Variables CSS listas para consumir (`--np-*`, semánticos `--bg`/`--accent`, componentes `.np-*`) |
| [`brandbook.html`](./brandbook.html) | Brandbook vivo (swatches, tipografía, reglas) — abrir en browser |

Versión documentada en los archivos: **v1.1**.

## Cómo usarlo

1. **Diseño / handoff:** abrir `brandbook.html` o exportar desde `tokens.json`.
2. **Implementación app:** ya cruzado — `tokens.css` vía `src/index.css` + Tailwind `@theme`; bridge inline en `src/theme.js`.
3. **Agentes / PRs:** no inventar colores, tipografías ni radios fuera de estos tokens.

## Identidad en una mirada

| Eje | Criterio |
|-----|----------|
| Marca | Nihon Planner |
| Look | Papel / sumi; **hi-no-maru** como único acento fuerte |
| Tema | Light-first (`paper`); dark vía `html[data-theme="dark"]` o `prefers-color-scheme` |
| Accent | Rojo bandera (`--np-maru-*` → `--accent`), no verde neón kyz |
| Warn | Ámbar kohaku (`--np-kohaku-*`) |
| Type | Display **Space Grotesk**; body/mono **IBM Plex** |
| Ciudades | Osaka / Kyoto solo franjas decorativas, nunca texto |

## Consumo en la app

- `src/index.css` importa `tokens.css` + Tailwind `@theme` (utilidades `bg-bg`, `text-accent`, `font-display`, …).
- `src/theme.js` es el bridge de estilos inline (`C`/`S`) hacia esta SoT.
- Componentes `.np-*` del CSS de marca están disponibles globalmente.
- `docs/brand.md` es solo un índice; no redefine tokens.
