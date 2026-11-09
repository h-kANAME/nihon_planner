import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildDayMapModel,
  dayMapPopupLinks,
  locateCtaLabel,
} from "../lib/locations.js";
import {
  loadMapLibre,
  loadRecoloredMapStyle,
  readBrandMapColors,
} from "../lib/mapStyle.js";
import { C, S, fonts } from "../theme";

const LINE_SOURCE = "day-stops-line";
const LINE_LAYER = "day-stops-line-layer";
const FIT_PADDING = { top: 48, bottom: 56, left: 48, right: 48 };
const FIT_MAX_ZOOM = 15;

const mapLinkStyle = {
  ...S.secondary,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  textDecoration: "none",
  marginTop: 0,
  padding: "8px 12px",
  fontSize: 12,
  minHeight: 44,
  boxSizing: "border-box",
};

/**
 * @param {'stop'|'stay'} kind
 * @param {number|null} number
 * @param {ReturnType<typeof readBrandMapColors>} colors
 * @param {{ selected?: boolean, onClick: (ev: MouseEvent) => void }} opts
 */
function createMarkerElement(kind, number, colors, opts) {
  const { selected = false, onClick } = opts;
  const el = document.createElement("button");
  el.type = "button";
  el.className =
    kind === "stay"
      ? "np-daymap-marker np-daymap-marker--stay"
      : selected
        ? "np-daymap-marker np-daymap-marker--selected"
        : "np-daymap-marker";
  el.setAttribute("aria-label", kind === "stay" ? "Alojamiento" : `Parada ${number}`);
  el.setAttribute("aria-pressed", selected ? "true" : "false");
  // Números: IBM Plex Mono vía --font-mono (brand_app)
  el.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "justify-content:center",
    "box-sizing:border-box",
    "border:2px solid",
    "cursor:pointer",
    "padding:0",
    "line-height:1",
    "touch-action:manipulation",
    `font-family:var(--font-mono, ${fonts.mono})`,
    "font-size:11px",
    "font-weight:600",
    "font-variant-numeric:tabular-nums",
  ].join(";");

  if (kind === "stay") {
    // Alojamiento: token --warn
    el.style.width = "22px";
    el.style.height = "22px";
    el.style.borderRadius = "4px";
    el.style.background = colors.warn;
    el.style.borderColor = colors.bg;
    el.style.color = colors.bg;
    el.style.boxShadow = `0 0 0 1px ${colors.warn}`;
    el.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path fill="currentColor" d="M6 1.2 1.5 5.1V11h3.2V7.4h2.6V11H10.5V5.1L6 1.2z"/></svg>';
  } else if (selected) {
    // Seleccionado: token --accent
    el.style.width = "28px";
    el.style.height = "28px";
    el.style.borderRadius = "999px";
    el.style.background = colors.accent;
    el.style.borderColor = colors.bg;
    el.style.color = colors.bg;
    el.style.boxShadow = `0 0 0 1px ${colors.accent}`;
    el.textContent = String(number);
  } else {
    // Numeración: tokens --fg / --bg
    el.style.width = "28px";
    el.style.height = "28px";
    el.style.borderRadius = "999px";
    el.style.background = colors.bg;
    el.style.borderColor = colors.fg;
    el.style.color = colors.fg;
    el.style.boxShadow = `0 0 0 1px ${colors.border}`;
    el.textContent = String(number);
  }

  el.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    onClick(ev);
  });
  return el;
}

/**
 * @param {import('react').MutableRefObject<import('maplibre-gl').Marker[]>} markersRef
 */
function clearMarkers(markersRef) {
  for (const m of markersRef.current) {
    try {
      m.remove();
    } catch {
      /* ignore */
    }
  }
  markersRef.current = [];
}

/**
 * @param {import('react').MutableRefObject<import('maplibre-gl').Map|null>} mapRef
 * @param {import('react').MutableRefObject<import('maplibre-gl').Marker[]>} markersRef
 */
