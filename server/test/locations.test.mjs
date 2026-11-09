import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapsSearch,
  mapsDirections,
  stopDestinationQuery,
  stopDirectionsOrigin,
  mapsDirectionsForStop,
  mapsPinUrl,
  mapsSearchForStop,
  mapsSearchForStay,
  mapsDirectionsForStay,
  stayDestinationQuery,
  dayMapPopupLinks,
  effectiveLocation,
  buildDayMapModel,
  isLocationResolved,
  locationProgress,
  locationProgressTone,
  locationProgressPercent,
  formatLocationProgressLabel,
  formatGlobalLocationProgress,
  dayHasPendingLocations,
  locateCtaLabel,
  stayLodgingSearchQuery,
  resolveLocationBadge,
  locationPickerSearchQuery,
  stayLocationMode,
  buildStopLocationCoordsBody,
  buildStopLocationModeBody,
  buildStayLocationBody,
  buildStayLocationClearBody,
  pendingStopsForBatch,
  splitBatchLine,
  assignBatchLines,
  previewBatchLines,
  isBatchRowApplied,
  batchRowsToApply,
  batchAppliedEntryMatches,
} from "../../src/lib/locations.js";
import { parseLocationInput } from "../../shared/location-parse.mjs";

test("mapsSearch encodea query de texto", () => {
  const url = mapsSearch("Senso-ji, Asakusa, Japón");
  assert.equal(
    url,
    "https://www.google.com/maps/search/?api=1&query=Senso-ji%2C+Asakusa%2C+Jap%C3%B3n",
  );
});

test("mapsSearch deja la coma literal en un par lat,lng", () => {
  const pasted = "35.73296593827545, 139.71632486492385";
  const parsed = parseLocationInput(pasted);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.lat, 35.73296593827545);
  assert.equal(parsed.lng, 139.71632486492385);
  const url = mapsSearch(`${parsed.lat},${parsed.lng}`);
  assert.equal(
    url,
    "https://www.google.com/maps/search/?api=1&query=35.73296593827545,139.71632486492385",
  );
  assert.equal(url.includes("%2C"), false);
});

test("mapsDirections usa transit y texto origen/destino", () => {
  const url = mapsDirections({
    origin: "Ikebukuro, Tokyo",
    destination: "Senso-ji, Asakusa, Tokyo, Japón",
    travelmode: "transit",
  });
  assert.match(url, /^https:\/\/www\.google\.com\/maps\/dir\/\?/);
  const u = new URL(url);
  assert.equal(u.searchParams.get("api"), "1");
  assert.equal(u.searchParams.get("travelmode"), "transit");
  assert.equal(u.searchParams.get("origin"), "Ikebukuro, Tokyo");
  assert.equal(u.searchParams.get("destination"), "Senso-ji, Asakusa, Tokyo, Japón");
});

test("mapsDirections prefiere lat,lng cuando hay coordenadas", () => {
  const url = mapsDirections({
    origin: { lat: 35.7295, lng: 139.7109 },
    destination: { lat: 35.714765, lng: 139.796655 },
  });
  const u = new URL(url);
  assert.equal(u.searchParams.get("origin"), "35.7295,139.7109");
  assert.equal(u.searchParams.get("destination"), "35.714765,139.796655");
  assert.equal(u.searchParams.get("travelmode"), "transit");
});

test("stopDestinationQuery arma nombre, base y Japón", () => {
  assert.equal(
    stopDestinationQuery({ name: "Senso-ji" }, { base: "Tokyo", stay_label: "Hotel" }),
    "Senso-ji, Tokyo, Japón",
  );
  assert.equal(
    stopDestinationQuery({ name: "Fushimi Inari" }, { stay_label: "Kyoto Inn" }),
    "Fushimi Inari, Kyoto Inn, Japón",
  );
});

