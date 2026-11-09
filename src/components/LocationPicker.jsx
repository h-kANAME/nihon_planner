import { useCallback, useEffect, useRef, useState } from "react";
import { C, S } from "../theme";
import { useIsDesktop } from "../lib/viewport";
import { api } from "../lib/apiClient";
import {
  batchRowsToApply,
  buildStayLocationBody,
  buildStayLocationClearBody,
  buildStopLocationCoordsBody,
  buildStopLocationModeBody,
  isBatchRowApplied,
  locationPickerSearchQuery,
  mapsSearch,
  pendingStopsForBatch,
  previewBatchLines,
  stayLocationMode,
} from "../lib/locations";
import { LocationBadge } from "./LocationBadge.jsx";
import { useConfirmDialog } from "./ConfirmDialog.jsx";

const PARSE_DEBOUNCE_MS = 300;
const TARGET_BTN = {
  minHeight: 44,
  minWidth: 44,
  boxSizing: "border-box",
  touchAction: "manipulation",
};

/**
 * Validación de ubicación (§8.4): single + modo lote + conflicto 409.
 *
 * @param {{
 *   open: boolean,
 *   target: 'stop'|'stay',
 *   stop?: object|null,
 *   day: object,
 *   onClose: () => void,
 *   onSaved?: (updated: object) => void,
 * }} props
 */
