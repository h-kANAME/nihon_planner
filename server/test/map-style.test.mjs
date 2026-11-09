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
    assert.equal(/text-field/.test(JSON.stringify(out.layers.filter((l) => l.type !== "symbol"))), false);
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
