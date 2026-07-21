import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreItineraryEffectiveness } from "../itinerary/effectiveness.mjs";

test("scoreItineraryEffectiveness high on complete hybrid import", () => {
  const days = Array.from({ length: 20 }, (_, i) => ({
    day_number: i + 1,
    title: i === 0 ? "Llegada NRT" : `Zona ${i + 1}`,
    base: "Tokyo",
    stay_label: "Hotel",
    hub: "Station",
    notes: "ok",
    stops: [
      { kind: "stop", name: `Parada A${i}`, detail: "", how_to_get: "", est_duration: "", notes: "" },
      { kind: "stop", name: `Parada B${i}`, detail: "", how_to_get: "", est_duration: "", notes: "" },
    ],
  }));
  const score = scoreItineraryEffectiveness(
    { title: "Japón", anchor_date: "2026-07-20", days },
    { expectedDays: 20, warnings: [], strategy: "hybrid" },
  );
  assert.ok(score.global >= 90, `expected >=90 got ${score.global}`);
  assert.equal(score.dimensions.coverage, 100);
  assert.equal(score.dimensions.anchor, 100);
});

test("score penaliza días genéricos y ancla null", () => {
  const score = scoreItineraryEffectiveness(
    {
      title: "x",
      anchor_date: null,
      days: [{ day_number: 1, title: "Día 1", stops: [{ name: "A" }] }],
    },
    { expectedDays: 2, warnings: ["días 1–2: refine sin JSON usable"], strategy: "hybrid" },
  );
  assert.ok(score.dimensions.coverage < 100);
  assert.equal(score.dimensions.anchor, 70);
  assert.ok(score.dimensions.titles < 50);
});