export function LocationPicker({ open, target = "stop", stop = null, day, onClose, onSaved }) {
  const isDesktop = useIsDesktop();
  const [askConfirm, confirmNode] = useConfirmDialog();
  const textareaRef = useRef(null);

  const isStay = target === "stay";
  const isHub = !isStay && (stop?.kind === "hub_out" || stop?.kind === "hub_back");

  const initialMode = isStay
    ? stayLocationMode(day)
    : stop?.location_mode || "pending";
  const initialPrecision = isStay ? day?.stay_precision : stop?.location_precision;
  const initialLat = isStay ? day?.stay_lat : stop?.lat;
  const initialLng = isStay ? day?.stay_lng : stop?.lng;
  const initialVersion = isStay ? day?.version : stop?.version;
  const labelName = isStay
    ? day?.stay_label || "Alojamiento"
    : stop?.name || "Parada";

  const [pickerMode, setPickerMode] = useState(/** @type {'single'|'batch'} */ ("single"));
  const [rawInput, setRawInput] = useState("");
  const [batchText, setBatchText] = useState("");
  const [batchRows, setBatchRows] = useState([]);
  /** @type {[Array<{ stop_id: string, version: number }>, Function]} */
  const [batchApplied, setBatchApplied] = useState([]);
  /** Snapshot estable de pendientes al entrar a lote (no se achica tras cada PUT). */
  const [batchTargets, setBatchTargets] = useState([]);
  const [replacing, setReplacing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [parseFn, setParseFn] = useState(null);
  const [parseBusy, setParseBusy] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [version, setVersion] = useState(initialVersion ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [currentMode, setCurrentMode] = useState(initialMode);
  const [currentPrecision, setCurrentPrecision] = useState(initialPrecision);
  const [currentLat, setCurrentLat] = useState(initialLat);
  const [currentLng, setCurrentLng] = useState(initialLng);
  /** Versiones locales de paradas del día (lote actualiza tras cada PUT). */
  const [stopVersions, setStopVersions] = useState(() => {
    const m = {};
    for (const s of day?.stops || []) m[s.id] = Number(s.version ?? 1);
    return m;
  });

  // Reset + carga lazy del parser al abrir (§8.7).
  useEffect(() => {
    if (!open) return undefined;
    setPickerMode("single");
    setRawInput("");
    setBatchText("");
    setBatchRows([]);
    setBatchApplied([]);
    setBatchTargets(pendingStopsForBatch(day));
    setReplacing(false);
    setHelpOpen(false);
    setParsed(null);
    setError(null);
    setBusy(false);
    setVersion(initialVersion ?? 1);
    setCurrentMode(initialMode);
    setCurrentPrecision(initialPrecision);
    setCurrentLat(initialLat);
    setCurrentLng(initialLng);
    const vers = {};
    for (const s of day?.stops || []) vers[s.id] = Number(s.version ?? 1);
    setStopVersions(vers);

    let cancelled = false;
    setParseBusy(true);
    import("../../shared/location-parse.mjs")
      .then((mod) => {
        if (cancelled) return;
        setParseFn(() => mod.parseLocationInput);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || "No se pudo cargar el parser");
      })
      .finally(() => {
        if (!cancelled) setParseBusy(false);
      });

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
    // Solo al abrir / cambiar target+id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target, stop?.id, day?.id]);

  const stayReference =
    day?.stay_lat != null && day?.stay_lng != null
      ? { lat: Number(day.stay_lat), lng: Number(day.stay_lng) }
      : undefined;

  // Parseo en vivo single debounce 300 ms, sin red.
  useEffect(() => {
    if (!open || !parseFn || pickerMode !== "single") return undefined;
    const trimmed = rawInput.trim();
    if (!trimmed) {
      setParsed(null);
      return undefined;
    }
    const t = setTimeout(() => {
      try {
        setParsed(parseFn(trimmed, stayReference ? { reference: stayReference } : undefined));
      } catch (e) {
        setParsed({ ok: false, error: e?.message || "Error al parsear", warnings: [] });
      }
    }, PARSE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [rawInput, parseFn, open, pickerMode, stayReference?.lat, stayReference?.lng]);

  // Al pasar a lote, congelar pendientes del día (orden de aplicación).
  useEffect(() => {
    if (!open || pickerMode !== "batch") return;
    if (batchTargets.length === 0) {
      setBatchTargets(pendingStopsForBatch(day));
    }
  }, [open, pickerMode, day, batchTargets.length]);

  // Preview lote debounce.
  useEffect(() => {
    if (!open || !parseFn || pickerMode !== "batch") return undefined;
    const t = setTimeout(() => {
      const pending = batchTargets.map((s) => ({
        ...s,
        version: stopVersions[s.id] ?? s.version ?? 1,
      }));
      setBatchRows(previewBatchLines(batchText, pending, parseFn, stayReference));
    }, PARSE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [batchText, parseFn, open, pickerMode, batchTargets, stopVersions, stayReference?.lat, stayReference?.lng]);

  const hasCoords =
    currentMode === "coords" && currentLat != null && currentLng != null;
  const showPaste = pickerMode === "batch" || !hasCoords || replacing;
  const canConfirmSingle = !!(parsed && parsed.ok && !busy && showPaste && pickerMode === "single");
  const okBatchCount = batchRows.filter((r) => r.ok).length;
  const pendingApplyCount = batchRowsToApply(batchRows, batchApplied).length;
  const canConfirmBatch =
    pickerMode === "batch" && !busy && okBatchCount > 0 && pendingApplyCount > 0;

  const searchUrl = mapsSearch(locationPickerSearchQuery({ target, stop, day }));
  const verifyUrl =
    parsed?.ok && parsed.lat != null && parsed.lng != null
      ? mapsSearch(`${parsed.lat},${parsed.lng}`)
      : null;
  const currentMapsUrl =
    hasCoords ? mapsSearch(`${currentLat},${currentLng}`) : null;

  const pasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (typeof text !== "string") return;
      if (pickerMode === "batch") {
        setBatchText(text);
      } else {
        setRawInput(text);
        setReplacing(true);
      }
      textareaRef.current?.focus();
    } catch {
      setError("No se pudo leer el portapapeles. Pegá manualmente (Ctrl+V).");
    }
  }, [pickerMode]);

  const applyCurrentFromConflict = (current) => {
    if (isStay) {
      setVersion(current.version ?? version);
      setCurrentLat(current.stay_lat);
      setCurrentLng(current.stay_lng);
      setCurrentPrecision(current.stay_precision);
      setCurrentMode(
        current.stay_lat != null && current.stay_lng != null ? "coords" : "pending",
      );
    } else {
      setVersion(current.version ?? version);
      setCurrentMode(current.location_mode || "pending");
      setCurrentPrecision(current.location_precision);
      setCurrentLat(current.lat);
      setCurrentLng(current.lng);
      if (current.id != null && current.version != null) {
        setStopVersions((prev) => ({ ...prev, [current.id]: Number(current.version) }));
      }
    }
    setReplacing(false);
  };

  const handleConflict = async (err) => {
    const current = err?.data?.error?.current;
    const isConflict =
      err?.status === 409 &&
      (err?.code === "VERSION_CONFLICT" || err?.data?.error?.code === "VERSION_CONFLICT");
    if (!isConflict || !current) throw err;
    const replace = await askConfirm({
      title: "Conflicto de versión",
      message:
        err?.data?.error?.message ||
        "Otra persona actualizó esta ubicación. ¿Querés reemplazar con la tuya?",
      confirmLabel: "Reemplazar con la mía",
      cancelLabel: "Ver la actual",
    });
    if (!replace) {
      applyCurrentFromConflict(current);
      return { action: "view", current };
    }
    return { action: "replace", current };
  };

  const runSave = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      let ver = version;
      let result;
      try {
        result = await fn(ver);
      } catch (err) {
        const decision = await handleConflict(err);
        if (decision.action === "view") return;
        ver = decision.current.version;
        setVersion(ver);
        result = await fn(ver);
      }
      onSaved?.(result);
      onClose?.();
    } catch (e) {
      setError(e?.message || "No se pudo guardar la ubicación");
    } finally {
      setBusy(false);
    }
  };

  const confirmCoords = () => {
    if (!canConfirmSingle) return;
    const raw = rawInput;
    if (isStay) {
      return runSave((ver) => api.putStayLocation(day.id, buildStayLocationBody(ver, raw)));
    }
    return runSave((ver) =>
      api.putStopLocation(stop.id, buildStopLocationCoordsBody(ver, raw)),
    );
  };

  const setStopMode = (mode) => {
    if (isStay) return;
    return runSave((ver) =>
      api.putStopLocation(stop.id, buildStopLocationModeBody(ver, mode)),
    );
  };

  const clearStay = () => {
    if (!isStay) return;
    return runSave((ver) => api.putStayLocation(day.id, buildStayLocationClearBody(ver)));
  };

  /**
   * PUT secuencial del lote. Omite filas ya aplicadas (stop_id + version enviada).
   * Al primer 409 se detiene; Replace reintenta esa fila con version de `current`
   * y continúa omitiendo las ya aplicadas.
   */
  const runBatchSave = async () => {
    if (pickerMode !== "batch" || busy || !parseFn) return;
    setBusy(true);
    setError(null);
    try {
      let workingVersions = { ...stopVersions };
      let applied = [...batchApplied];

      const refreshRows = () => {
        const pending = batchTargets.map((s) => ({
          ...s,
          version: workingVersions[s.id] ?? s.version ?? 1,
        }));
        return previewBatchLines(batchText, pending, parseFn, stayReference).map((r) => ({
          ...r,
          version:
            r.stop_id != null
              ? Number(workingVersions[r.stop_id] ?? r.version ?? 1)
              : r.version,
        }));
      };

      let rows = refreshRows();
      setBatchRows(rows);

      const markApplied = (stopId, verSent) => {
        applied = [...applied, { stop_id: String(stopId), version: Number(verSent) }];
        setBatchApplied(applied);
      };

      let guard = 0;
      while (guard < 500) {
        guard += 1;
        const todo = batchRowsToApply(rows, applied);
        if (todo.length === 0) break;
        const row = todo[0];
        let ver = Number(workingVersions[row.stop_id] ?? row.version ?? 1);

        try {
          const updated = await api.putStopLocation(
            row.stop_id,
            buildStopLocationCoordsBody(ver, row.raw_input),
          );
          markApplied(row.stop_id, ver);
          workingVersions = {
            ...workingVersions,
            [row.stop_id]: Number(updated?.version ?? ver + 1),
          };
          setStopVersions(workingVersions);
          onSaved?.(updated);
          rows = refreshRows();
          setBatchRows(rows);
        } catch (err) {
          const isConflict =
            err?.status === 409 &&
            (err?.code === "VERSION_CONFLICT" ||
              err?.data?.error?.code === "VERSION_CONFLICT");
          if (!isConflict) throw err;

          const decision = await handleConflict(err);
          if (decision.action === "view") {
            setStopVersions(workingVersions);
            return;
          }

          ver = Number(decision.current.version);
          workingVersions = { ...workingVersions, [row.stop_id]: ver };
          setStopVersions(workingVersions);
          rows = refreshRows();
          setBatchRows(rows);

          const updated = await api.putStopLocation(
            row.stop_id,
            buildStopLocationCoordsBody(ver, row.raw_input),
          );
          markApplied(row.stop_id, ver);
          workingVersions = {
            ...workingVersions,
            [row.stop_id]: Number(updated?.version ?? ver + 1),
          };
          setStopVersions(workingVersions);
          onSaved?.(updated);
          rows = refreshRows();
          setBatchRows(rows);
        }
      }

      onClose?.();
    } catch (e) {
      setError(e?.message || "No se pudo guardar el lote");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const btnSecondary = { ...S.secondary, ...TARGET_BTN, marginTop: 0 };
  const btnPrimary = { ...S.primary, ...TARGET_BTN, marginTop: 0, width: "auto", flex: 1.4 };
  const btnGhost = { ...S.ghost, ...TARGET_BTN };
  const tabBtn = (active) => ({
    ...btnSecondary,
    flex: 1,
    fontWeight: active ? 700 : 500,
    borderColor: active ? "var(--accent)" : C.outlineVariant,
    background: active ? "var(--accent-soft)" : C.surfaceContainerHigh,
    color: active ? "var(--accent-text)" : C.onSurface,
  });

  const appliedCount = batchApplied.length;

  return (
    <>
      <div
        role="presentation"
        onClick={() => !busy && onClose?.()}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 70,
          background: "rgba(0,0,0,0.55)",
          display: "flex",
          alignItems: isDesktop ? "center" : "flex-end",
          justifyContent: "center",
          ...(isDesktop ? { padding: 24 } : {}),
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={
            pickerMode === "batch"
              ? "Ubicar paradas en lote"
              : isStay
                ? "Ubicar alojamiento"
                : `Ubicar ${labelName}`
          }
          data-location-picker={target}
          data-picker-mode={pickerMode}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "100%",
            maxWidth: isDesktop ? "min(100%, 520px)" : 520,
            maxHeight: "90vh",
            display: "flex",
            flexDirection: "column",
            background: C.surfaceContainer,
            borderRadius: isDesktop ? 16 : "16px 16px 0 0",
            boxShadow: C.elevation2,
            paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "14px 16px",
              borderBottom: `1px solid ${C.outlineVariant}`,
              gap: 8,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: C.onSurface }}>
                {pickerMode === "batch"
                  ? "Ubicar en lote"
                  : isStay
                    ? "Ubicación del alojamiento"
                    : "Ubicar parada"}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: C.onSurfaceVariant,
                  marginTop: 2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {pickerMode === "batch"
                  ? `${batchTargets.length} pendiente${batchTargets.length === 1 ? "" : "s"} · Día ${day?.day_number ?? ""}`
                  : labelName}
              </div>
            </div>
            <button type="button" style={btnGhost} disabled={busy} onClick={onClose} aria-label="Cerrar">
              ✕
            </button>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "14px 16px",
              WebkitOverflowScrolling: "touch",
            }}
          >
            {!isStay && (
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }} role="tablist" aria-label="Modo">
                <button
                  type="button"
                  role="tab"
                  aria-selected={pickerMode === "single"}
                  style={tabBtn(pickerMode === "single")}
                  disabled={busy}
                  onClick={() => setPickerMode("single")}
                >
                  Una
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={pickerMode === "batch"}
                  style={tabBtn(pickerMode === "batch")}
                  disabled={busy}
                  onClick={() => {
                    setBatchApplied([]);
                    setBatchTargets(pendingStopsForBatch(day));
                    setPickerMode("batch");
                  }}
                >
                  Lote
                </button>
              </div>
            )}

            {pickerMode === "single" && (
              <>
                {/* 1. Estado actual */}
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <LocationBadge
                    mode={currentMode}
                    precision={currentPrecision}
                    kind={isStay ? "stay" : "stop"}
                  />
                  {hasCoords && (
                    <span style={{ fontSize: 12, color: C.onSurfaceVariant, fontFamily: "var(--font-mono)" }}>
                      {Number(currentLat).toFixed(6)}, {Number(currentLng).toFixed(6)}
                      {currentPrecision === "view" ? " · aprox." : ""}
                    </span>
                  )}
                </div>

                {hasCoords && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                    {currentMapsUrl && (
                      <a
                        href={currentMapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ ...btnSecondary, textDecoration: "none", display: "inline-flex", alignItems: "center" }}
                      >
                        Ver en Google Maps
                      </a>
                    )}
                    <button
                      type="button"
                      style={btnSecondary}
                      disabled={busy}
                      onClick={() => {
                        setReplacing(true);
                        setTimeout(() => textareaRef.current?.focus(), 0);
                      }}
                    >
                      Reemplazar
                    </button>
                  </div>
                )}

                {/* 2. Buscar */}
                <a
                  href={searchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    ...btnSecondary,
                    display: "inline-flex",
                    alignItems: "center",
                    textDecoration: "none",
                    marginBottom: 14,
                    width: "100%",
                    justifyContent: "center",
                  }}
                >
                  Buscar en Google Maps
                </a>
              </>
            )}

            {pickerMode === "batch" && (
              <div style={{ fontSize: 13, color: C.onSurfaceVariant, marginBottom: 10, lineHeight: 1.45 }}>
                Una línea por parada pendiente: <code style={{ fontFamily: "var(--font-mono)" }}>nombre⇥dato</code> o solo el dato.
                Se aplican en orden.
                {appliedCount > 0 && (
                  <span style={{ display: "block", marginTop: 4, color: "var(--accent-text)" }}>
                    {appliedCount} ya aplicada{appliedCount === 1 ? "" : "s"} (se omiten al reintentar).
                  </span>
                )}
              </div>
            )}

            {/* 3–4. Pegar + parseo */}
            {showPaste && (
              <>
                <div style={{ fontSize: 11, color: C.onSurfaceVariant, marginBottom: 4 }}>
                  {pickerMode === "batch" ? "Pegar lote" : "Pegar ubicación"}
                </div>
                <textarea
                  ref={textareaRef}
                  aria-label={pickerMode === "batch" ? "Pegar lote" : "Pegar ubicación"}
                  value={pickerMode === "batch" ? batchText : rawInput}
                  disabled={busy || parseBusy}
                  onChange={(e) =>
                    pickerMode === "batch" ? setBatchText(e.target.value) : setRawInput(e.target.value)
                  }
                  placeholder={
                    pickerMode === "batch"
                      ? "Sensō-ji\t35.714765, 139.796655\n35.6586, 139.7454"
                      : "35.714765, 139.796655 · URL de Maps · Plus Code"
                  }
                  rows={pickerMode === "batch" ? 6 : 3}
                  style={{
                    ...S.input,
                    minHeight: pickerMode === "batch" ? 140 : 88,
                    resize: "vertical",
                    marginBottom: 8,
                    fontFamily: "var(--font-mono)",
                    fontSize: 13,
                  }}
                />
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <button type="button" style={{ ...btnSecondary, flex: 1 }} disabled={busy} onClick={pasteFromClipboard}>
                    Pegar
                  </button>
                  <button
                    type="button"
                    style={{ ...btnSecondary, flex: 1 }}
                    disabled={busy}
                    aria-expanded={helpOpen}
                    onClick={() => setHelpOpen((v) => !v)}
                  >
                    {helpOpen ? "Ocultar ayuda" : "Cómo copiar"}
                  </button>
                </div>
                {helpOpen && (
                  <div
                    style={{
                      fontSize: 13,
                      color: C.onSurfaceVariant,
                      lineHeight: 1.5,
                      background: C.surfaceContainerHigh,
                      borderRadius: 8,
                      padding: "10px 12px",
                      marginBottom: 12,
                    }}
                  >
                    <div style={{ fontWeight: 600, color: C.onSurface, marginBottom: 4 }}>Escritorio</div>
                    Click derecho sobre el punto en Google Maps → «Copiar coordenadas» (o copiá la URL completa).
                    <div style={{ fontWeight: 600, color: C.onSurface, margin: "10px 0 4px" }}>Celular</div>
                    Mantené presionado el punto → tocá las coordenadas que aparecen (o compartí / copiá el enlace expandido).
                    {pickerMode === "batch" && (
                      <>
                        <div style={{ fontWeight: 600, color: C.onSurface, margin: "10px 0 4px" }}>Lote</div>
                        Pegá varias líneas. Con tab: nombre opcional + dato. Sin tab: solo el dato, en orden de pendientes.
                      </>
                    )}
                  </div>
                )}

                {parseBusy && (
                  <div style={{ fontSize: 12, color: C.onSurfaceVariant, marginBottom: 8 }}>
                    Cargando parser…
                  </div>
                )}

                {pickerMode === "single" && parsed && (
                  <ParsePreview parsed={parsed} verifyUrl={verifyUrl} />
                )}

                {pickerMode === "batch" && batchRows.length > 0 && (
                  <ul
                    data-batch-preview="1"
                    style={{
                      listStyle: "none",
                      margin: "0 0 12px",
                      padding: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {batchRows.map((row) => {
                      const applied = isBatchRowApplied(row, batchApplied);
                      return (
                        <li
                          key={`${row.lineIndex}-${row.stop_id || "x"}`}
                          data-batch-ok={row.ok ? "1" : "0"}
                          data-batch-applied={applied ? "1" : "0"}
                          style={{
                            fontSize: 13,
                            lineHeight: 1.4,
                            padding: "8px 10px",
                            borderRadius: 8,
                            background: applied
                              ? "var(--accent-soft)"
                              : row.ok
                                ? C.surfaceContainerHigh
                                : C.surfaceContainerHigh,
                            border: `1px solid ${
                              applied
                                ? "color-mix(in srgb, var(--accent) 35%, var(--border))"
                                : row.ok
                                  ? C.outlineVariant
                                  : "color-mix(in srgb, var(--warn) 45%, var(--border))"
                            }`,
                            color: C.onSurface,
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ fontWeight: 600 }}>
                              {row.stop?.name || row.nameHint || `Línea ${row.lineIndex + 1}`}
                            </span>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                color: applied
                                  ? "var(--accent-text)"
                                  : row.ok
                                    ? "var(--accent-text)"
                                    : "var(--warn-text)",
                              }}
                            >
                              {applied ? "Aplicada" : row.ok ? "OK" : "Error"}
                            </span>
                          </div>
                          {row.ok && row.parsed && (
                            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: C.onSurfaceVariant, marginTop: 2 }}>
                              {Number(row.parsed.lat).toFixed(5)}, {Number(row.parsed.lng).toFixed(5)}
                              {row.parsed.precision === "view" ? " · aprox." : ""}
                              {row.nameHint && row.stop?.name ? ` · ${row.nameHint}` : ""}
                            </div>
                          )}
                          {!row.ok && (
                            <div style={{ fontSize: 12, color: C.onSurfaceVariant, marginTop: 2 }}>
                              {row.error}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}

            {error && (
              <div style={{ fontSize: 13, color: C.error || C.primary, marginBottom: 10 }}>{error}</div>
            )}

            {/* 7. Acciones secundarias (solo single) */}
            {pickerMode === "single" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                {!isStay && (
                  <>
                    <button
                      type="button"
                      style={btnSecondary}
                      disabled={busy}
                      onClick={() => setStopMode("not_applicable")}
                    >
                      No requiere ubicación
                    </button>
                    {isHub && (
                      <button
                        type="button"
                        style={btnSecondary}
                        disabled={busy}
                        onClick={() => setStopMode("inherit_stay")}
                      >
                        Heredar del alojamiento
                      </button>
                    )}
                  </>
                )}
                {isStay && hasCoords && (
                  <button type="button" style={btnSecondary} disabled={busy} onClick={clearStay}>
                    Quitar ubicación del alojamiento
                  </button>
                )}
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              padding: "10px 16px 4px",
              borderTop: `1px solid ${C.outlineVariant}`,
            }}
          >
            <button
              type="button"
              style={{ ...btnSecondary, flex: 1 }}
              disabled={busy}
              onClick={onClose}
            >
              Cancelar
            </button>
            {pickerMode === "batch" ? (
              <button
                type="button"
                style={btnPrimary}
                disabled={!canConfirmBatch}
                onClick={runBatchSave}
              >
                {busy
                  ? "Guardando…"
                  : appliedCount > 0
                    ? `Continuar lote (${pendingApplyCount})`
                    : `Confirmar lote (${okBatchCount})`}
              </button>
            ) : (
              <button
                type="button"
                style={btnPrimary}
                disabled={!canConfirmSingle}
                onClick={confirmCoords}
              >
                {busy ? "Guardando…" : "Confirmar ubicación"}
              </button>
            )}
          </div>
        </div>
      </div>
      {confirmNode}
    </>
  );
}

function ParsePreview({ parsed, verifyUrl }) {
  return (
    <div
      data-parse-ok={parsed.ok ? "1" : "0"}
      style={{
        fontSize: 13,
        lineHeight: 1.45,
        marginBottom: 12,
        padding: "10px 12px",
        borderRadius: 8,
        background: parsed.ok ? "var(--accent-soft)" : C.surfaceContainerHigh,
        border: `1px solid ${parsed.ok ? "color-mix(in srgb, var(--accent) 35%, var(--border))" : C.outlineVariant}`,
        color: C.onSurface,
      }}
    >
      {parsed.ok ? (
        <>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Formato: {parsed.source}
            {parsed.precision === "view" ? " · Coordenada aproximada" : ""}
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: C.onSurfaceVariant }}>
            {Number(parsed.lat).toFixed(6)}, {Number(parsed.lng).toFixed(6)}
            {parsed.precision ? ` · ${parsed.precision}` : ""}
          </div>
          {parsed.suggested_name && (
            <div style={{ marginTop: 4, fontSize: 12 }}>{parsed.suggested_name}</div>
          )}
          {(parsed.warnings || []).length > 0 && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--warn-text)" }}>
              {parsed.warnings.map((w) => (
                <li key={w}>{w === "SHORT_CODE_FAR" ? "Plus Code lejos del alojamiento" : w}</li>
              ))}
            </ul>
          )}
          {parsed.precision === "view" && (
            <div style={{ marginTop: 6, color: "var(--warn-text)", fontWeight: 500 }}>
              Coordenada aproximada
            </div>
          )}
          {verifyUrl && (
            <a
              href={verifyUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: 44,
                marginTop: 6,
                color: "var(--accent-text)",
                fontWeight: 500,
              }}
            >
              Verificar en Google Maps
            </a>
          )}
        </>
      ) : (
        <div style={{ color: C.onSurfaceVariant }}>{parsed.error || "Formato no reconocido"}</div>
      )}
    </div>
  );
}

export default LocationPicker;