test("stopDirectionsOrigin: stay_label en la primera; nombre de la anterior después", () => {
  const day = { stay_label: "Hotel Ikebukuro", base: "Tokyo" };
  const stops = [{ name: "Salida hub" }, { name: "Senso-ji" }];
  assert.equal(stopDirectionsOrigin(stops, 0, day), "Hotel Ikebukuro");
  assert.equal(stopDirectionsOrigin(stops, 1, day), "Salida hub");
});

test("mapsDirectionsForStop sin coords usa texto y transit", () => {
  const day = { base: "Tokyo", stay_label: "Hotel Ikebukuro" };
  const stops = [
    { name: "Ikebukuro Station", location_mode: "pending" },
    { name: "Senso-ji", location_mode: "pending" },
  ];
  const url = mapsDirectionsForStop(stops[1], day, stops, 1);
  const u = new URL(url);
  assert.equal(u.searchParams.get("origin"), "Ikebukuro Station");
  assert.equal(u.searchParams.get("destination"), "Senso-ji, Tokyo, Japón");
  assert.equal(u.searchParams.get("travelmode"), "transit");
});

test("mapsSearchForStop prefiere la ficha guardada", () => {
  const saved =
    "https://www.google.com/maps/place/Hotel+Clio+Higashiguchi-ten/@35.7325993,139.7136101,17z/data=!3d35.732595!4d139.716185";
  const url = mapsSearchForStop(
    {
      name: "Hotel Clio Higashiguchi-ten",
      location_mode: "coords",
      lat: 35.732595,
      lng: 139.716185,
      maps_url: saved,
    },
    {},
  );
  assert.equal(url, saved);
});

test("mapsPinUrl usa el pin del lugar y no la cámara del enlace", () => {
  const url = mapsPinUrl("Hotel Clio Higashiguchi-ten", 35.732595, 139.716185);
  assert.equal(
    url,
    "https://www.google.com/maps/place/Hotel+Clio+Higashiguchi-ten/@35.732595,139.716185,17z/data=!3d35.732595!4d139.716185",
  );
  assert.equal(url.includes("139.7136101"), false);
});

test("mapsSearchForStop y coords en directions cuando existen", () => {
  const day = { base: "Tokyo", stay_label: "Hotel", stay_lat: 35.73, stay_lng: 139.71 };
  const stop = {
    name: "Senso-ji",
    location_mode: "coords",
    lat: 35.714765,
    lng: 139.796655,
  };
  assert.equal(
    mapsSearchForStop(stop, day),
    "https://www.google.com/maps/place/Senso-ji/@35.714765,139.796655,17z/data=!3d35.714765!4d139.796655",
  );

  const prev = { name: "Hotel", location_mode: "inherit_stay" };
  const stops = [prev, stop];
  const dir = new URL(mapsDirectionsForStop(stop, day, stops, 1));
  assert.equal(dir.searchParams.get("origin"), "35.73,139.71");
  assert.equal(dir.searchParams.get("destination"), "35.714765,139.796655");
});

test("mapsSearchForStay / mapsDirectionsForStay: coords vs texto (§8.2 / M4-W3)", () => {
  const withCoords = {
    base: "Tokyo",
    stay_label: "Hotel Ikebukuro",
    stay_lat: 35.73,
    stay_lng: 139.71,
  };
  assert.equal(
    mapsSearchForStay(withCoords),
    "https://www.google.com/maps/place/Hotel+Ikebukuro/@35.73,139.71,17z/data=!3d35.73!4d139.71",
  );

  const dirCoords = new URL(mapsDirectionsForStay(withCoords));
  assert.equal(dirCoords.searchParams.get("origin"), "Tokyo");
  assert.equal(dirCoords.searchParams.get("destination"), "35.73,139.71");
  assert.equal(dirCoords.searchParams.get("travelmode"), "transit");

  const textOnly = { base: "Kyoto", stay_label: "Ryokan Gion" };
  assert.equal(stayDestinationQuery(textOnly), "Ryokan Gion, Kyoto, Japón");
  const searchText = new URL(mapsSearchForStay(textOnly));
  assert.equal(searchText.searchParams.get("query"), "Ryokan Gion, Kyoto, Japón");
  const dirText = new URL(mapsDirectionsForStay(textOnly));
  assert.equal(dirText.searchParams.get("destination"), "Ryokan Gion, Kyoto, Japón");

  assert.equal(mapsDirectionsForStay({ base: "Tokyo" }), null);
});

