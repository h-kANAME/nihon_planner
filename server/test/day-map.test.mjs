import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("DayMap (M4-W2/W3)", () => {
  it("existe DayMap.jsx y exporta el componente", () => {
    const path = join(root, "src/components/DayMap.jsx");
    assert.equal(existsSync(path), true);
    const src = readFileSync(path, "utf8");
    assert.match(src, /export function DayMap/);
    assert.match(src, /buildDayMapModel/);
    assert.match(src, /loadMapLibre/);
    assert.match(src, /onMarkerClick/);
    assert.match(src, /onLocatePending/);
    assert.match(src, /onLocateStop/);
    assert.match(src, /onLocateStay/);
    assert.match(src, /dayMapPopupLinks/);
  });

  it("DayMap es la única pieza que importa loadMapLibre / maplibre", () => {
    const dayMap = readFileSync(join(root, "src/components/DayMap.jsx"), "utf8");
    assert.match(dayMap, /from ["'].*mapStyle\.js["']/);

    for (const rel of [
      "src/main.jsx",
      "src/App.jsx",
      "src/components/LocationPicker.jsx",
      "src/components/LocationBadge.jsx",
    ]) {
      const src = readFileSync(join(root, rel), "utf8");
      assert.equal(
        /maplibre-gl|loadMapLibre|getMapStyleUrl/.test(src),
        false,
        `${rel} no debe conocer MapLibre`,
      );
    }
  });

  it("marcadores usan CSS vars de marca, sin hex hardcodeados de accent/warn", () => {
    const src = readFileSync(join(root, "src/components/DayMap.jsx"), "utf8");
    assert.match(src, /readBrandMapColors/);
    assert.match(src, /colors\.accent|--accent/);
    assert.match(src, /colors\.warn|--warn/);
    assert.match(src, /colors\.fg|--fg/);
    assert.match(src, /colors\.bg|--bg/);
    // hi-no-maru / warn brand hex no deben aparecer en DayMap
    assert.equal(/#BC002D/i.test(src), false);
    assert.equal(/#C97A2B/i.test(src), false);
    assert.equal(/text-field/.test(src), false);
  });

  it("incluye empty, offline, leyenda esquemática y fitBounds", () => {
    const src = readFileSync(join(root, "src/components/DayMap.jsx"), "utf8");
    assert.match(src, /Ubicar pendientes/);
    assert.match(src, /Mapa no disponible|offline/);
    assert.match(src, /no es una ruta/i);
    assert.match(src, /fitBounds/);
    assert.match(src, /LineString|line-dasharray/);
  });

  it("popup + deep links: Cómo llegar / Ver lugar con target=_blank y minHeight 44", () => {
    const src = readFileSync(join(root, "src/components/DayMap.jsx"), "utf8");
    assert.match(src, /data-day-map-popup/);
    assert.match(src, /Cómo llegar/);
    assert.match(src, /Ver lugar/);
    assert.match(src, /target=["']_blank["']/);
    assert.match(src, /rel=["']noopener["']/);
    assert.match(src, /minHeight:\s*44/);
    assert.match(src, /np-map-action/);
    assert.equal(src.includes("...S.secondary"), false);
    const css = readFileSync(join(root, "src/index.css"), "utf8");
    assert.match(css, /html\[data-theme="dark"\] \[data-day-map-popup\] \.np-map-action[\s\S]*color:\s*#fff/);
    assert.match(src, /data-day-map-pending/);
    assert.match(src, /how_to_get/);
    assert.match(src, /est_duration/);
  });

  it("M4-W4: App integra DayMap con Lista/Mapa y split ≥900px (useIsDesktop)", () => {
    const app = readFileSync(join(root, "src/App.jsx"), "utf8");
    const viewport = readFileSync(join(root, "src/lib/viewport.js"), "utf8");
    assert.match(app, /from ["']\.\/components\/DayMap\.jsx["']/);
    assert.match(app, /ListaMapaToggle/);
    assert.match(app, /data-day-pane-toggle/);
    assert.match(app, /data-day-pane-layout/);
    assert.match(app, /["']split["']/);
    assert.match(app, /ItineraryDayDetailModal/);
    assert.match(app, /ItineraryDaySheet/);
    assert.match(app, /onLocatePending/);
    assert.match(app, /theme=\{theme/);
    // App no conoce MapLibre (sigue aislado en DayMap)
    assert.equal(/maplibre-gl|loadMapLibre|getMapStyleUrl|loadRecoloredMapStyle/.test(app), false);
    // Breakpoint del rail / split = 900px
    assert.match(viewport, /min-width:\s*900px/);
    assert.match(viewport, /export function useIsDesktop/);
  });

  it("M4-W5: fetch+recolor al crear; tema → setStyle + style.load; markers tokens", () => {
    const src = readFileSync(join(root, "src/components/DayMap.jsx"), "utf8");
    assert.match(src, /loadRecoloredMapStyle/);
    assert.match(src, /readBrandMapColors/);
    assert.match(src, /setStyle/);
    assert.match(src, /style\.load/);
    assert.match(src, /colors\.accent|--accent/);
    assert.match(src, /colors\.warn|--warn/);
    assert.match(src, /--font-mono|IBM Plex Mono|fonts\.mono/);
    assert.match(src, /np-daymap-marker--selected|selected/);
    // No hardcode de marca ni override de labels
    assert.equal(/#BC002D/i.test(src), false);
    assert.equal(/text-field/.test(src), false);
  });
});