function teardownMap(mapRef, markersRef) {
  clearMarkers(markersRef);
  if (mapRef.current) {
    try {
      mapRef.current.remove();
    } catch {
      /* ignore */
    }
    mapRef.current = null;
  }
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {typeof import('maplibre-gl')} maplibregl
 * @param {ReturnType<typeof buildDayMapModel>} model
 * @param {HTMLElement|null} colorRoot
 * @param {import('react').MutableRefObject<Function|undefined>} onMarkerClickRef
 * @param {import('react').MutableRefObject<import('maplibre-gl').Marker[]>} markersRef
 * @param {{ kind: string, id: string }|null|undefined} selected
 * @param {{ fit?: boolean }} [opts]
 */
function paintDay(
  map,
  maplibregl,
  model,
  colorRoot,
  onMarkerClickRef,
  markersRef,
  selected,
  opts = {},
) {
  if (!map?.getStyle?.()) return;
  const fit = opts.fit !== false;

  clearMarkers(markersRef);

  const colors = readBrandMapColors(colorRoot || map.getContainer());

  if (map.getLayer(LINE_LAYER)) map.removeLayer(LINE_LAYER);
  if (map.getSource(LINE_SOURCE)) map.removeSource(LINE_SOURCE);

  if (model.lineCoordinates.length >= 2) {
    map.addSource(LINE_SOURCE, {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: model.lineCoordinates,
        },
      },
    });
    map.addLayer({
      id: LINE_LAYER,
      type: "line",
      source: LINE_SOURCE,
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": colors.fgMuted,
        "line-width": 2.5,
        "line-dasharray": [1.2, 1.8],
        "line-opacity": 0.85,
      },
    });
  }

  if (model.stayMarker) {
    const stay = model.stayMarker;
    const el = createMarkerElement("stay", null, colors, {
      selected: selected?.kind === "stay" && selected?.id === stay.id,
      onClick: () => {
        onMarkerClickRef.current?.({
          kind: "stay",
          id: stay.id,
          lat: stay.lat,
          lng: stay.lng,
          name: stay.name,
        });
      },
    });
    markersRef.current.push(
      new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([stay.lng, stay.lat])
        .addTo(map),
    );
  }

  for (const stop of model.stopMarkers) {
    const el = createMarkerElement("stop", stop.number, colors, {
      selected: selected?.kind === "stop" && selected?.id === stop.id,
      onClick: () => {
        onMarkerClickRef.current?.({
          kind: "stop",
          id: stop.id,
          number: stop.number,
          lat: stop.lat,
          lng: stop.lng,
          name: stop.name,
          stop: stop.stop,
        });
      },
    });
    markersRef.current.push(
      new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([stop.lng, stop.lat])
        .addTo(map),
    );
  }

  if (fit) {
    if (model.boundsPoints.length === 1) {
      map.jumpTo({
        center: [model.boundsPoints[0].lng, model.boundsPoints[0].lat],
        zoom: 13,
      });
    } else if (model.boundsPoints.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      for (const p of model.boundsPoints) bounds.extend([p.lng, p.lat]);
      map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM, duration: 0 });
    }
  }
}

/**
 * Mapa del día (§8.5). Única pieza que conoce MapLibre.
 * Popup HTML + deep links (M4-W3).
 *
 * @param {{
 *   day: object|null|undefined,
 *   theme?: 'light'|'dark'|string,
 *   onLocatePending?: () => void,
 *   onLocateStop?: (stop: object) => void,
 *   onLocateStay?: () => void,
 *   onMarkerClick?: (payload: {
 *     kind: 'stop'|'stay',
 *     id: string,
 *     number?: number,
 *     lat: number,
 *     lng: number,
 *     name: string,
 *     stop?: object,
 *   }) => void,
 *   className?: string,
 *   style?: object,
 *   height?: number|string,
 * }} props
 */