test("dayMapPopupLinks: stop y stay con how_to_get / deep links", () => {
  const day = {
    base: "Tokyo",
    stay_label: "Hotel",
    stay_lat: 35.73,
    stay_lng: 139.71,
    stops: [
      {
        id: "s1",
        name: "Senso-ji",
        sort_order: 1,
        location_mode: "coords",
        lat: 35.714765,
        lng: 139.796655,
        how_to_get: "Metro Asakusa",
        est_duration: "1h",
      },
    ],
  };
  const stopPopup = dayMapPopupLinks(
    { kind: "stop", id: "s1", stop: day.stops[0], name: "Senso-ji" },
    day,
  );
  assert.equal(stopPopup.name, "Senso-ji");
  assert.equal(stopPopup.how_to_get, "Metro Asakusa");
  assert.equal(stopPopup.est_duration, "1h");
  assert.equal(
    stopPopup.searchUrl,
    mapsPinUrl("Senso-ji", 35.714765, 139.796655),
  );
  assert.equal(
    new URL(stopPopup.directionsUrl).searchParams.get("destination"),
    "35.714765,139.796655",
  );

  const stayPopup = dayMapPopupLinks({ kind: "stay", id: "stay", name: "Hotel" }, day);
  assert.equal(stayPopup.name, "Hotel");
  assert.equal(stayPopup.how_to_get, "");
  assert.ok(stayPopup.directionsUrl);
  assert.equal(stayPopup.searchUrl, mapsPinUrl("Hotel", 35.73, 139.71));

  const pendingDay = {
    base: "Tokyo",
    stay_label: "Hotel",
    stops: [{ id: "p1", name: "Pendiente", sort_order: 1, location_mode: "pending" }],
  };
  const pendingPopup = dayMapPopupLinks(
    { kind: "stop", id: "p1", stop: pendingDay.stops[0], name: "Pendiente" },
    pendingDay,
  );
  assert.equal(
    new URL(pendingPopup.searchUrl).searchParams.get("query"),
    "Pendiente, Tokyo, Japón",
  );
  assert.equal(
    new URL(pendingPopup.directionsUrl).searchParams.get("destination"),
    "Pendiente, Tokyo, Japón",
  );
});

test("effectiveLocation y locationProgress (§4.3 / §8.3)", () => {
  const day = {
    stay_lat: 35.7,
    stay_lng: 139.7,
    stops: [
      { location_mode: "coords", lat: 1, lng: 2 },
      { location_mode: "inherit_stay" },
      { location_mode: "not_applicable" },
      { location_mode: "pending" },
    ],
  };
  assert.deepEqual(effectiveLocation(day.stops[0], day), { lat: 1, lng: 2 });
  assert.deepEqual(effectiveLocation(day.stops[1], day), { lat: 35.7, lng: 139.7 });
  assert.equal(effectiveLocation(day.stops[3], day), null);
  assert.deepEqual(locationProgress(day), { total: 4, resolved: 3, pending: 1 });
  assert.equal(isLocationResolved(day.stops[2], day), true); // na = resuelta
  assert.equal(dayHasPendingLocations(day), true);
});

test("inherit_stay sin stay no cuenta como resuelta (§4.3)", () => {
  const day = {
    stay_lat: null,
    stay_lng: null,
    stops: [
      { location_mode: "inherit_stay" },
      { location_mode: "not_applicable" },
      { location_mode: "pending" },
    ],
  };
  assert.equal(isLocationResolved(day.stops[0], day), false);
  assert.equal(effectiveLocation(day.stops[0], day), null);
  assert.deepEqual(locationProgress(day), { total: 3, resolved: 1, pending: 2 });
});

