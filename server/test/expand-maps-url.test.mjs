import { test } from "node:test";
import assert from "node:assert/strict";
import { expandMapsShareUrl } from "../itinerary/expandMapsUrl.mjs";
import { isShortMapsUrl } from "../../shared/location-parse.mjs";

const PLACE =
  "https://www.google.com/maps/place/Hotel+Clio+Higashiguchi-ten/@35.7325993,139.7136101,17z/data=!3d35.732595!4d139.716185";

test("isShortMapsUrl reconoce el enlace de Compartir", () => {
  assert.equal(isShortMapsUrl("https://maps.app.goo.gl/sMqDEadjyb1XmMrS7"), true);
  assert.equal(isShortMapsUrl("https://www.google.com/maps?q=35.7,139.7"), false);
  assert.equal(isShortMapsUrl("35.732595, 139.716185"), false);
});

test("expandMapsShareUrl sigue solo redirecciones de Google Maps", async () => {
  const seen = [];
  const expanded = await expandMapsShareUrl("https://maps.app.goo.gl/sMqDEadjyb1XmMrS7", async (url) => {
    seen.push(String(url));
    return {
      status: 302,
      headers: { get: (name) => (String(name).toLowerCase() === "location" ? PLACE : null) },
    };
  });
  assert.deepEqual(seen, ["https://maps.app.goo.gl/sMqDEadjyb1XmMrS7"]);
  assert.equal(expanded, PLACE);

  const decimal = await expandMapsShareUrl("35.732595, 139.716185", async () => {
    throw new Error("no debía pedir la red");
  });
  assert.equal(decimal, "35.732595, 139.716185");
});

test("expandMapsShareUrl rechaza un destino que no es Maps", async () => {
  await assert.rejects(
    () =>
      expandMapsShareUrl("https://maps.app.goo.gl/sMqDEadjyb1XmMrS7", async () => ({
        status: 302,
        headers: { get: () => "https://example.com/phish" },
      })),
    /no apunta a Google Maps/,
  );
});
