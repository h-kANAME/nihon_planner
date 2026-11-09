/**
 * Estilos de mapa (§8.6) y carga lazy de MapLibre (§8.7).
 * Sin import estático de maplibre-gl en el chunk de App.
 *
 * Recoloreo runtime: fetch del style JSON → override de background / water /
 * road leyendo --bg, --bg-sunken, --fg-muted, --border.
 * No se toca el layout de etiquetas symbol (coalesce latin/en/name intacto).
 *
 * M4-W5 budget — `npm run build` en Docker (vite gzip, 2026-11-09):
 *   - entry `index-*.js` ≈ 143.6 KB gzip (sin el body de MapLibre)
 *   - async `maplibre-gl-*.js` ≈ 304.2 KB gzip; CSS mapa ≈ 10.2 KB gzip
 *   - async `location-parse-*.js` ≈ 3.2 KB gzip
 * Criterio §8.7: MapLibre no entra en el chunk principal (Δ vendor ≈ 0;
 * glue DayMap/mapStyle << 10 KB gzip vs inlinear el vendor).
 */

const DEFAULT_LIGHT = "https://tiles.openfreemap.org/styles/positron";
const DEFAULT_DARK = "https://tiles.openfreemap.org/styles/dark";

/**
 * @param {"light"|"dark"|string} theme
 * @returns {string}
 */
export function getMapStyleUrl(theme) {
  const env = import.meta.env ?? {};
  const light = env.VITE_MAP_STYLE_LIGHT || DEFAULT_LIGHT;
  const dark = env.VITE_MAP_STYLE_DARK || DEFAULT_DARK;
  return theme === "dark" ? dark : light;
}

/**
 * Tokens de marca para mapa (documentElement o contenedor).
 * Nunca hardcodear hex de marca en el llamador.
 * @param {Element|null|undefined} el
 * @returns {{
 *   bg: string,
 *   bgSunken: string,
 *   fgMuted: string,
 *   border: string,
 *   accent: string,
 *   fg: string,
 *   warn: string,
 * }}
 */
export function readBrandMapColors(el) {
  const root =
    el ||
    (typeof document !== "undefined" ? document.documentElement : null);
  const cs =
    root && typeof getComputedStyle === "function"
      ? getComputedStyle(root)
      : null;
  const pick = (name, fallback) => {
    const v = cs?.getPropertyValue(name)?.trim();
    return v || fallback;
  };
  return {
    bg: pick("--bg", "Canvas"),
    bgSunken: pick("--bg-sunken", "Canvas"),
    fgMuted: pick("--fg-muted", "GrayText"),
    border: pick("--border", "GrayText"),
    accent: pick("--accent", "currentColor"),
    fg: pick("--fg", "currentColor"),
    warn: pick("--warn", "currentColor"),
  };
}

/**
 * @param {string} id
 * @param {string} type
 */
function isWaterPaintLayer(id, type) {
  if (type === "symbol" || type === "background") return false;
  if (id === "water" || id === "waterway") return true;
  return /^water(?!_name)/.test(id);
}

/**
 * Vías / carreteras (no labels symbol).
 * @param {string} id
 * @param {string} type
 */
function isRoadPaintLayer(id, type) {
  if (type === "symbol" || type === "background") return false;
  return /^(highway_|road_|tunnel_.*motorway|highway_motorway_bridge)/.test(id);
}

/**
 * Sobrescribe paint de fondo / agua / vías. Conserva glyphs, sprite, sources
 * y deja intactas las capas symbol (sin mutar layout de labels).
 *
 * @param {object} style Style JSON MapLibre
 * @param {ReturnType<typeof readBrandMapColors>} colors
 * @returns {object}
 */
export function recolorMapStyle(style, colors) {
  if (!style || !Array.isArray(style.layers)) return style;

  const layers = style.layers.map((layer) => {
    const { id, type, paint } = layer;
    if (!paint) return layer;

    if (type === "background" || id === "background") {
      return {
        ...layer,
        paint: { ...paint, "background-color": colors.bg },
      };
    }

    if (isWaterPaintLayer(id, type)) {
      const next = { ...paint };
      if ("fill-color" in next) next["fill-color"] = colors.bgSunken;
      if ("line-color" in next) next["line-color"] = colors.bgSunken;
      return { ...layer, paint: next };
    }

    if (isRoadPaintLayer(id, type)) {
      const next = { ...paint };
      const casing = /casing|subtle|path/i.test(id);
      const color = casing ? colors.border : colors.fgMuted;
      if ("fill-color" in next) next["fill-color"] = color;
      if ("line-color" in next) next["line-color"] = color;
      return { ...layer, paint: next };
    }

    return layer;
  });

  return { ...style, layers };
}

/**
 * Fetch del style por tema + recoloreo con tokens del DOM.
 * @param {"light"|"dark"|string} theme
 * @param {Element|null|undefined} colorEl
 * @returns {Promise<object>}
 */
export async function loadRecoloredMapStyle(theme, colorEl) {
  const url = getMapStyleUrl(theme);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`No se pudo cargar el estilo de mapa (${res.status})`);
  }
  const style = await res.json();
  return recolorMapStyle(style, readBrandMapColors(colorEl));
}

/** @type {Promise<typeof import("maplibre-gl")>|null} */
let mapLibrePromise = null;

/**
 * Carga dinámica de maplibre-gl + CSS (solo cuando se abre un mapa).
 * @returns {Promise<typeof import("maplibre-gl")>}
 */
export function loadMapLibre() {
  if (!mapLibrePromise) {
    mapLibrePromise = (async () => {
      const [mod] = await Promise.all([
        import("maplibre-gl"),
        typeof document !== "undefined"
          ? import("maplibre-gl/dist/maplibre-gl.css")
          : Promise.resolve(),
      ]);
      return mod;
    })();
  }
  return mapLibrePromise;
}