test("buildDayMapModel: pending/na ausentes; numeración visual; stay distinto (§8.5)", () => {
  const day = {
    stay_label: "Hotel A",
    stay_lat: 35.7,
    stay_lng: 139.7,
    stops: [
      { id: "p1", name: "Pendiente", sort_order: 1, location_mode: "pending" },
      {
        id: "c1",
        name: "Senso-ji",
        sort_order: 2,
        location_mode: "coords",
        lat: 35.71,
        lng: 139.79,
      },
      { id: "na", name: "Traslado", sort_order: 3, location_mode: "not_applicable" },
      { id: "h1", name: "Hub", sort_order: 4, location_mode: "inherit_stay" },
      {
        id: "c2",
        name: "Skytree",
        sort_order: 5,
        location_mode: "coords",
        lat: 35.71,
        lng: 139.81,
      },
    ],
  };
  const model = buildDayMapModel(day);
  assert.equal(model.isEmpty, false);
  assert.equal(model.stopMarkers.length, 3);
  assert.deepEqual(
    model.stopMarkers.map((m) => ({ id: m.id, number: m.number, name: m.name })),
    [
      { id: "c1", number: 1, name: "Senso-ji" },
      { id: "h1", number: 2, name: "Hub" },
      { id: "c2", number: 3, name: "Skytree" },
    ],
  );
  assert.equal(model.stayMarker?.kind, "stay");
  assert.equal(model.stayMarker?.lat, 35.7);
  assert.equal(model.stayMarker?.name, "Hotel A");
  assert.deepEqual(model.lineCoordinates, [
    [139.79, 35.71],
    [139.7, 35.7],
    [139.81, 35.71],
  ]);
  assert.equal(model.boundsPoints.length, 4); // 3 stops + stay
  assert.equal(model.pendingStops.length, 1);
  assert.equal(model.pendingStops[0].id, "p1");
});

test("buildDayMapModel: sin puntos → empty; inherit sin stay no marca", () => {
  const day = {
    stay_lat: null,
    stay_lng: null,
    stops: [
      { id: "p", sort_order: 1, location_mode: "pending" },
      { id: "h", sort_order: 2, location_mode: "inherit_stay" },
      { id: "na", sort_order: 3, location_mode: "not_applicable" },
    ],
  };
  const model = buildDayMapModel(day);
  assert.equal(model.isEmpty, true);
  assert.equal(model.stopMarkers.length, 0);
  assert.equal(model.stayMarker, null);
  assert.deepEqual(model.lineCoordinates, []);
  assert.equal(model.pendingStops.length, 1);
});

test("buildDayMapModel respeta sort_order aunque lleguen desordenados", () => {
  const day = {
    stops: [
      { id: "b", name: "B", sort_order: 20, location_mode: "coords", lat: 2, lng: 2 },
      { id: "a", name: "A", sort_order: 10, location_mode: "coords", lat: 1, lng: 1 },
    ],
  };
  const model = buildDayMapModel(day);
  assert.deepEqual(
    model.stopMarkers.map((m) => m.id),
    ["a", "b"],
  );
  assert.deepEqual(model.lineCoordinates, [
    [1, 1],
    [2, 2],
  ]);
});

test("locationProgressTone y label del badge Plan (§8.3)", () => {
  assert.equal(locationProgressTone({ total: 8, resolved: 8, pending: 0 }), "accent");
  assert.equal(locationProgressTone({ total: 8, resolved: 6, pending: 2 }), "warn");
  assert.equal(locationProgressTone({ total: 8, resolved: 0, pending: 8 }), "muted");
  assert.equal(locationProgressTone({ total: 0, resolved: 0, pending: 0 }), "muted");
  assert.equal(formatLocationProgressLabel({ resolved: 6, total: 8 }), "6/8 ubicadas");
  assert.equal(locateCtaLabel(false, "stop"), "Ubicar");
  assert.equal(locateCtaLabel(true, "stop"), "Cambiar ubicación");
  assert.equal(locateCtaLabel(false, "stay"), "Marcar dónde dormís");
  assert.equal(locateCtaLabel(true, "stay"), "Cambiar dónde dormís");
});

