import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getMapStyleUrl,
  loadMapLibre,
  recolorMapStyle,
} from "../../src/lib/mapStyle.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("mapStyle (M4-W1/W5)", () => {
  it("getMapStyleUrl usa defaults OpenFreeMap por tema", () => {
    assert.equal(
      getMapStyleUrl("light"),
      "https://tiles.openfreemap.org/styles/positron",
    );
    assert.equal(
      getMapStyleUrl("dark"),
      "https://tiles.openfreemap.org/styles/dark",
    );
    assert.equal(
      getMapStyleUrl("unknown"),
      "https://tiles.openfreemap.org/styles/positron",
    );
  });

  it("package.json declara maplibre-gl", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.ok(pkg.dependencies?.["maplibre-gl"]);
  });

  it("App y main no importan maplibre-gl de forma estática", () => {
    for (const rel of ["src/main.jsx", "src/App.jsx"]) {
      const src = readFileSync(join(root, rel), "utf8");
      assert.equal(
        /import\s+.*['"]maplibre-gl['"]/.test(src),
        false,
        `${rel} no debe importar maplibre-gl estáticamente`,
      );
      assert.equal(
        /import\s+['"]maplibre-gl\//.test(src),
        false,
        `${rel} no debe importar CSS de maplibre estáticamente`,
      );
    }
  });

  it("loadMapLibre resuelve el módulo vía import dinámico", async () => {
    const mod = await loadMapLibre();
    assert.ok(mod?.Map || mod?.default?.Map);
  });

  it("M4-W5: recolorMapStyle pinta bg/agua/vías y no toca text-field", () => {
    const style = {
      version: 8,
      glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
      sprite: "https://tiles.openfreemap.org/sprites/ofm",
      sources: { openmaptiles: { type: "vector", url: "https://example/tiles" } },
      layers: [
        {
          id: "background",
          type: "background",
          paint: { "background-color": "#fff" },
        },
        {
          id: "water",
          type: "fill",
          paint: { "fill-color": "#00f" },
        },
        {
          id: "highway_major_inner",
          type: "line",
          paint: { "line-color": "#ccc" },
        },
        {
          id: "highway_major_casing",
          type: "line",
          paint: { "line-color": "#aaa" },
        },
        {
          id: "place_label",
          type: "symbol",
          layout: {
            "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
          },
          paint: { "text-color": "#111" },
        },
      ],
    };

    const colors = {
      bg: "token-bg",
      bgSunken: "token-sunken",
      fgMuted: "token-muted",
      border: "token-border",
      accent: "token-accent",
      fg: "token-fg",
      warn: "token-warn",
    };

    const out = recolorMapStyle(style, colors);
    assert.equal(out.glyphs, style.glyphs);
    assert.equal(out.sprite, style.sprite);
    assert.deepEqual(out.sources, style.sources);

    const byId = Object.fromEntries(out.layers.map((l) => [l.id, l]));
    assert.equal(byId.background.paint["background-color"], "token-bg");
    assert.equal(byId.water.paint["fill-color"], "token-sunken");
    assert.equal(byId.highway_major_inner.paint["line-color"], "token-muted");
    assert.equal(byId.highway_major_casing.paint["line-color"], "token-border");

    // Nunca override text-field (§8.6)
    assert.deepEqual(
      byId.place_label.layout["text-field"],
      style.layers[4].layout["text-field"],
    );
    assert.equal(byId.place_label.paint["text-color"], "#111");
    assert.equal(byId.highway_major_inner.paint["line-opacity"], undefined);
    assert.equal(/text-field/.test(JSON.stringify(out.layers.filter((l) => l.type !== "symbol"))), false);
  });

  it("dark: vías más tenues y labels --fg con halo --bg", () => {
    const style = {
      version: 8,
      layers: [
        { id: "background", type: "background", paint: { "background-color": "#000" } },
        { id: "water", type: "fill", paint: { "fill-color": "#000" } },
        { id: "highway_major_casing", type: "line", paint: { "line-color": "#000" } },
        { id: "road_area_pier", type: "fill", paint: { "fill-color": "#000" } },
        {
          id: "highway_major_inner",
          type: "line",
          paint: { "line-color": "#000", "line-opacity": 0.9 },
        },
        { id: "highway_path", type: "line", paint: { "line-color": "#000" } },
        { id: "highway_line_pattern", type: "line", paint: { "line-pattern": "dots" } },
        {
          id: "highway_expression_opacity",
          type: "line",
          paint: {
            "line-color": "#000",
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.2, 16, 0.9],
          },
        },
        {
          id: "place_label",
          type: "symbol",
          layout: { "text-field": ["get", "name"] },
          paint: { "text-color": "#111", "text-halo-width": 1 },
        },
        {
          id: "place_label_wide",
          type: "symbol",
          layout: { "text-field": ["get", "name"] },
          paint: { "text-color": "#111", "text-halo-width": 1.4 },
        },
        {
          id: "bare_label",
          type: "symbol",
          layout: { "text-field": ["get", "name"] },
        },
      ],
    };
    const colors = {
      bg: "token-bg",
      bgSunken: "token-sunken",
      fgMuted: "token-muted",
      border: "token-border",
      fg: "token-fg",
      accent: "token-accent",
      warn: "token-warn",
    };

    const out = recolorMapStyle(style, colors, { dark: true });
    const byId = Object.fromEntries(out.layers.map((l) => [l.id, l]));

    assert.equal(byId.background.paint["background-color"], "token-bg");
    assert.equal(byId.water.paint["fill-color"], "token-sunken");
    assert.equal(byId.highway_major_inner.paint["line-opacity"], 0.38);
    assert.equal(byId.highway_major_casing.paint["line-opacity"], 0.65);
    assert.equal(byId.highway_path.paint["line-opacity"], 0.28);
    assert.equal(byId.highway_line_pattern.paint["line-opacity"], 0.38);
    assert.deepEqual(
      byId.highway_expression_opacity.paint["line-opacity"],
      ["interpolate", ["linear"], ["zoom"], 10, 0.2, 16, 0.9],
    );
    assert.equal(byId.road_area_pier.paint["line-opacity"], undefined);
    assert.equal(byId.place_label.paint["text-color"], "token-fg");
    assert.equal(byId.place_label.paint["text-halo-color"], "token-bg");
    assert.equal(byId.place_label.paint["text-halo-width"], 1.2);
    assert.equal(byId.place_label_wide.paint["text-halo-width"], 1.4);
    assert.equal(byId.bare_label.paint["text-color"], "token-fg");
    assert.equal(byId.bare_label.paint["text-halo-width"], 1.2);
    assert.deepEqual(byId.place_label.layout["text-field"], ["get", "name"]);
  });

  it("M4-W5: mapStyle.js documenta budget gzip y exporta loadRecoloredMapStyle", () => {
    const src = readFileSync(join(root, "src/lib/mapStyle.js"), "utf8");
    assert.match(src, /loadRecoloredMapStyle/);
    assert.match(src, /recolorMapStyle/);
    assert.match(src, /readBrandMapColors/);
    assert.match(src, /getComputedStyle/);
    assert.match(src, /--bg/);
    assert.match(src, /--bg-sunken/);
    assert.match(src, /--fg-muted/);
    assert.match(src, /--border/);
    assert.match(src, /gzip|KB gzip/i);
    // No asigna layout de labels en el recoloreo
    assert.equal(/\[["']text-field["']\]\s*=/.test(src), false);
    assert.equal(/"text-field"\s*:/.test(src), false);
  });
});
