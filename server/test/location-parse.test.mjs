import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mapsUrlFromRaw, parseLocationInput } from "../../shared/location-parse.mjs";
import { decode, encode, recoverNearest } from "../../shared/pluscode.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "locations.json"), "utf8"),
);

function assertApprox(actual, expected, eps = 0.001) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ~${expected}, got ${actual}`,
  );
}

for (const fx of fixtures) {
  test(`fixture ${fx.id}`, () => {
    const result = parseLocationInput(fx.input, {
      reference: fx.reference,
    });
    assert.equal(result.ok, fx.expect.ok);
    if (!fx.expect.ok) {
      assert.ok(result.error);
      return;
    }
    assert.equal(result.source, fx.expect.source);
    assert.equal(result.precision, fx.expect.precision);
    if (fx.expect.lat != null) assert.equal(result.lat, fx.expect.lat);
    if (fx.expect.lng != null) assert.equal(result.lng, fx.expect.lng);
    if (fx.expect.latApprox != null) assertApprox(result.lat, fx.expect.latApprox);
    if (fx.expect.lngApprox != null) assertApprox(result.lng, fx.expect.lngApprox);
    if (fx.expect.suggested_name != null) {
      assert.equal(result.suggested_name, fx.expect.suggested_name);
    }
    if (fx.expect.warningIncludes) {
      assert.ok(
        result.warnings.some((w) => w.includes(fx.expect.warningIncludes)),
      );
    }
    if (fx.expect.outsideJapanWarning) {
      assert.ok(
        result.warnings.some((w) => w.includes("Japón") || w.includes("Japon")),
      );
    }
  });
}

test("URL con @lat,lng no la captura la regla decimal", () => {
  const input = "https://www.google.com/maps/@35.7147651,139.7966553,17z";
  const result = parseLocationInput(input);
  assert.equal(result.ok, true);
  assert.equal(result.source, "url");
  assert.equal(result.precision, "view");
});

test("mapsUrlFromRaw conserva la ficha y descarta el tracking", () => {
  const raw =
    "https://www.google.com/maps/place/Hotel+Clio+Higashiguchi-ten/@35.7325993,139.7136101,17z/data=!4m9!3m8!1s0x60188d6687aea00f:0xde0815219a7206b9!5m2!4m1!1i2!8m2!3d35.732595!4d139.716185!16s%2Fg%2F1tfkw95s?entry=ttu&g_ep=abc&skid=session";
  assert.equal(
    mapsUrlFromRaw(raw),
    "https://www.google.com/maps/place/Hotel+Clio+Higashiguchi-ten/@35.7325993,139.7136101,17z/data=!4m9!3m8!1s0x60188d6687aea00f:0xde0815219a7206b9!5m2!4m1!1i2!8m2!3d35.732595!4d139.716185!16s%2Fg%2F1tfkw95s",
  );
  assert.equal(mapsUrlFromRaw("35.732595, 139.716185"), null);
});

test("!3d!4d gana sobre @ en la misma URL", () => {
  const input =
    "https://www.google.com/maps/place/Foo/@35.71,139.79,17z/data=!3d35.7147651!4d139.7966553";
  const result = parseLocationInput(input);
  assert.equal(result.ok, true);
  assert.equal(result.precision, "place");
  assert.equal(result.lat, 35.7147651);
  assert.equal(result.lng, 139.7966553);
});

test("pb con centro de vista y lugar usa el lugar (último !3d!4d)", () => {
  const input =
    "https://www.google.com/maps/place/NoEscape%E6%B1%A0%E8%A2%8B%E5%BA%97+%E3%83%AA%E3%82%A2%E3%83%AB%E4%BD%93%E9%A8%93%E8%84%B1%E5%87%BA%E3%82%B2%E3%83%BC%E3%83%A0/@35.732595,139.716185,17z/data=!4m12!1m5!3m4!2zMzXCsDQzJzU3LjMiTiAxMznCsDQyJzU4LjMiRQ!8m2!3d35.732595!4d139.716185!3m5!1s0x60188da846bd7b73:0x7f37802c1dd3bf2d!8m2!3d35.7352091!4d139.7156275!16s%2Fg%2F11h02c6t0r?entry=ttu";
  const result = parseLocationInput(input);
  assert.equal(result.ok, true);
  assert.equal(result.source, "url");
  assert.equal(result.precision, "place");
  assert.equal(result.lat, 35.7352091);
  assert.equal(result.lng, 139.7156275);
  assert.equal(result.suggested_name, "NoEscape池袋店 リアル体験脱出ゲーム");
});

test("prefiere el bloque de lugar aunque haya otro par después", () => {
  const input =
    "https://www.google.com/maps/place/Foo/@35.71,139.79,17z/data=!3m5!1s0xabc:0xdef!8m2!3d35.7352091!4d139.7156275!1m5!3m4!2zX!8m2!3d35.732595!4d139.716185";
  const result = parseLocationInput(input);
  assert.equal(result.ok, true);
  assert.equal(result.lat, 35.7352091);
  assert.equal(result.lng, 139.7156275);
});

test("ignora pares fuera de rango en URLs", () => {
  const input =
    "https://www.google.com/maps/place/Foo/data=!3d35.7!4d139.7!3d999!4d999";
  const result = parseLocationInput(input);
  assert.equal(result.ok, true);
  assert.equal(result.lat, 35.7);
  assert.equal(result.lng, 139.7);
});

test("URL con todos los pares fuera de rango → error", () => {
  const result = parseLocationInput(
    "https://www.google.com/maps/place/Foo/data=!3d999!4d999",
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /coordenadas reconocibles|fuera de rango/i);
});

test("query= con lat,lng → place", () => {
  const result = parseLocationInput(
    "https://www.google.com/maps?q=34.9948561,135.785088",
  );
  assert.equal(result.ok, true);
  assert.equal(result.source, "url");
  assert.equal(result.precision, "place");
  assert.equal(result.lat, 34.9948561);
  assert.equal(result.lng, 135.785088);
});

test("Plus corto sin reference → error", () => {
  const result = parseLocationInput("PQ7W+WM Taito City, Tokyo");
  assert.equal(result.ok, false);
  assert.match(result.error, /referencia|completo/i);
});

test("Plus corto lejos → SHORT_CODE_FAR", () => {
  const result = parseLocationInput("PQ7W+WM", {
    reference: { lat: 34.98, lng: 135.75 },
  });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.includes("SHORT_CODE_FAR"));
});

test("Plus global 8Q7XPQ7W+WM coincide con encode de Senso-ji", () => {
  const code = encode(35.7147651, 139.7966553);
  assert.equal(code, "8Q7XPQ7W+WM");
  const area = decode(code);
  assertApprox(area.latitudeCenter, 35.7148, 0.001);
  assertApprox(area.longitudeCenter, 139.7967, 0.001);
  assert.equal(recoverNearest("PQ7W+WM", 35.71, 139.79), code);
});

test("un solo número → error", () => {
  const result = parseLocationInput("35.7147651");
  assert.equal(result.ok, false);
});