test("stayLodgingSearchQuery busca alojamiento y no usa el pin", () => {
  assert.equal(
    stayLodgingSearchQuery({ stay_label: "Ikebukuro (check-in / base)", base: "" }),
    "alojamiento en Ikebukuro, Japón",
  );
  assert.equal(stayLodgingSearchQuery({ base: "Kyoto" }), "alojamiento en Kyoto, Japón");
  assert.equal(stayLodgingSearchQuery({}), "alojamiento en Japón");
});

test("locationProgressPercent y copy global Resumen (§8.3)", () => {
  assert.equal(locationProgressPercent({ total: 8, resolved: 4 }), 50);
  assert.equal(locationProgressPercent({ total: 8, resolved: 8 }), 100);
  assert.equal(locationProgressPercent({ total: 0, resolved: 0 }), 0);
  assert.equal(locationProgressPercent({ total: 3, resolved: 1 }), 33);
  assert.equal(formatGlobalLocationProgress({ total: 8, resolved: 4 }), "4/8 ubicadas (50%)");
  assert.equal(formatGlobalLocationProgress({ total: 0, resolved: 0 }), "0/0 ubicadas (0%)");
});

test("resolveLocationBadge mapea mode+precision a etiqueta y tone (§8.1)", () => {
  assert.deepEqual(resolveLocationBadge({ mode: "pending" }), {
    key: "pending",
    label: "Pendiente",
    tone: "muted",
  });
  assert.deepEqual(resolveLocationBadge({ mode: "coords", precision: "place" }), {
    key: "located",
    label: "Ubicada",
    tone: "accent",
  });
  assert.deepEqual(resolveLocationBadge({ mode: "coords", precision: "view" }), {
    key: "approximate",
    label: "Aproximada",
    tone: "warn",
  });
  assert.deepEqual(resolveLocationBadge({ mode: "coords" }), {
    key: "located",
    label: "Ubicada",
    tone: "accent",
  });
  assert.deepEqual(resolveLocationBadge({ mode: "inherit_stay", kind: "stop" }), {
    key: "inherited",
    label: "Heredada",
    tone: "muted",
  });
  assert.deepEqual(resolveLocationBadge({ mode: "not_applicable" }), {
    key: "not_applicable",
    label: "No aplica",
    tone: "muted",
  });
  assert.deepEqual(resolveLocationBadge({}), {
    key: "pending",
    label: "Pendiente",
    tone: "muted",
  });
  assert.deepEqual(resolveLocationBadge({ mode: "coords", precision: "view", kind: "stay" }), {
    key: "approximate",
    label: "Aproximada",
    tone: "warn",
  });
});

test("locationPickerSearchQuery arma nombre + base (§8.4.2)", () => {
  assert.equal(
    locationPickerSearchQuery({
      target: "stop",
      stop: { name: "Sensō-ji" },
      day: { base: "Asakusa", stay_label: "Hotel" },
    }),
    "Sensō-ji Asakusa",
  );
  assert.equal(
    locationPickerSearchQuery({
      target: "stay",
      day: { base: "Tokyo", stay_label: "APA Ikebukuro" },
    }),
    "APA Ikebukuro Tokyo",
  );
});

test("buildStopLocationCoordsBody solo version+mode+raw_input (nunca lat/lng)", () => {
  const body = buildStopLocationCoordsBody(3, "35.714765, 139.796655");
  assert.deepEqual(body, {
    version: 3,
    mode: "coords",
    raw_input: "35.714765, 139.796655",
  });
  assert.equal(Object.prototype.hasOwnProperty.call(body, "lat"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "lng"), false);
  assert.equal(Object.keys(body).sort().join(","), "mode,raw_input,version");
});

