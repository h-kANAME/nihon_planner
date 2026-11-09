import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLocationInput } from "../../shared/location-parse.mjs";
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

test("!3d!4d gana sobre @ en la misma URL", () => {
  const input =
    "https://www.google.com/maps/place/Foo/@35.71,139.79,17z/data=!3d35.7147651!4d139.7966553";
  const result = parseLocationInput(input);
  assert.equal(result.ok, true);
  assert.equal(result.precision, "place");
  assert.equal(result.lat, 35.7147651);
  assert.equal(result.lng, 139.7966553);
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
