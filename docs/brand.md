# Brand — índice

La **fuente de verdad** de identidad visual de Nihon Planner es:

**[`../brand_app/`](../brand_app/)**

| Archivo SoT | Contenido |
|---|---|
| [`brand_app/tokens.json`](../brand_app/tokens.json) | Tokens DTCG v1.1 |
| [`brand_app/tokens.css`](../brand_app/tokens.css) | Variables CSS + componentes `.np-*` |
| [`brand_app/brandbook.html`](../brand_app/brandbook.html) | Brandbook interactivo |
| [`brand_app/README.md`](../brand_app/README.md) | Cómo consumir la SoT |

No dupliques paletas ni tipografías en este archivo. Cualquier cambio de marca se hace en `brand_app/` y después se propaga al sistema.

---

## Runtime (cross aplicado)

| Capa | Estado |
|------|--------|
| `brand_app/tokens.css` | Importado en `src/index.css` |
| Tailwind CSS v4 | `@tailwindcss/vite` + `@theme` mapeado a vars brand |
| `src/theme.js` | Bridge inline (`C`/`S`) → semántica brand (hi-no-maru, paper/sumi, Space Grotesk / IBM Plex) |
| Tema default | **Light-first** |
| Layout | Desktop rail (≥900px) / mobile bottom bar — sin cambio de breakpoints brand (`--bp-mobile: 900px`) |

`docs/design-tokens.md` describe el sistema legacy kyz; preferí esta carpeta + `brand_app` para trabajo nuevo.