test("buildStayLocationBody / clear y modos secundarios de parada", () => {
  assert.deepEqual(buildStayLocationBody(2, "8Q7X+22"), {
    version: 2,
    raw_input: "8Q7X+22",
  });
  assert.deepEqual(buildStayLocationClearBody(4), { version: 4, clear: true });
  assert.deepEqual(buildStopLocationModeBody(1, "not_applicable"), {
    version: 1,
    mode: "not_applicable",
  });
  assert.deepEqual(buildStopLocationModeBody(1, "inherit_stay"), {
    version: 1,
    mode: "inherit_stay",
  });
  assert.equal(stayLocationMode({ stay_lat: 35.1, stay_lng: 139.2 }), "coords");
  assert.equal(stayLocationMode({}), "pending");
});

test("splitBatchLine: nombre<TAB>dato o solo dato (§8.4.6)", () => {
  assert.deepEqual(splitBatchLine(""), { empty: true });
  assert.deepEqual(splitBatchLine("   "), { empty: true });
  assert.deepEqual(splitBatchLine("35.1, 139.2"), {
    empty: false,
    name: null,
    raw_input: "35.1, 139.2",
  });
  assert.deepEqual(splitBatchLine("Sensō-ji\t35.714765, 139.796655"), {
    empty: false,
    name: "Sensō-ji",
    raw_input: "35.714765, 139.796655",
  });
  assert.deepEqual(splitBatchLine("\t35.1,139.2"), {
    empty: false,
    name: null,
    raw_input: "35.1,139.2",
  });
});

test("assignBatchLines aplica en orden a pending; ignora líneas vacías", () => {
  const pending = [
    { id: "a", name: "Uno", version: 1, location_mode: "pending" },
    { id: "b", name: "Dos", version: 2, location_mode: "pending" },
  ];
  const rows = assignBatchLines(
    "Uno\t35.1, 139.1\n\n35.2, 139.2\nextra\t35.3, 139.3",
    pending,
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].stop_id, "a");
  assert.equal(rows[0].raw_input, "35.1, 139.1");
  assert.equal(rows[0].nameHint, "Uno");
  assert.equal(rows[1].stop_id, "b");
  assert.equal(rows[1].raw_input, "35.2, 139.2");
  assert.equal(rows[1].version, 2);
  assert.equal(rows[2].stop_id, null);
  assert.equal(rows[2].raw_input, "35.3, 139.3");
});

test("pendingStopsForBatch solo location_mode pending", () => {
  const day = {
    stops: [
      { id: "1", location_mode: "pending" },
      { id: "2", location_mode: "coords" },
      { id: "3", location_mode: "inherit_stay" },
      { id: "4" },
    ],
  };
  assert.deepEqual(
    pendingStopsForBatch(day).map((s) => s.id),
    ["1", "4"],
  );
});

test("previewBatchLines parsea ok/error con el parser compartido", () => {
  const pending = [
    { id: "a", name: "A", version: 1, location_mode: "pending" },
    { id: "b", name: "B", version: 1, location_mode: "pending" },
  ];
  const rows = previewBatchLines(
    "35.714765, 139.796655\nno-es-ubicacion",
    pending,
    parseLocationInput,
  );
  assert.equal(rows[0].ok, true);
  assert.equal(rows[0].parsed.source, "decimal");
  assert.equal(rows[1].ok, false);
  assert.ok(rows[1].error);
});

test("batch resume omite por stop_id; applied guarda version enviada (§8.4.6)", () => {
  const applied = [{ stop_id: "a", version: 1 }];
  assert.equal(batchAppliedEntryMatches(applied[0], "a", 1), true);
  assert.equal(batchAppliedEntryMatches(applied[0], "a", 2), false);

  const rows = [
    { ok: true, stop_id: "a", version: 2, raw_input: "1,2" },
    { ok: true, stop_id: "b", version: 1, raw_input: "3,4" },
    { ok: false, stop_id: "c", version: 1, raw_input: "x" },
  ];
  assert.equal(isBatchRowApplied(rows[0], applied), true);
  assert.equal(isBatchRowApplied(rows[1], applied), false);
  const todo = batchRowsToApply(rows, applied);
  assert.deepEqual(
    todo.map((r) => r.stop_id),
    ["b"],
  );
});