export function DayMap({
  day,
  theme = "light",
  onLocatePending,
  onLocateStop,
  onLocateStay,
  onMarkerClick,
  className,
  style,
  height = 320,
}) {
  const model = useMemo(() => buildDayMapModel(day), [day]);
  const containerRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const mapHostRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const mapRef = useRef(/** @type {import('maplibre-gl').Map|null} */ (null));
  const markersRef = useRef(/** @type {import('maplibre-gl').Marker[]} */ ([]));
  const maplibreglRef = useRef(/** @type {any} */ (null));
  const modelRef = useRef(model);
  modelRef.current = model;
  const onMarkerClickPropRef = useRef(onMarkerClick);
  onMarkerClickPropRef.current = onMarkerClick;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const [status, setStatus] = useState(() => (model.isEmpty ? "empty" : "loading"));
  const [loadError, setLoadError] = useState(/** @type {string|null} */ (null));
  const [selected, setSelected] = useState(
    /** @type {null | { kind: 'stop'|'stay', id: string, number?: number, lat: number, lng: number, name: string, stop?: object }} */ (
      null
    ),
  );

  const dayKey = day?.id ?? day?.day_number ?? null;
  useEffect(() => {
    setSelected(null);
  }, [dayKey]);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const onMarkerClickRef = useRef(/** @type {Function|undefined} */ (undefined));
  onMarkerClickRef.current = (payload) => {
    setSelected(payload);
    onMarkerClickPropRef.current?.(payload);
  };

  const popup = useMemo(() => dayMapPopupLinks(selected, day), [selected, day]);

  const colorRootEl = () =>
    containerRef.current ||
    (typeof document !== "undefined" ? document.documentElement : null);

  // Crear / destruir mapa al entrar/salir de empty (§8.6 fetch+recolor)
  useEffect(() => {
    if (model.isEmpty) {
      setStatus("empty");
      setLoadError(null);
      teardownMap(mapRef, markersRef);
      return undefined;
    }

    const host = mapHostRef.current;
    if (!host) return undefined;

    let cancelled = false;
    setStatus("loading");
    setLoadError(null);

    (async () => {
      try {
        const [mod, style] = await Promise.all([
          loadMapLibre(),
          loadRecoloredMapStyle(themeRef.current, colorRootEl()),
        ]);
        if (cancelled) return;
        const maplibregl = mod?.default?.Map ? mod.default : mod;
        maplibreglRef.current = maplibregl;

        teardownMap(mapRef, markersRef);

        const map = new maplibregl.Map({
          container: host,
          style,
          center: [
            modelRef.current.boundsPoints[0].lng,
            modelRef.current.boundsPoints[0].lat,
          ],
          zoom: 12,
          attributionControl: true,
        });
        mapRef.current = map;
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

        map.on("error", (e) => {
          if (cancelled) return;
          const errMsg = e?.error?.message || e?.message || "Error de tiles o estilo";
          setLoadError(errMsg);
          setStatus("offline");
        });

        map.once("load", () => {
          if (cancelled || !mapRef.current) return;
          setLoadError(null);
          setStatus("ready");
          paintDay(
            map,
            maplibregl,
            modelRef.current,
            containerRef.current,
            onMarkerClickRef,
            markersRef,
            selectedRef.current,
          );
        });
      } catch (e) {
        if (cancelled) return;
        setLoadError(e?.message || "No se pudo cargar MapLibre");
        setStatus("offline");
      }
    })();

    return () => {
      cancelled = true;
      teardownMap(mapRef, markersRef);
    };
  }, [model.isEmpty]);

  // Re-pintar overlays cuando cambian los puntos
  useEffect(() => {
    if (model.isEmpty) return;
    const map = mapRef.current;
    const maplibregl = maplibreglRef.current;
    if (!map || !maplibregl || status !== "ready") return;
    paintDay(
      map,
      maplibregl,
      model,
      containerRef.current,
      onMarkerClickRef,
      markersRef,
      selectedRef.current,
      { fit: true },
    );
  }, [model, status]);

  // Solo recolor de marcadores al cambiar selección (sin re-fit)
  useEffect(() => {
    if (model.isEmpty || status !== "ready") return;
    const map = mapRef.current;
    const maplibregl = maplibreglRef.current;
    if (!map || !maplibregl) return;
    paintDay(
      map,
      maplibregl,
      modelRef.current,
      containerRef.current,
      onMarkerClickRef,
      markersRef,
      selected,
      { fit: false },
    );
  }, [selected, model.isEmpty, status]);

  // Cambio de tema → fetch+recolor → setStyle + re-crear markers/trazo (§8.6)
  const appliedThemeRef = useRef(/** @type {string|null} */ (null));
  useEffect(() => {
    if (model.isEmpty) {
      appliedThemeRef.current = null;
      return undefined;
    }
    const map = mapRef.current;
    const maplibregl = maplibreglRef.current;
    if (!map || !maplibregl || status !== "ready") return undefined;
    if (appliedThemeRef.current === theme) return undefined;
    // Primer ready: el init ya cargó el estilo del theme actual
    if (appliedThemeRef.current == null) {
      appliedThemeRef.current = theme;
      return undefined;
    }
    appliedThemeRef.current = theme;

    let cancelled = false;
    (async () => {
      try {
        const style = await loadRecoloredMapStyle(theme, colorRootEl());
        if (cancelled || !mapRef.current) return;

        const onStyleLoad = () => {
          if (cancelled || !mapRef.current) return;
          paintDay(
            mapRef.current,
            maplibregl,
            modelRef.current,
            containerRef.current,
            onMarkerClickRef,
            markersRef,
            selectedRef.current,
          );
        };

        map.once("style.load", onStyleLoad);
        map.setStyle(style);
      } catch (e) {
        if (cancelled) return;
        setLoadError(e?.message || "No se pudo aplicar el tema del mapa");
        setStatus("offline");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [theme, model.isEmpty, status]);

  const showMap = !model.isEmpty && status !== "offline";
  const showOffline = !model.isEmpty && status === "offline";
  const showEmpty = model.isEmpty;
  const pendingStops = model.pendingStops;
  const pendingCount = pendingStops.length;

  return (
    <div
      ref={containerRef}
      className={className}
      data-day-map
      data-status={showEmpty ? "empty" : showOffline ? "offline" : status}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        ...style,
      }}
    >
      {showEmpty ? (
        <div
          role="status"
          style={{
            ...S.card,
            minHeight: typeof height === "number" ? height : undefined,
            height: typeof height === "string" ? height : undefined,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            justifyContent: "center",
            gap: 10,
          }}
        >
          <div style={{ ...S.label, marginBottom: 0 }}>Mapa del día</div>
          <p style={{ margin: 0, color: C.soft, fontSize: 14, lineHeight: 1.45 }}>
            Todavía no hay puntos ubicados para este día.
          </p>
          {typeof onLocatePending === "function" && (
            <button type="button" style={S.ghost} onClick={onLocatePending}>
              Ubicar pendientes →
            </button>
          )}
        </div>
      ) : (
        <>
          <div
            style={{
              position: "relative",
              height,
              borderRadius: "var(--radius-md, 10px)",
              overflow: "hidden",
              border: "1px solid var(--border)",
              background: "var(--bg-sunken, var(--bg))",
            }}
          >
            <div
              ref={mapHostRef}
              data-day-map-canvas
              style={{
                width: "100%",
                height: "100%",
                visibility: showMap ? "visible" : "hidden",
              }}
            />
            {status === "loading" && (
              <div
                role="status"
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "color-mix(in srgb, var(--bg) 80%, transparent)",
                  color: "var(--fg-muted)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                }}
              >
                Cargando mapa…
              </div>
            )}
            {showOffline && (
              <div
                role="alert"
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  justifyContent: "center",
                  gap: 8,
                  padding: 16,
                  background: "var(--bg)",
                  color: "var(--fg)",
                }}
              >
                <div style={S.label}>Mapa no disponible</div>
                <p style={{ margin: 0, color: "var(--fg-muted)", fontSize: 14, lineHeight: 1.45 }}>
                  No se pudieron cargar el estilo o los tiles. La lista del día sigue siendo la vía
                  principal.
                </p>
                {loadError ? (
                  <p
                    style={{
                      margin: 0,
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--fg-muted)",
                    }}
                  >
                    {loadError}
                  </p>
                ) : null}
              </div>
            )}

            {popup && selected && (
              <div
                data-day-map-popup
                role="dialog"
                aria-label={popup.name || "Detalle del marcador"}
                style={{
                  position: "absolute",
                  left: 12,
                  right: 12,
                  bottom: 12,
                  zIndex: 2,
                  padding: 12,
                  borderRadius: "var(--radius-md, 10px)",
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--fg)",
                  boxShadow: "var(--elevation-1, 0 4px 16px color-mix(in srgb, var(--fg) 12%, transparent))",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontFamily: "var(--font-display, inherit)",
                        fontSize: 15,
                        fontWeight: 600,
                        lineHeight: 1.3,
                      }}
                    >
                      {selected.kind === "stay"
                        ? popup.name
                        : selected.number != null
                          ? `${selected.number}. ${popup.name}`
                          : popup.name}
                    </div>
                    {popup.how_to_get ? (
                      <p
                        style={{
                          margin: "6px 0 0",
                          fontSize: 13,
                          color: "var(--fg-muted)",
                          lineHeight: 1.4,
                        }}
                      >
                        {popup.how_to_get}
                      </p>
                    ) : null}
                    {popup.est_duration ? (
                      <p
                        style={{
                          margin: "4px 0 0",
                          fontSize: 12,
                          fontFamily: "var(--font-mono)",
                          color: "var(--fg-muted)",
                        }}
                      >
                        {popup.est_duration}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    aria-label="Cerrar"
                    style={{ ...S.ghost, padding: 4, flexShrink: 0 }}
                    onClick={() => setSelected(null)}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  {popup.directionsUrl ? (
                    <a
                      href={popup.directionsUrl}
                      target="_blank"
                      rel="noopener"
                      style={mapLinkStyle}
                    >
                      Cómo llegar
                    </a>
                  ) : null}
                  {popup.searchUrl ? (
                    <a href={popup.searchUrl} target="_blank" rel="noopener" style={mapLinkStyle}>
                      Ver lugar
                    </a>
                  ) : null}
                  {selected.kind === "stay" && typeof onLocateStay === "function" ? (
                    <button type="button" style={mapLinkStyle} onClick={onLocateStay}>
                      {locateCtaLabel(true, "stay")}
                    </button>
                  ) : null}
                  {selected.kind === "stop" &&
                  selected.stop &&
                  typeof onLocateStop === "function" ? (
                    <button
                      type="button"
                      style={mapLinkStyle}
                      onClick={() => onLocateStop(selected.stop)}
                    >
                      {locateCtaLabel(true, "stop")}
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          {status === "ready" && (
            <p
              data-day-map-legend
              style={{
                margin: 0,
                fontSize: 12,
                color: "var(--fg-muted)",
                fontFamily: "var(--font-mono)",
              }}
            >
              Trazo esquemático entre paradas ubicadas — no es una ruta.
            </p>
          )}

          {pendingCount > 0 && (
            <div data-day-map-pending style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ ...S.label, marginBottom: 0 }}>
                {pendingCount} pendiente{pendingCount === 1 ? "" : "s"} de ubicar
              </div>
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {pendingStops.map((stop) => (
                  <li
                    key={String(stop.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "4px 0",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <span style={{ fontSize: 14, lineHeight: 1.35, minWidth: 0 }}>
                      {stop.name || "Sin nombre"}
                    </span>
                    {typeof onLocateStop === "function" ? (
                      <button
                        type="button"
                        style={{ ...S.ghost, flexShrink: 0, color: "var(--accent)" }}
                        onClick={() => onLocateStop(stop)}
                      >
                        {locateCtaLabel(false, "stop")} →
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {typeof onLocatePending === "function" && (
                <button
                  type="button"
                  style={{ ...S.ghost, alignSelf: "flex-start" }}
                  onClick={onLocatePending}
                >
                  Ubicar pendientes →
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default DayMap;
