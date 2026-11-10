import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { storage, setStorageMode } from "./lib/storage";
import { api } from "./lib/apiClient";
import { C, S, applyTheme, resolveInitialMode, persistMode } from "./theme";
import Login from "./Login.jsx";
import Markdown from "./components/Markdown.jsx";
import { useConfirmDialog } from "./components/ConfirmDialog.jsx";
import PlanPreview from "./components/PlanPreview.jsx";
import { useIsDesktop } from "./lib/viewport";
import {
  dayHasPendingLocations,
  isLocationResolved,
  locateCtaLabel,
  locationProgress,
  mapsDirectionsForStop,
  mapsSearch,
  mapsSearchForStop,
  stayLocationMode,
  stayLodgingSearchQuery,
} from "./lib/locations";
import { LocationBadge, LocationProgressBadge } from "./components/LocationBadge.jsx";
import { LocationPicker } from "./components/LocationPicker.jsx";
import { LocationProgressCard } from "./components/LocationProgressCard.jsx";
import { DayMap } from "./components/DayMap.jsx";

/* ============================================================
   NIHON PLANNER — Viaje a Japón (20 días, pareja, ARS/USD/JPY)
   Tokens: brand_app (hi-no-maru / paper / Space Grotesk) vía theme.js + Tailwind.
   ============================================================ */

function PowerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2v10"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M6.5 5.2a8 8 0 1 0 11 0"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CopyIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
      <path
        d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0 2 2v8a2 2 0 0 0 2 2h2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StopMapsLinks({ stop, day, stops, index }) {
  const directions = mapsDirectionsForStop(stop, day, stops, index);
  const search = mapsSearchForStop(stop, day);
  const linkStyle = {
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
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
      <a href={directions} target="_blank" rel="noopener" style={linkStyle}>
        Cómo llegar
      </a>
      <a href={search} target="_blank" rel="noopener" style={linkStyle}>
        Ver en Google Maps
      </a>
    </div>
  );
}

/** Toggle Lista/Mapa (§8.5). En desktop ≥900px el split no usa este control. */
function ListaMapaToggle({ value, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Vista del día"
      data-day-pane-toggle
      style={{ display: "flex", gap: 6, flexShrink: 0 }}
    >
      {[
        ["list", "Lista"],
        ["map", "Mapa"],
      ].map(([id, label]) => {
        const on = value === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={on}
            style={{ ...S.chip, ...(on ? S.chipOn : {}), minHeight: 36, padding: "6px 12px" }}
            onClick={() => onChange(id)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Primera parada pending del día, o stay si no hay. */
function openFirstPendingLocation(day, { onLocateStop, onLocateStay } = {}) {
  const pending = (day?.stops || []).find((s) => (s.location_mode || "pending") === "pending");
  if (pending && typeof onLocateStop === "function") {
    onLocateStop(pending);
    return;
  }
  if (typeof onLocateStay === "function") onLocateStay();
}

const CATS = [
  { id: "comida", label: "Comida", kanji: "食" },
  { id: "transporte", label: "Transporte", kanji: "交" },
  { id: "alojamiento", label: "Alojamiento", kanji: "宿" },
  { id: "actividades", label: "Actividades", kanji: "遊" },
  { id: "compras", label: "Compras", kanji: "買" },
  { id: "documentacion", label: "Docs", kanji: "証" },
  { id: "vuelos", label: "Vuelos", kanji: "空" },
  { id: "reservas", label: "Reservas", kanji: "予" },
  { id: "otros", label: "Otros", kanji: "他" },
];

function kindForCat(category, explicit) {
  if (explicit && explicit !== "expense") return explicit;
  if (category === "vuelos") return "flight";
  if (category === "documentacion") return "doc";
  if (category === "reservas") return "booking";
  return "expense";
}

const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = (n, cur) => {
  if (n == null || isNaN(n)) return "—";
  const opts = cur === "JPY" ? { maximumFractionDigits: 0 } : { maximumFractionDigits: 2, minimumFractionDigits: 2 };
  const s = Number(n).toLocaleString("es-AR", opts);
  return cur === "JPY" ? `¥${s}` : cur === "USD" ? `US$${s}` : `$${s}`;
};

/* ---------- storage helpers ---------- */
async function load(key, fallback) {
  try {
    const r = await storage.get(key);
    return r ? JSON.parse(r.value) : fallback;
  } catch {
    return fallback;
  }
}
async function save(key, value) {
  try {
    await storage.set(key, JSON.stringify(value));
  } catch (e) {
    console.error("storage save failed", key, e);
  }
}

/* ---------- conversión ---------- */
function makeConverter(rates) {
  const { usdArs, usdJpy } = rates;
  const toUSD = (a, cur) => (cur === "USD" ? a : cur === "ARS" ? a / usdArs : a / usdJpy);
  return (a, cur) => {
    const usd = toUSD(a, cur);
    return { USD: usd, ARS: usd * usdArs, JPY: usd * usdJpy };
  };
}

/* ============================================================ */
const NAV = [
  ["resumen", "概", "Resumen"],
  ["gastos", "費", "Gastos"],
  ["conversor", "両", "Conversor"],
  ["plan", "旅", "Plan"],
  ["ai", "助", "AI"],
];

function NavItem({ id, kanji, label, active, onClick, isDesktop }) {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      aria-current={active ? "page" : undefined}
      className={isDesktop ? `np-nav-item${active ? " is-active" : ""}` : undefined}
      style={{ ...(isDesktop ? S.railBtn : S.navBtn), ...(active ? (isDesktop ? S.railBtnActive : S.navBtnActive) : {}) }}
    >
      {active && <span style={isDesktop ? S.railIndicator : S.navIndicator} aria-hidden />}
      <span style={{ fontSize: 17, lineHeight: 1, fontWeight: active ? 700 : 500 }}>{kanji}</span>
      <span style={{ fontSize: isDesktop ? 13 : 11, letterSpacing: 0.3, fontWeight: active ? 600 : 400 }}>{label}</span>
    </button>
  );
}

export default function App() {
  const isDesktop = useIsDesktop();
  const [themeMode, setThemeMode] = useState(resolveInitialMode);
  applyTheme(themeMode, isDesktop);
  const toggleTheme = () => setThemeMode((m) => (m === "light" ? "dark" : "light"));

  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [tab, setTab] = useState("resumen");
  const activeLabel = NAV.find(([id]) => id === tab)?.[2] ?? "";
  const [ready, setReady] = useState(false);
  const [focusDayNumber, setFocusDayNumber] = useState(null);
  /** CTA Resumen → Plan con filtro "Pendientes de ubicar" (§8.3). */
  const [focusPendingLocations, setFocusPendingLocations] = useState(false);

  const [expenses, setExpenses] = useState([]);
  const [rates, setRates] = useState({ usdArs: 1300, usdJpy: 155, source: "manual", updatedAt: null });
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    applyTheme(themeMode, isDesktop);
    persistMode(themeMode);
  }, [themeMode, isDesktop]);

  useEffect(() => {
    (async () => {
      try {
        const { user: u } = await api.me();
        setUser(u);
        setStorageMode(true);
      } catch {
        setUser(null);
        setStorageMode(false);
      } finally {
        setAuthChecked(true);
      }
    })();
  }, []);

  const loadTrip = useCallback(async () => {
    const [e, r] = await Promise.all([
      load("jp:expenses", []),
      load("jp:rates", { usdArs: 1300, usdJpy: 155, source: "manual", updatedAt: null }),
    ]);
    setExpenses(Array.isArray(e) ? e : []);
    setRates(r);
    try {
      const list = await api.listSessions();
      setSessions(list);
    } catch {
      setSessions([]);
    }
    setReady(true);
  }, []);

  const [rateStatus, setRateStatus] = useState("idle");

  /** Cotización del momento: el server decide con su caché de 30 min (sin force). */
  const autoRefreshRates = useCallback(async () => {
    try {
      const next = await api.refreshRates(false);
      setRates(next);
      setRateStatus("ok");
    } catch {
      setRateStatus("offline");
    }
  }, []);

  async function fetchRates() {
    setRateStatus("loading");
    try {
      const next = await api.refreshRates(true);
      setRates(next);
      setRateStatus("ok");
    } catch {
      setRateStatus("offline");
    }
  }

  useEffect(() => {
    if (!user) return;
    loadTrip().then(autoRefreshRates);
  }, [user, loadTrip, autoRefreshRates]);

  /* persistencia (Fase 1 adapter) */
  useEffect(() => { if (ready && user) save("jp:expenses", expenses); }, [expenses, ready, user]);
  useEffect(() => { if (ready && user) save("jp:rates", rates); }, [rates, ready, user]);

  /** Restore de viaje: recarga gastos, tasas, sesiones y refresca la cotización. */
  const onTripRestored = useCallback(async () => {
    await loadTrip();
    await autoRefreshRates();
  }, [loadTrip, autoRefreshRates]);

  const convert = useMemo(() => makeConverter(rates), [rates]);

  const totals = useMemo(() => {
    const t = { USD: 0, ARS: 0, JPY: 0 };
    const byCat = {};
    expenses.forEach((e) => {
      if (e.amount == null || !e.currency) return;
      const c = convert(Number(e.amount) || 0, e.currency);
      t.USD += c.USD; t.ARS += c.ARS; t.JPY += c.JPY;
      byCat[e.category] = (byCat[e.category] || 0) + c.USD;
    });
    return { ...t, byCat };
  }, [expenses, convert]);

  const openPlanDay = (n) => {
    setFocusDayNumber(n);
    setTab("plan");
  };

  const openPlanPendingLocations = () => {
    setFocusPendingLocations(true);
    setTab("plan");
  };

  const logout = async () => {
    try { await api.logout(); } catch { /* ignore */ }
    setUser(null);
    setReady(false);
    setStorageMode(false);
  };

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-fg-muted font-sans tracking-[0.14em] text-sm">
        準備中 · cargando…
      </div>
    );
  }

  if (!user) {
    return (
      <Login
        themeMode={themeMode}
        onToggleTheme={() => setThemeMode((m) => (m === "light" ? "dark" : "light"))}
        onSuccess={(u) => { setStorageMode(true); setUser(u); }}
      />
    );
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-fg-muted font-sans tracking-[0.14em] text-sm">
        準備中 · cargando…
      </div>
    );
  }

  return (
    <div style={S.app} className="min-h-screen bg-bg text-fg font-sans">
      {isDesktop && (
        <aside style={S.rail} className="border-border bg-bg-elev shadow-np">
          <div style={S.railBrand}>
            <div style={S.stamp} title="Hinomaru" aria-hidden>
              <span style={S.hinomaru} />
            </div>
            <div className="font-display text-base font-semibold tracking-tight whitespace-nowrap">Nihon Planner</div>
          </div>
          <nav aria-label="Principal" style={S.railNav}>
            {NAV.map(([id, kanji, label]) => (
              <NavItem key={id} id={id} kanji={kanji} label={label} active={tab === id} onClick={setTab} isDesktop />
            ))}
          </nav>
          <div style={S.railFooter}>
            <button
              type="button"
              className="np-icon-btn"
              onClick={toggleTheme}
              title={themeMode === "light" ? "Tema oscuro" : "Tema claro"}
              aria-label={themeMode === "light" ? "Cambiar a tema oscuro" : "Cambiar a tema claro"}
            >
              {themeMode === "light" ? "暗" : "明"}
            </button>
            <button
              type="button"
              className="np-icon-btn"
              onClick={logout}
              title={`Cerrar sesión (${user.email})`}
              aria-label="Cerrar sesión"
            >
              <PowerIcon />
            </button>
          </div>
        </aside>
      )}

      <div style={S.content} className={isDesktop ? "max-w-[var(--content-max)] mx-auto" : undefined}>
        <header style={S.header}>
          <div>
            <div className="np-eyebrow">日本 · 20 días · dos viajeros</div>
            <h1 style={S.title} className="np-display">{isDesktop ? activeLabel : "Nihon Planner"}</h1>
          </div>
          {!isDesktop && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="np-icon-btn"
                onClick={toggleTheme}
                title={themeMode === "light" ? "Tema oscuro" : "Tema claro"}
                aria-label={themeMode === "light" ? "Cambiar a tema oscuro" : "Cambiar a tema claro"}
              >
                {themeMode === "light" ? "暗" : "明"}
              </button>
              <button
                type="button"
                className="np-icon-btn"
                onClick={logout}
                title={`Cerrar sesión (${user.email})`}
                aria-label="Cerrar sesión"
              >
                <PowerIcon />
              </button>
              <div style={S.stamp} title="Hinomaru" aria-hidden>
                <span style={S.hinomaru} />
              </div>
            </div>
          )}
        </header>

        <main style={S.main} className="font-sans">
          {tab === "resumen" && (
            <Resumen
              theme={themeMode}
              totals={totals}
              expenses={expenses}
              rates={rates}
              onOpenPlanDay={openPlanDay}
              onOpenGastos={() => setTab("gastos")}
              onLocatePending={openPlanPendingLocations}
            />
          )}
          {tab === "gastos" && <Gastos expenses={expenses} setExpenses={setExpenses} convert={convert} totals={totals} />}
          {tab === "conversor" && (
            <Conversor rates={rates} setRates={setRates} convert={convert} fetchRates={() => fetchRates()} rateStatus={rateStatus} />
          )}
          {tab === "plan" && (
            <Plan
              theme={themeMode}
              focusDayNumber={focusDayNumber}
              onFocusConsumed={() => setFocusDayNumber(null)}
              focusPendingLocations={focusPendingLocations}
              onPendingFocusConsumed={() => setFocusPendingLocations(false)}
              onTripRestored={onTripRestored}
            />
          )}
          {tab === "ai" && <Asistente sessions={sessions} setSessions={setSessions} />}
        </main>
      </div>

      {!isDesktop && (
        <nav style={S.nav} aria-label="Principal">
          {NAV.map(([id, kanji, label]) => (
            <NavItem key={id} id={id} kanji={kanji} label={label} active={tab === id} onClick={setTab} isDesktop={false} />
          ))}
        </nav>
      )}
    </div>
  );
}

const ITINERARY_PAGE = 8;

/* ================= RESUMEN ================= */
function Resumen({ theme = "light", totals, expenses, rates, onOpenPlanDay, onOpenGastos, onLocatePending }) {
  const isDesktop = useIsDesktop();
  const [dash, setDash] = useState(null);
  const [previewDay, setPreviewDay] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [previewAnchor, setPreviewAnchor] = useState(null);
  /** @type {[{ target: 'stop'|'stay', dayId: string, stopId?: string }|null, Function]} */
  const [locationPicker, setLocationPicker] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api.expensesDashboard();
        if (!cancelled) setDash(d);
      } catch {
        if (!cancelled) setDash(null);
      }
    })();
    return () => { cancelled = true; };
  }, [expenses]);

  const openDayPreview = async (dayNumber) => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const data = await api.getItinerary();
      setPreviewAnchor(data.meta?.anchor_date || null);
      const day = (data.days || []).find((d) => d.day_number === dayNumber);
      if (!day) {
        setPreviewError(`No se encontró el día ${dayNumber}`);
        setPreviewDay(null);
      } else {
        setPreviewDay(day);
      }
    } catch (e) {
      setPreviewError(e.message || "No se pudo cargar el día");
      setPreviewDay(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const logistics = dash?.logistics || { total: 0, done: 0, percent: 0 };
  const itinerary = dash?.itinerary || {
    days: 0,
    stops: 0,
    nextDays: [],
    dayChips: [],
    locations: { total: 0, resolved: 0, pending: 0 },
  };
  const locations = itinerary.locations || { total: 0, resolved: 0, pending: 0 };
  const est = dash?.estimatedVsLoaded || { loadedUSD: 0, pendingLogisticsUSD: 0 };
  const pendingItems = dash?.pendingItems || [];

  return (
    <div style={isDesktop ? S.grid : undefined}>
      <Card style={isDesktop ? S.spanFull : undefined}>
        <div style={S.label}>Total gastado</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 34, fontWeight: 700, color: C.ink }}>{fmt(totals.JPY, "JPY")}</span>
          <span style={{ fontSize: 15, color: C.indigo }}>{fmt(totals.USD, "USD")}</span>
          <span style={{ fontSize: 15, color: C.soft }}>{fmt(totals.ARS, "ARS")}</span>
        </div>
        <div style={{ fontSize: 12, color: C.soft, marginTop: 6 }}>
          {expenses.filter((e) => e.amount != null).length} con monto · cotización {rates.source}
        </div>
      </Card>

      <Card style={isDesktop ? S.spanFull : undefined}>
        <div style={S.label}>Por categoría (USD)</div>
        {Object.keys(totals.byCat).length === 0 && <Empty text="Todavía no hay montos. Cargá ítems en 費 Gastos." />}
        {CATS.filter((c) => totals.byCat[c.id]).map((c) => {
          const v = totals.byCat[c.id];
          const max = Math.max(...Object.values(totals.byCat));
          return (
            <div key={c.id} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}>
                <span><b style={{ color: C.hanko }}>{c.kanji}</b> {c.label}</span>
                <span style={{ color: C.indigo }}>{fmt(v, "USD")}</span>
              </div>
              <div style={{ height: 6, background: C.line, borderRadius: 3 }}>
                <div style={{ height: 6, width: `${(v / max) * 100}%`, background: C.indigo, borderRadius: 3 }} />
              </div>
            </div>
          );
        })}
      </Card>

      <Card>
        <div style={S.label}>Logística · checklist</div>
        <Row k="Completado" v={`${logistics.done}/${logistics.total} (${logistics.percent}%)`} />
        <Row k="Cargado (USD)" v={fmt(est.loadedUSD, "USD")} />
        <Row
          k="Pendiente logística c/ monto"
          v={fmt(est.pendingLogisticsUSD, "USD")}
          accent={est.pendingLogisticsUSD > 0}
        />
        <button type="button" style={{ ...S.ghost, marginTop: 8, fontSize: 13 }} onClick={onOpenGastos}>
          Gestionar en Gastos →
        </button>
      </Card>

      <LocationProgressCard locations={locations} onLocatePending={onLocatePending} />

      <Card>
        <div style={S.label}>Itinerario</div>
        <Row k="Días" v={itinerary.days} />
        <Row k="Paradas" v={itinerary.stops} />
        {itinerary.nextDays?.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, color: C.onSurfaceVariant, marginBottom: 6 }}>Próximos días</div>
            {itinerary.nextDays.map((d) => (
              <button
                key={d.day_number}
                type="button"
                onClick={() => openDayPreview(d.day_number)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  background: "transparent",
                  border: "none",
                  padding: "6px 0",
                  cursor: "pointer",
                  borderBottom: `1px solid ${C.line}`,
                }}
              >
                <span style={{ fontWeight: 700, color: C.hanko }}>D{d.day_number}</span>{" "}
                <span style={{ color: C.ink }}>{d.title || "Sin título"}</span>
                <span style={{ color: C.soft, fontSize: 12 }}> · {d.stops} paradas</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {pendingItems.length > 0 && (
        <Card>
          <div style={S.label}>Pendientes con monto</div>
          {pendingItems.map((p) => (
            <Row key={p.id} k={p.desc} v={fmt(p.amountUSD, "USD")} accent />
          ))}
        </Card>
      )}

      <Card>
        <div style={S.label}>Preview del plan</div>
        <PlanPreview
          days={itinerary.dayChips?.length ? itinerary.dayChips : itinerary.nextDays || []}
          onOpenDay={openDayPreview}
        />
      </Card>

      {(previewDay || previewLoading || previewError) && (
        <ItineraryDayDetailModal
          day={previewDay}
          loading={previewLoading}
          error={previewError}
          anchorDate={previewAnchor}
          theme={theme}
          onClose={() => {
            setPreviewDay(null);
            setPreviewError(null);
            setPreviewLoading(false);
            setLocationPicker(null);
          }}
          onEditInPlan={() => {
            const n = previewDay?.day_number;
            setPreviewDay(null);
            setPreviewError(null);
            setLocationPicker(null);
            if (n != null) onOpenPlanDay(n);
          }}
          onLocateStop={(stop) =>
            previewDay && setLocationPicker({ target: "stop", dayId: previewDay.id, stopId: stop.id })
          }
          onLocateStay={() =>
            previewDay && setLocationPicker({ target: "stay", dayId: previewDay.id })
          }
          onLocatePending={() =>
            previewDay &&
            openFirstPendingLocation(previewDay, {
              onLocateStop: (stop) =>
                setLocationPicker({ target: "stop", dayId: previewDay.id, stopId: stop.id }),
              onLocateStay: () => setLocationPicker({ target: "stay", dayId: previewDay.id }),
            })
          }
        />
      )}

      {locationPicker && previewDay && (() => {
        const pickerDay = previewDay.id === locationPicker.dayId ? previewDay : null;
        if (!pickerDay) return null;
        const pickerStop =
          locationPicker.target === "stop"
            ? (pickerDay.stops || []).find((s) => s.id === locationPicker.stopId)
            : null;
        if (locationPicker.target === "stop" && !pickerStop) return null;
        return (
          <LocationPicker
            open
            target={locationPicker.target}
            day={pickerDay}
            stop={pickerStop}
            onClose={() => setLocationPicker(null)}
            onSaved={async () => {
              try {
                const data = await api.getItinerary();
                const updated = (data.days || []).find((d) => d.id === pickerDay.id);
                if (updated) setPreviewDay(updated);
              } catch {
                /* el picker ya mostró el error de guardado */
              }
            }}
          />
        );
      })()}
    </div>
  );
}

function ItineraryDayDetailModal({
  day,
  loading,
  error,
  anchorDate,
  theme = "light",
  onClose,
  onEditInPlan,
  onLocateStop,
  onLocateStay,
  onLocatePending,
}) {
  const isDesktop = useIsDesktop();
  const [pane, setPane] = useState("list");
  useEffect(() => {
    setPane("list");
  }, [day?.id]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const cal = day ? calendarForDay(anchorDate, day.day_number) : null;
  const stops = [...(day?.stops || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const showMap = !!day && !loading;
  const showListPane = isDesktop || pane === "list" || !showMap;
  const showMapPane = showMap && (isDesktop || pane === "map");

  const dayDetailList = day && !loading && (
    <>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
        {day.title || `Día ${day.day_number}`}
      </div>
      <Row k="Base" v={day.base || "—"} />
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Row k="Alojamiento" v={day.stay_label || "—"} />
        </div>
        <LocationBadge
          mode={stayLocationMode(day)}
          precision={day.stay_precision}
          kind="stay"
        />
      </div>
      <Row k="Hub" v={day.hub || "—"} />
      {day.notes ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ ...S.label, marginBottom: 6 }}>Notas</div>
          <div style={{ fontSize: 13, color: C.onSurface, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
            {day.notes}
          </div>
        </div>
      ) : null}

      <div style={{ ...S.label, marginTop: 16, marginBottom: 8 }}>
        Paradas ({stops.length})
      </div>
      {stops.length === 0 ? (
        <Empty text="Este día no tiene paradas cargadas." />
      ) : (
        stops.map((s, i) => (
          <div
            key={s.id || i}
            style={{
              padding: "10px 0",
              borderBottom: `1px solid ${C.line}`,
              opacity: s.done ? 0.65 : 1,
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.hanko, minWidth: 28 }}>
                {s.kind === "hub_out" ? "OUT" : s.kind === "hub_back" ? "IN" : `#${i + 1}`}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, textDecoration: s.done ? "line-through" : "none" }}>
                    {s.name || "(sin nombre)"}
                  </div>
                  <LocationBadge
                    mode={s.location_mode}
                    precision={s.location_precision}
                    kind="stop"
                  />
                </div>
                {s.detail && (
                  <div style={{ fontSize: 12, color: C.onSurfaceVariant, marginTop: 2 }}>{s.detail}</div>
                )}
                {s.how_to_get && (
                  <div style={{ fontSize: 12, color: C.soft, marginTop: 2 }}>Cómo llegar: {s.how_to_get}</div>
                )}
                {s.est_duration && (
                  <div style={{ fontSize: 12, color: C.indigo, marginTop: 2 }}>{s.est_duration}</div>
                )}
                {s.notes && (
                  <div style={{ fontSize: 12, color: C.onSurfaceVariant, marginTop: 2 }}>{s.notes}</div>
                )}
                <StopMapsLinks stop={s} day={day} stops={stops} index={i} />
              </div>
            </div>
          </div>
        ))
      )}
    </>
  );

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: isDesktop ? "center" : "flex-end",
        justifyContent: "center",
        ...(isDesktop ? { padding: 24 } : {}),
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={day ? `Detalle día ${day.day_number}` : "Detalle del día"}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: isDesktop && showMap ? "min(100%, 1080px)" : isDesktop ? "min(100%, 640px)" : 520,
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          background: C.surfaceContainer,
          borderRadius: isDesktop ? 16 : "16px 16px 0 0",
          boxShadow: C.elevation2,
          paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "14px 16px", borderBottom: `1px solid ${C.outlineVariant}` }}>
          <div style={{ fontWeight: 700, fontSize: 16, minWidth: 0 }}>
            {loading
              ? "Cargando…"
              : day
                ? `Día ${day.day_number}${cal ? ` · ${cal}` : ""}`
                : "Detalle"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {showMap && !isDesktop && (
              <ListaMapaToggle value={pane} onChange={setPane} />
            )}
            <button type="button" style={S.ghost} onClick={onClose} aria-label="Cerrar">✕</button>
          </div>
        </div>

        <div
          data-day-pane-layout={isDesktop && showMap ? "split" : "stack"}
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: isDesktop && showMap ? "row" : "column",
            overflow: "hidden",
          }}
        >
          {showListPane && (
            <div
              style={{
                flex: 1,
                minWidth: 0,
                overflowY: "auto",
                padding: "12px 16px",
                WebkitOverflowScrolling: "touch",
              }}
            >
              {loading && <Empty text="Cargando el día…" />}
              {error && !loading && <Empty text={error} />}
              {dayDetailList}
            </div>
          )}
          {showMapPane && (
            <div
              data-day-map-pane
              style={{
                flex: isDesktop ? "0 0 46%" : 1,
                minWidth: isDesktop ? 280 : 0,
                overflowY: "auto",
                padding: isDesktop ? "12px 16px 12px 8px" : "12px 16px",
                borderLeft: isDesktop ? `1px solid ${C.outlineVariant}` : undefined,
                position: isDesktop ? "sticky" : undefined,
                top: 0,
                alignSelf: isDesktop ? "stretch" : undefined,
                WebkitOverflowScrolling: "touch",
              }}
            >
              <DayMap
                day={day}
                theme={theme}
                height={isDesktop ? "min(56vh, 480px)" : "min(55vh, 420px)"}
                onLocatePending={onLocatePending}
                onLocateStop={onLocateStop}
                onLocateStay={onLocateStay}
              />
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: `1px solid ${C.outlineVariant}` }}>
          <button type="button" style={{ ...S.ghost, flex: 1 }} onClick={onClose}>
            Cerrar
          </button>
          {day && (
            <button type="button" style={{ ...S.primary, flex: 1 }} onClick={onEditInPlan}>
              Editar en Plan
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================= GASTOS ================= */
function emptyExpenseForm() {
  return {
    desc: "",
    amount: "",
    currency: "JPY",
    category: "comida",
    kind: "expense",
    done: false,
    datetime_start: "",
    datetime_end: "",
    meta: {},
  };
}

function buildExpenseItem(form, editingId) {
  const amount = form.amount === "" || form.amount == null ? null : Number(form.amount);
  if (!form.desc.trim()) return null;
  if (amount != null && !(amount > 0)) return null;
  const resolvedKind =
    form.category === "alojamiento" && (form.kind === "stay" || form.meta?.city || form.datetime_start)
      ? "stay"
      : kindForCat(form.category, form.kind);
  return {
    id: editingId || uid(),
    desc: form.desc.trim(),
    amount,
    currency: amount != null ? form.currency || "JPY" : null,
    category: form.category,
    date: (form.datetime_start || new Date().toISOString()).slice(0, 10),
    done: !!form.done,
    kind: resolvedKind,
    meta: form.meta || {},
    datetime_start: form.datetime_start || null,
    datetime_end: form.datetime_end || null,
  };
}

function Gastos({ expenses, setExpenses, convert }) {
  const isDesktop = useIsDesktop();
  const [form, setForm] = useState(emptyExpenseForm);
  const [editingId, setEditingId] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filterCat, setFilterCat] = useState("all");
  const [filterDone, setFilterDone] = useState("all");

  const closeSheet = () => {
    setSheetOpen(false);
    setEditingId(null);
    setForm(emptyExpenseForm());
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyExpenseForm());
    setSheetOpen(true);
  };

  const openEdit = (e) => {
    setEditingId(e.id);
    setForm({
      desc: e.desc || "",
      amount: e.amount == null ? "" : String(e.amount),
      currency: e.currency || "JPY",
      category: e.category || "otros",
      kind: e.kind || "expense",
      done: !!e.done,
      datetime_start: e.datetime_start || "",
      datetime_end: e.datetime_end || "",
      meta: e.meta || {},
    });
    setSheetOpen(true);
  };

  const saveItem = () => {
    const item = buildExpenseItem(form, editingId);
    if (!item) return;
    if (editingId) {
      setExpenses(expenses.map((e) => (e.id === editingId ? item : e)));
    } else {
      setExpenses([item, ...expenses]);
    }
    closeSheet();
  };

  const filtered = expenses.filter((e) => {
    if (filterCat !== "all" && e.category !== filterCat) return false;
    if (filterDone === "pending" && e.done) return false;
    if (filterDone === "done" && !e.done) return false;
    return true;
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8 }}>
        <div style={{ fontSize: 13, color: C.onSurfaceVariant }}>
          {filtered.length} de {expenses.length} ítem{expenses.length !== 1 ? "s" : ""}
        </div>
        <button type="button" style={{ ...S.primary, ...(isDesktop ? { width: "auto", paddingInline: 20, marginTop: 0 } : null) }} onClick={openCreate}>
          + Agregar
        </button>
      </div>

      <div style={{ fontSize: 12, color: C.onSurfaceVariant, marginBottom: 6 }}>Filtrar por categoría</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        <button
          type="button"
          style={{ ...S.chip, ...(filterCat === "all" ? S.chipOn : {}) }}
          onClick={() => setFilterCat("all")}
        >
          Todas
        </button>
        {CATS.map((c) => (
          <button
            key={c.id}
            type="button"
            style={{ ...S.chip, ...(filterCat === c.id ? S.chipOn : {}) }}
            onClick={() => setFilterCat(c.id)}
          >
            {c.kanji} {c.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          ["all", "Todos"],
          ["pending", "Pendientes"],
          ["done", "Hechos"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            style={{ ...S.chip, ...(filterDone === id ? S.chipOn : {}) }}
            onClick={() => setFilterDone(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card style={isDesktop ? S.spanFull : undefined}>
          <Empty text={expenses.length === 0 ? "Sin ítems. Tocá Agregar para cargar el primero." : "Sin ítems en este filtro."} />
        </Card>
      ) : (
        <div style={isDesktop ? S.grid : undefined}>
        {filtered.map((e) => {
          const cat = CATS.find((x) => x.id === e.category);
          const hasAmount = e.amount != null && e.currency;
          const c = hasAmount ? convert(e.amount, e.currency) : null;
          return (
            <Card key={e.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <button
                  type="button"
                  onClick={() =>
                    setExpenses(expenses.map((x) => (x.id === e.id ? { ...x, done: !x.done } : x)))
                  }
                  style={{
                    ...S.ghost,
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    border: `1px solid ${e.done ? C.indigo : C.line}`,
                    color: e.done ? C.indigo : C.soft,
                    flexShrink: 0,
                  }}
                  title={e.done ? "Hecho" : "Pendiente"}
                >
                  {e.done ? "✓" : "○"}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, textDecoration: e.done ? "line-through" : "none", opacity: e.done ? 0.7 : 1 }}>
                    <span style={{ color: C.hanko, marginRight: 6 }}>{cat?.kanji}</span>
                    {e.desc}
                  </div>
                  <div style={{ fontSize: 12, color: C.soft, marginTop: 2 }}>
                    {cat ? `${cat.kanji} ${cat.label}` : e.category}
                    {e.date ? ` · ${e.date}` : ""}
                  </div>
                  {c && (
                    <div style={{ fontSize: 13, color: C.indigo, marginTop: 6 }}>
                      {fmt(c.JPY, "JPY")} · {fmt(c.USD, "USD")} · {fmt(c.ARS, "ARS")}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button type="button" style={S.ghost} onClick={() => openEdit(e)} aria-label="Editar">✎</button>
                  <button
                    type="button"
                    style={S.ghost}
                    onClick={() => setExpenses(expenses.filter((x) => x.id !== e.id))}
                    aria-label="Eliminar"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
        </div>
      )}

      {sheetOpen && (
        <ExpenseFormSheet
          form={form}
          setForm={setForm}
          editingId={editingId}
          onSave={saveItem}
          onClose={closeSheet}
        />
      )}
    </div>
  );
}

function ExpenseFormSheet({ form, setForm, editingId, onSave, onClose }) {
  const isDesktop = useIsDesktop();
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const canSave = form.desc.trim() && (form.amount === "" || form.amount == null || Number(form.amount) > 0);

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: isDesktop ? "center" : "flex-end",
        justifyContent: "center",
        ...(isDesktop ? { padding: 24 } : {}),
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editingId ? "Editar ítem" : "Nuevo ítem"}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: isDesktop ? "min(100%, 640px)" : 520,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          background: C.surfaceContainer,
          borderRadius: isDesktop ? 16 : "16px 16px 0 0",
          boxShadow: C.elevation2,
          paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: `1px solid ${C.outlineVariant}` }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{editingId ? "Editar ítem" : "Agregar ítem"}</div>
          <button type="button" style={S.ghost} onClick={onClose}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", WebkitOverflowScrolling: "touch" }}>
          <div style={S.label}>Categoría</div>
          <select
            style={{ ...S.input, marginBottom: 10 }}
            value={form.category}
            onChange={(e) => {
              const category = e.target.value;
              setForm({
                ...form,
                category,
                kind: category === "alojamiento" ? form.kind : kindForCat(category),
              });
            }}
          >
            {CATS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.kanji} {c.label}
              </option>
            ))}
          </select>

          <div style={S.label}>Descripción</div>
          <input
            style={S.input}
            placeholder="Ej: Ramen Ichiran / Pasaporte / EZE → NRT"
            value={form.desc}
            onChange={(e) => setForm({ ...form, desc: e.target.value })}
            autoFocus
          />

          <div style={S.label}>Monto (opcional)</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ ...S.input, flex: 1 }}
              type="number"
              inputMode="decimal"
              placeholder="Sin monto si es solo checklist"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
            <select
              style={{ ...S.input, width: 90 }}
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            >
              <option>JPY</option>
              <option>USD</option>
              <option>ARS</option>
            </select>
          </div>

          {(form.category === "vuelos" || form.kind === "flight") && (
            <>
              <div style={S.label}>Código de vuelo</div>
              <input
                style={S.input}
                placeholder="Aerolínea / código (opcional)"
                value={form.meta?.code || ""}
                onChange={(e) => setForm({ ...form, meta: { ...form.meta, code: e.target.value } })}
              />
              <div style={S.label}>Fecha y hora</div>
              <input
                style={S.input}
                type="datetime-local"
                value={toLocalInput(form.datetime_start)}
                onChange={(e) => setForm({ ...form, datetime_start: fromLocalInput(e.target.value) })}
              />
            </>
          )}

          {form.category === "reservas" && (
            <>
              <div style={S.label}>Fecha y hora</div>
              <input
                style={S.input}
                type="datetime-local"
                value={toLocalInput(form.datetime_start)}
                onChange={(e) => setForm({ ...form, datetime_start: fromLocalInput(e.target.value) })}
              />
            </>
          )}

          {(form.category === "alojamiento" || form.kind === "stay") && (
            <>
              <div style={S.label}>Ciudad (si es estadía del viaje)</div>
              <input
                style={S.input}
                placeholder="Tokyo, Kyoto…"
                value={form.meta?.city || ""}
                onChange={(e) => setForm({ ...form, meta: { ...form.meta, city: e.target.value }, kind: "stay" })}
              />
              <div style={S.label}>Check-in / Check-out</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  style={{ ...S.input, flex: 1 }}
                  type="datetime-local"
                  value={toLocalInput(form.datetime_start)}
                  onChange={(e) => setForm({ ...form, datetime_start: fromLocalInput(e.target.value), kind: "stay" })}
                />
                <input
                  style={{ ...S.input, flex: 1 }}
                  type="datetime-local"
                  value={toLocalInput(form.datetime_end)}
                  onChange={(e) => setForm({ ...form, datetime_end: fromLocalInput(e.target.value), kind: "stay" })}
                />
              </div>
            </>
          )}

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 4, color: C.ink }}>
            <input
              type="checkbox"
              checked={!!form.done}
              onChange={(e) => setForm({ ...form, done: e.target.checked })}
            />
            Marcado como hecho
          </label>
        </div>

        <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: `1px solid ${C.outlineVariant}` }}>
          <button type="button" style={{ ...S.ghost, flex: 1 }} onClick={onClose}>
            Cancelar
          </button>
          <button type="button" style={{ ...S.primary, flex: 1, opacity: canSave ? 1 : 0.5 }} onClick={onSave} disabled={!canSave}>
            {editingId ? "Guardar" : "Agregar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v) {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toISOString();
}

/* ================= CONVERSOR ================= */
function Conversor({ rates, setRates, convert, fetchRates, rateStatus }) {
  const isDesktop = useIsDesktop();
  const [amount, setAmount] = useState("1000");
  const [cur, setCur] = useState("JPY");
  const c = convert(Number(amount) || 0, cur);
  return (
    <div style={isDesktop ? S.grid : undefined}>
      <Card>
        <div style={S.label}>Convertir</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input style={{ ...S.input, flex: 1, fontSize: 20 }} type="number" inputMode="decimal" value={amount}
            onChange={(e) => setAmount(e.target.value)} />
          <select style={{ ...S.input, width: 90 }} value={cur} onChange={(e) => setCur(e.target.value)}>
            <option>JPY</option><option>USD</option><option>ARS</option>
          </select>
        </div>
        <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
          {["JPY", "USD", "ARS"].filter((x) => x !== cur).map((x) => (
            <div key={x} style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: C.bg, borderRadius: 10 }}>
              <span style={{ color: C.soft, fontSize: 13 }}>{x}</span>
              <span style={{ fontWeight: 700, fontSize: 18, color: C.ink }}>{fmt(c[x], x)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={S.label}>Cotizaciones</div>
          <button style={S.secondary} onClick={fetchRates}>
            {rateStatus === "loading" ? "Actualizando…" : "↻ Actualizar"}
          </button>
        </div>
        {rateStatus === "offline" && (
          <div style={S.warn}>No pude acceder a la API desde este entorno. Usando cotización manual — podés editarla abajo.</div>
        )}
        <div style={{ fontSize: 12, color: C.soft, marginBottom: 10 }}>
          Fuente: {rates.source}{rates.updatedAt ? ` · ${new Date(rates.updatedAt).toLocaleString("es-AR")}` : ""}
        </div>
        <EditableRate label="1 USD en ARS" value={rates.usdArs} onChange={(v) => setRates({ ...rates, usdArs: v, source: "manual" })}
          hint="Tip: usá blue/tarjeta, no oficial" />
        <EditableRate label="1 USD en JPY" value={rates.usdJpy} onChange={(v) => setRates({ ...rates, usdJpy: v, source: "manual" })} />
        <div style={{ fontSize: 12, color: C.soft, marginTop: 8 }}>
          Implícito: ¥1000 ≈ {fmt(convert(1000, "JPY").ARS, "ARS")}
        </div>
      </Card>
    </div>
  );
}

function EditableRate({ label, value, onChange, hint }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <span style={{ fontSize: 13, flex: 1 }}>{label}{hint && <span style={{ color: C.matcha, fontSize: 11 }}> · {hint}</span>}</span>
      <input style={{ ...S.input, width: 110, marginBottom: 0 }} type="number" inputMode="decimal" value={value}
        onChange={(e) => onChange(Number(e.target.value) || value)} />
    </div>
  );
}

/* ================= PLAN / ITINERARIO ================= */
const fmtDT = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d) ? v : d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
};

function calendarForDay(anchorDate, dayNumber) {
  if (!anchorDate || !dayNumber) return null;
  const [y, m, d] = String(anchorDate).split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + (dayNumber - 1));
  return dt.toLocaleDateString("es-AR", { day: "numeric", month: "numeric", timeZone: "UTC" });
}

function Plan({
  theme = "light",
  focusDayNumber = null,
  onFocusConsumed,
  focusPendingLocations = false,
  onPendingFocusConsumed,
  onTripRestored,
}) {
  const isDesktop = useIsDesktop();
  const [meta, setMeta] = useState({ title: "", anchor_date: null });
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [importing, setImporting] = useState(false);
  const [tripBusy, setTripBusy] = useState(false);
  const [tripInfo, setTripInfo] = useState(null);
  const [importProgress, setImportProgress] = useState(null);
  const [query, setQuery] = useState("");
  /** Filtro Plan §8.3: solo días con pending>0 (lista de días + hint). */
  const [filterPendingLocations, setFilterPendingLocations] = useState(false);
  const [visible, setVisible] = useState(ITINERARY_PAGE);
  const [daySheet, setDaySheet] = useState(null);
  const [stopSheet, setStopSheet] = useState(null);
  /** @type {[{ target: 'stop'|'stay', dayId: string, stopId?: string }|null, Function]} */
  const [locationPicker, setLocationPicker] = useState(null);
  const [busy, setBusy] = useState(false);
  const importRef = useRef(null);
  const tripRef = useRef(null);
  const [askConfirm, confirmNode] = useConfirmDialog();

  const refresh = useCallback(async () => {
    const data = await api.getItinerary();
    setMeta(data.meta || { title: "", anchor_date: null });
    setDays(data.days || []);
    return data;
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    setVisible(ITINERARY_PAGE);
  }, [query, filterPendingLocations, days.length]);

  useEffect(() => {
    if (!focusPendingLocations) return;
    setQuery("");
    setFilterPendingLocations(true);
    onPendingFocusConsumed?.();
  }, [focusPendingLocations, onPendingFocusConsumed]);

  useEffect(() => {
    if (focusDayNumber == null || !days.length) return;
    const d = days.find((x) => x.day_number === focusDayNumber);
    if (d) {
      setQuery("");
      setFilterPendingLocations(false);
      setVisible(Math.max(ITINERARY_PAGE, days.length));
      setDaySheet({
        mode: "edit",
        id: d.id,
        values: {
          day_number: String(d.day_number),
          title: d.title || "",
          base: d.base || "",
          stay_label: d.stay_label || "",
          hub: d.hub || "",
          notes: d.notes || "",
        },
        stops: d.stops || [],
      });
    }
    onFocusConsumed?.();
  }, [focusDayNumber, days, onFocusConsumed]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return days.filter((d) => {
      if (filterPendingLocations && !dayHasPendingLocations(d)) return false;
      if (!q) return true;
      const blob = [d.day_number, d.title, d.base, d.stay_label, d.hub, d.notes, ...(d.stops || []).map((s) => s.name)]
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [days, query, filterPendingLocations]);

  const shown = filtered.slice(0, visible);

  const saveMeta = async (patch) => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.putItineraryMeta(patch);
      setMeta(next);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const runImportMd = async (markdown, filename, { force = false } = {}) => {
    setImportProgress({
      percent: 2,
      message: force
        ? "Importando igual · ubicaciones actuales se descartarán…"
        : "Archivo listo · enviando a la AI…",
      detail: `${Math.round(markdown.length / 1024)} KB`,
      phase: "upload",
    });
    const res = await api.importItineraryMdStream(
      markdown,
      filename,
      (p) => {
        setImportProgress({
          percent: Math.min(99, Number(p.percent) || 0),
          message: p.message || "Importando…",
          detail: p.detail || "",
          phase: p.phase || "progress",
          current: p.current,
          total: p.total,
        });
      },
      { force },
    );
    setMeta(res.itinerary.meta);
    setDays(res.itinerary.days || []);
    setWarnings(res.warnings || []);
    setImportProgress({
      percent: 100,
      message: "Listo",
      detail: `${res.itinerary.days?.length || 0} días importados`,
      phase: "done",
    });
    await new Promise((r) => setTimeout(r, 700));
    return res;
  };

  const onImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const ok = await askConfirm({
      title: "Reemplazar itinerario",
      message: "Esto reemplaza TODO el itinerario actual por el contenido del archivo. ¿Continuar?",
      confirmLabel: "Importar y reemplazar",
      danger: true,
    });
    if (!ok) return;
    setImporting(true);
    setImportProgress({
      percent: 0,
      message: "Leyendo el archivo…",
      detail: file.name,
      phase: "read",
    });
    setError(null);
    setWarnings([]);
    try {
      const markdown = await file.text();
      try {
        await runImportMd(markdown, file.name, { force: false });
      } catch (err) {
        if (err?.code === "LOCATIONS_AT_RISK" && err?.status === 409) {
          setImportProgress(null);
          const resolved =
            err.data?.error?.resolved ?? err.data?.resolved ?? "?";
          const forceOk = await askConfirm({
            title: "Ubicaciones en riesgo",
            message:
              err.message ||
              `Este Markdown no trae ubicaciones. Tu itinerario tiene ${resolved} ubicaciones validadas y se van a perder.`,
            confirmLabel: "Importar igual",
            cancelLabel: "Cancelar",
            danger: true,
          });
          if (!forceOk) return;
          setImportProgress({
            percent: 0,
            message: "Reintentando con confirmación…",
            detail: file.name,
            phase: "upload",
          });
          await runImportMd(markdown, file.name, { force: true });
          return;
        }
        throw err;
      }
    } catch (err) {
      setError(err.message || "Error al importar");
      setImportProgress(null);
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  const onExport = async () => {
    setError(null);
    try {
      const md = await api.exportItineraryMd();
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(meta.title || "nihon-itinerario").replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "nihon-itinerario"}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    }
  };

  /** Archivo de viaje completo (§9.4): gastos + logística + tasas + sesiones + itinerario. */
  const exportTrip = async () => {
    setError(null);
    setTripInfo(null);
    try {
      const dump = await api.exportDump();
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nihon-viaje-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    }
  };

  const importTrip = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setTripInfo(null);
    setWarnings([]);

    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      setError("El archivo no es JSON válido");
      return;
    }
    const TRIP_KEYS = ["jp:expenses", "jp:itinerary", "jp:rates", "jp:logistics"];
    if (!TRIP_KEYS.some((k) => payload?.[k] != null)) {
      setError("Ese JSON no es un respaldo de viaje: no trae gastos ni itinerario");
      return;
    }

    const ok = await askConfirm({
      title: "Restaurar viaje",
      message:
        "Esto reemplaza TODOS los gastos y el itinerario actuales por el contenido del archivo. Se guarda un snapshot antes. ¿Continuar?",
      confirmLabel: "Restaurar y reemplazar",
      danger: true,
    });
    if (!ok) return;

    setTripBusy(true);
    try {
      const res = await api.importData(payload);
      await refresh();
      await onTripRestored?.(res);
      const n = res?.imported?.expenses ?? 0;
      const d = res?.imported?.days ?? 0;
      setTripInfo(
        `Viaje restaurado: ${n} ${n === 1 ? "gasto" : "gastos"}, ${d} ${d === 1 ? "día" : "días"}.`,
      );
    } catch (err) {
      setError(err.message || "Error al restaurar el viaje");
    } finally {
      setTripBusy(false);
    }
  };

  const openCreateDay = () => {
    const nextNum = days.reduce((m, d) => Math.max(m, d.day_number), 0) + 1;
    setDaySheet({
      mode: "create",
      values: { day_number: String(nextNum), title: "", base: "", stay_label: "", hub: "", notes: "" },
    });
  };

  const openEditDay = (d) => {
    setDaySheet({
      mode: "edit",
      id: d.id,
      values: {
        day_number: String(d.day_number),
        title: d.title || "",
        base: d.base || "",
        stay_label: d.stay_label || "",
        hub: d.hub || "",
        notes: d.notes || "",
      },
      stops: d.stops || [],
    });
  };

  const saveDaySheet = async () => {
    if (!daySheet) return;
    const v = daySheet.values;
    const day_number = Number(v.day_number);
    if (!Number.isInteger(day_number) || day_number < 1) {
      setError("El número de día debe ser un entero ≥ 1");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        day_number,
        title: v.title,
        base: v.base,
        stay_label: v.stay_label,
        hub: v.hub,
        notes: v.notes,
      };
      if (daySheet.mode === "create") {
        await api.createItineraryDay(body);
      } else {
        await api.patchItineraryDay(daySheet.id, body);
      }
      await refresh();
      setDaySheet(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteDay = async (d) => {
    const ok = await askConfirm({
      title: `Eliminar día ${d.day_number}`,
      message: `¿Eliminar el Día ${d.day_number}${d.title ? ` — ${d.title}` : ""}? Esta acción no se puede deshacer.`,
      confirmLabel: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteItineraryDay(d.id);
      await refresh();
      if (daySheet?.id === d.id) setDaySheet(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const saveStopSheet = async () => {
    if (!stopSheet) return;
    const name = (stopSheet.values.name || "").trim();
    if (!name) {
      setError("La parada necesita un nombre");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (stopSheet.mode === "create") {
        await api.createItineraryStop(stopSheet.dayId, stopSheet.values);
      } else {
        await api.patchItineraryStop(stopSheet.id, stopSheet.values);
      }
      const data = await refresh();
      if (daySheet?.id) {
        const updated = (data.days || []).find((x) => x.id === daySheet.id);
        if (updated) setDaySheet((s) => (s ? { ...s, stops: updated.stops } : s));
      }
      setStopSheet(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const moveStop = async (dayId, stop, dir) => {
    const day = days.find((d) => d.id === dayId);
    if (!day) return;
    const list = [...(day.stops || [])].sort((a, b) => a.sort_order - b.sort_order);
    const idx = list.findIndex((s) => s.id === stop.id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= list.length) return;
    setBusy(true);
    try {
      await api.patchItineraryStop(list[idx].id, { sort_order: list[j].sort_order });
      await api.patchItineraryStop(list[j].id, { sort_order: list[idx].sort_order });
      const data = await refresh();
      if (daySheet?.id === dayId) {
        const updated = (data.days || []).find((x) => x.id === dayId);
        if (updated) setDaySheet((s) => (s ? { ...s, stops: updated.stops } : s));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteStop = async (stop) => {
    const ok = await askConfirm({
      title: "Eliminar parada",
      message: `¿Eliminar la parada “${stop.name}”?`,
      confirmLabel: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.deleteItineraryStop(stop.id);
      const data = await refresh();
      if (daySheet?.id) {
        const updated = (data.days || []).find((x) => x.id === daySheet.id);
        if (updated) setDaySheet((s) => (s ? { ...s, stops: updated.stops } : s));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <Empty text="Cargando itinerario…" />;
  }

  return (
    <div style={isDesktop ? S.grid : undefined}>
      {confirmNode}
      <Card>
        <div style={S.label}>Itinerario</div>
        <input
          id="trip-title"
          name="title"
          aria-label="Título del viaje"
          style={S.input}
          placeholder="Título del viaje"
          value={meta.title || ""}
          disabled={busy || importing}
          onChange={(e) => setMeta((m) => ({ ...m, title: e.target.value }))}
          onBlur={() => saveMeta({ title: meta.title || "" })}
        />
        <label htmlFor="trip-anchor-date" style={{ display: "block", fontSize: 11, color: C.onSurfaceVariant, marginBottom: 4 }}>Fecha ancla (Día 1) — opcional</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input
            id="trip-anchor-date"
            name="anchor_date"
            style={{ ...S.input, flex: 1, marginBottom: 0 }}
            type="date"
            value={meta.anchor_date || ""}
            disabled={busy || importing}
            onChange={(e) => {
              const v = e.target.value || null;
              setMeta((m) => ({ ...m, anchor_date: v }));
              saveMeta({ anchor_date: v });
            }}
          />
          {meta.anchor_date && (
            <button
              type="button"
              style={{ ...S.secondary, marginTop: 0 }}
              disabled={busy}
              onClick={() => {
                setMeta((m) => ({ ...m, anchor_date: null }));
                saveMeta({ anchor_date: null });
              }}
            >
              Quitar
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" style={S.secondary} disabled={importing || busy} onClick={() => importRef.current?.click()}>
            {importing ? "Importando…" : "Importar .md"}
          </button>
          <input ref={importRef} type="file" accept=".md,text/markdown,text/plain" style={{ display: "none" }} onChange={onImportFile} />
          <button type="button" style={S.secondary} disabled={importing || busy} onClick={onExport}>Exportar .md</button>
          <button
            type="button"
            style={S.secondary}
            disabled={importing || tripBusy || busy}
            onClick={() => tripRef.current?.click()}
          >
            {tripBusy ? "Restaurando…" : "Importar viaje"}
          </button>
          <input
            ref={tripRef}
            type="file"
            accept="application/json,.json"
            aria-label="Restaurar viaje desde JSON"
            style={{ display: "none" }}
            onChange={importTrip}
          />
          <button type="button" style={S.secondary} disabled={importing || tripBusy || busy} onClick={exportTrip}>
            Exportar viaje
          </button>
          <button type="button" style={{ ...S.primary, width: "auto", padding: "0 16px", marginTop: 0 }} disabled={importing || tripBusy || busy} onClick={openCreateDay}>
            + Día
          </button>
        </div>
        {importProgress && <ImportProgressOverlay progress={importProgress} />}
        {tripInfo && (
          <div style={{ ...S.label, marginTop: 10, marginBottom: 0, color: C.indigo }}>{tripInfo}</div>
        )}
        {warnings.length > 0 && (
          <div style={{ ...S.warn, marginTop: 10 }}>
            Import OK con avisos: {warnings.slice(0, 5).join(" · ")}
            {warnings.length > 5 ? ` (+${warnings.length - 5})` : ""}
          </div>
        )}
        {error && <div style={{ ...S.warn, marginTop: 10 }}>{error}</div>}
      </Card>

      {days.length === 0 && !importing && (
        <Card style={isDesktop ? S.spanFull : undefined}>
          <Empty text="Todavía no hay días. Importá un plan .md (ej. docs/plan.example.md) o creá el Día 1." />
          <button type="button" style={S.primary} onClick={() => importRef.current?.click()}>Importar plan .md</button>
          <button type="button" style={{ ...S.secondary, width: "100%", marginTop: 8 }} onClick={openCreateDay}>Crear día 1</button>
        </Card>
      )}

      {days.length > 0 && (
        <Card>
          <input
            id="plan-search"
            name="q"
            aria-label="Buscar día, base o parada"
            style={{ ...S.input, marginBottom: 8 }}
            type="search"
            placeholder="Buscar día, base, parada…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            <button
              type="button"
              style={{ ...S.chip, ...(filterPendingLocations ? S.chipOn : {}) }}
              aria-pressed={filterPendingLocations}
              onClick={() => setFilterPendingLocations((v) => !v)}
            >
              Pendientes de ubicar
            </button>
          </div>
          <div style={{ fontSize: 11, color: C.onSurfaceVariant, marginBottom: 8 }}>
            Mostrando {shown.length} de {filtered.length}
            {filtered.length !== days.length ? ` · filtrados de ${days.length}` : ""}
            {filterPendingLocations
              ? " · solo días con paradas sin ubicar (abrí el día para el picker)"
              : ""}
          </div>
          <div style={{ maxHeight: isDesktop ? "calc(100vh - 300px)" : "min(55vh, 480px)", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
            {filtered.length === 0 && (
              <Empty
                text={
                  filterPendingLocations
                    ? "No hay días con ubicaciones pendientes."
                    : "Sin resultados para esta búsqueda."
                }
              />
            )}
            {shown.map((d) => {
              const cal = calendarForDay(meta.anchor_date, d.day_number);
              const prog = locationProgress(d);
              return (
                <div
                  key={d.id}
                  style={{
                    padding: "12px 8px",
                    borderBottom: `1px solid ${C.outlineVariant}`,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    alignItems: "flex-start",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => openEditDay(d)}
                    style={{
                      flex: 1,
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      color: C.onSurface,
                      minWidth: 0,
                    }}
                  >
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>
                        Día {d.day_number}
                        {cal ? ` · ${cal}` : ""}
                        {d.title ? ` — ${d.title}` : ""}
                      </div>
                      <LocationProgressBadge progress={prog} />
                    </div>
                    <Meta>
                      {[d.base && `Base ${d.base}`, d.stay_label && `Dormir: ${d.stay_label}`, d.hub && `Hub ${d.hub}`, `${(d.stops || []).length} paradas`]
                        .filter(Boolean)
                        .join(" · ")}
                    </Meta>
                  </button>
                  <button type="button" style={{ ...S.ghost, minWidth: 40 }} aria-label={`Eliminar día ${d.day_number}`} title="Eliminar día" onClick={() => deleteDay(d)}>✕</button>
                </div>
              );
            })}
            {visible < filtered.length && (
              <button type="button" style={{ ...S.secondary, width: "100%", marginTop: 10 }} onClick={() => setVisible((n) => n + ITINERARY_PAGE)}>
                Cargar más ({filtered.length - visible} restantes)
              </button>
            )}
          </div>
        </Card>
      )}

      {daySheet && (
        <ItineraryDaySheet
          sheet={daySheet}
          day={days.find((d) => d.id === daySheet.id) || null}
          theme={theme}
          busy={busy}
          anchorDate={meta.anchor_date}
          onChangeValues={(values) => setDaySheet((s) => (s ? { ...s, values } : s))}
          onSave={saveDaySheet}
          onClose={() => !busy && setDaySheet(null)}
          onAddStop={() =>
            setStopSheet({
              mode: "create",
              dayId: daySheet.id,
              values: { name: "", detail: "", how_to_get: "", est_duration: "", notes: "", kind: "stop" },
            })
          }
          onEditStop={(stop) =>
            setStopSheet({
              mode: "edit",
              id: stop.id,
              dayId: daySheet.id,
              values: {
                name: stop.name || "",
                detail: stop.detail || "",
                how_to_get: stop.how_to_get || "",
                est_duration: stop.est_duration || "",
                notes: stop.notes || "",
                kind: stop.kind || "stop",
                done: !!stop.done,
              },
            })
          }
          onLocateStop={(stop) =>
            setLocationPicker({ target: "stop", dayId: daySheet.id, stopId: stop.id })
          }
          onLocateStay={() => setLocationPicker({ target: "stay", dayId: daySheet.id })}
          onLocatePending={() => {
            const d = days.find((x) => x.id === daySheet.id);
            openFirstPendingLocation(
              d ? { ...d, stops: daySheet.stops || d.stops } : { stops: daySheet.stops },
              {
                onLocateStop: (stop) =>
                  setLocationPicker({ target: "stop", dayId: daySheet.id, stopId: stop.id }),
                onLocateStay: () => setLocationPicker({ target: "stay", dayId: daySheet.id }),
              },
            );
          }}
          onMoveStop={(stop, dir) => moveStop(daySheet.id, stop, dir)}
          onDeleteStop={deleteStop}
          onToggleStopDone={async (stop) => {
            setBusy(true);
            try {
              await api.patchItineraryStop(stop.id, { done: !stop.done });
              const data = await refresh();
              const updated = (data.days || []).find((x) => x.id === daySheet.id);
              if (updated) setDaySheet((s) => (s ? { ...s, stops: updated.stops } : s));
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {stopSheet && (() => {
        const stopDay = days.find((d) => d.id === stopSheet.dayId) || null;
        const stopRow =
          stopSheet.mode === "edit" && stopSheet.id
            ? (stopDay?.stops || []).find((s) => s.id === stopSheet.id) || null
            : null;
        return (
          <ItineraryStopSheet
            sheet={stopSheet}
            stop={stopRow}
            day={stopDay}
            busy={busy}
            onChange={(values) => setStopSheet((s) => (s ? { ...s, values } : s))}
            onSave={saveStopSheet}
            onClose={() => !busy && setStopSheet(null)}
            onLocate={
              stopSheet.mode === "edit" && stopSheet.id
                ? () =>
                    setLocationPicker({
                      target: "stop",
                      dayId: stopSheet.dayId,
                      stopId: stopSheet.id,
                    })
                : undefined
            }
          />
        );
      })()}

      {locationPicker && (() => {
        const pickerDay = days.find((d) => d.id === locationPicker.dayId);
        if (!pickerDay) return null;
        const pickerStop =
          locationPicker.target === "stop"
            ? (pickerDay.stops || []).find((s) => s.id === locationPicker.stopId)
            : null;
        if (locationPicker.target === "stop" && !pickerStop) return null;
        return (
          <LocationPicker
            open
            target={locationPicker.target}
            day={pickerDay}
            stop={pickerStop}
            onClose={() => setLocationPicker(null)}
            onSaved={async () => {
              const data = await refresh();
              if (daySheet?.id) {
                const updated = (data.days || []).find((x) => x.id === daySheet.id);
                if (updated) {
                  setDaySheet((s) =>
                    s
                      ? {
                          ...s,
                          stops: updated.stops,
                          values: {
                            ...s.values,
                            stay_label: updated.stay_label || s.values.stay_label,
                          },
                        }
                      : s,
                  );
                }
              }
            }}
          />
        );
      })()}
    </div>
  );
}

function ImportProgressOverlay({ progress }) {
  const pct = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  const hasSteps = progress.total > 0 && progress.current > 0;
  const tips = useMemo(
    () => [
      "Los planes largos se convierten de a dos días para no truncar la AI.",
      "Podés completar la fecha ancla después del import.",
      "El export .md es determinístico: no vuelve a pasar por la AI.",
    ],
    [],
  );
  const tip = tips[Math.floor(pct / 34) % tips.length];

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      role="alertdialog"
      aria-busy="true"
      aria-live="polite"
      aria-label="Progreso de importación"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "min(100%, 420px)",
          background: C.surfaceContainer,
          border: `1px solid ${C.outlineVariant}`,
          borderRadius: 16,
          padding: "20px 18px 18px",
          boxShadow: C.elevation2,
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: 1.2, color: C.onSurfaceVariant, textTransform: "uppercase", marginBottom: 6 }}>
          Importando plan
        </div>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.onSurface, marginBottom: 6, lineHeight: 1.3 }}>
          {progress.message}
        </div>
        {progress.detail ? (
          <div style={{ fontSize: 13, color: C.onSurfaceVariant, marginBottom: 14, lineHeight: 1.45 }}>
            {progress.detail}
          </div>
        ) : (
          <div style={{ height: 14, marginBottom: 14 }} />
        )}

        <div
          style={{
            height: 10,
            borderRadius: 999,
            background: C.surfaceContainerHigh,
            overflow: "hidden",
            marginBottom: 8,
          }}
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: C.primary,
              borderRadius: 999,
              transition: "width 0.35s ease",
            }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.onSurfaceVariant, marginBottom: 12 }}>
          <span>{hasSteps ? `Bloque ${progress.current} de ${progress.total}` : progress.phase || "en curso"}</span>
          <span style={{ fontWeight: 700, color: C.onSurface }}>{Math.round(pct)}%</span>
        </div>
        <div style={{ fontSize: 12, color: C.onSurfaceVariant, lineHeight: 1.45, borderTop: `1px solid ${C.outlineVariant}`, paddingTop: 12 }}>
          {tip}
        </div>
      </div>
    </div>
  );
}

function ItineraryDaySheet({
  sheet,
  day,
  theme = "light",
  busy,
  anchorDate,
  onChangeValues,
  onSave,
  onClose,
  onAddStop,
  onEditStop,
  onLocateStop,
  onLocateStay,
  onLocatePending,
  onMoveStop,
  onDeleteStop,
  onToggleStopDone,
}) {
  const v = sheet.values;
  const cal = calendarForDay(anchorDate, Number(v.day_number));
  const isEdit = sheet.mode === "edit";
  const isDesktop = useIsDesktop();
  const [pane, setPane] = useState("list");
  const stops = [...(sheet.stops || [])].sort((a, b) => a.sort_order - b.sort_order);
  const locateBtn = {
    ...S.secondary,
    minHeight: 44,
    minWidth: 44,
    padding: "6px 10px",
    marginTop: 0,
    fontSize: 12,
  };
  const mapDay = useMemo(() => {
    if (!isEdit) return null;
    const base = day || {};
    return {
      ...base,
      day_number: Number(v.day_number) || base.day_number,
      title: v.title ?? base.title,
      base: v.base ?? base.base,
      stay_label: v.stay_label ?? base.stay_label,
      hub: v.hub ?? base.hub,
      notes: v.notes ?? base.notes,
      stops: sheet.stops || base.stops || [],
    };
  }, [isEdit, day, v, sheet.stops]);
  const showMap = !!mapDay;
  const showListPane = isDesktop || pane === "list" || !showMap;
  const showMapPane = showMap && (isDesktop || pane === "map");

  useEffect(() => {
    setPane("list");
  }, [sheet.id, sheet.mode]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [busy, onClose]);

  const listBody = (
    <>
      {[
        ["day_number", "Número de día", "number"],
        ["title", "Título (ej. Oeste hub Ikebukuro)", "text"],
        ["base", "Base / ciudad", "text"],
        ["stay_label", "Dónde dormís", "text"],
        ["hub", "Hub logístico", "text"],
      ].map(([k, label, type]) => {
        const id = `day-field-${sheet.id || "new"}-${k}`;
        return (
          <div key={k}>
            <label
              htmlFor={id}
              style={{ display: "block", fontSize: 11, color: C.onSurfaceVariant, margin: "2px 0 4px" }}
            >
              {label}
            </label>
            <input
              id={id}
              name={k}
              style={{ ...S.input, marginBottom: 10 }}
              type={type}
              value={v[k] || ""}
              disabled={busy}
              onChange={(e) => onChangeValues({ ...v, [k]: e.target.value })}
            />
          </div>
        );
      })}
      <label
        htmlFor={`day-notes-${sheet.id || "new"}`}
        style={{ display: "block", fontSize: 11, color: C.onSurfaceVariant, margin: "2px 0 4px" }}
      >
        Notas del día
      </label>
      <textarea
        id={`day-notes-${sheet.id || "new"}`}
        name="notes"
        style={{ ...S.input, minHeight: 80, resize: "vertical", marginBottom: 14 }}
        value={v.notes || ""}
        disabled={busy}
        onChange={(e) => onChangeValues({ ...v, notes: e.target.value })}
      />

      {isEdit && onLocateStay && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.onSurfaceVariant, marginBottom: 6 }}>Ubicación del alojamiento</div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <LocationBadge
              mode={stayLocationMode(day)}
              precision={day?.stay_precision}
              kind="stay"
            />
            <a
              href={mapsSearch(stayLodgingSearchQuery(day))}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...locateBtn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}
            >
              Buscar alojamientos
            </a>
            <button type="button" style={locateBtn} disabled={busy} onClick={onLocateStay}>
              {locateCtaLabel(stayLocationMode(day) === "coords", "stay")}
            </button>
          </div>
          {stayLocationMode(day) !== "coords" && (
            <div style={{ fontSize: 12, color: C.onSurfaceVariant, marginTop: 6, lineHeight: 1.4 }}>
              Falta el pin de donde dormís. La parada del hotel no lo marca.
            </div>
          )}
        </div>
      )}

      {isEdit && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Paradas</div>
            <button type="button" style={{ ...S.secondary, minHeight: 44, padding: "6px 10px" }} disabled={busy} onClick={onAddStop}>+ Parada</button>
          </div>
          {stops.length === 0 && <Empty text="Sin paradas. Agregá la primera." />}
          {stops.map((stop, i) => {
            const stopResolved = isLocationResolved(stop, day);
            const stopLabel = (action) => (stop.name ? `${action}: ${stop.name}` : action);
            return (
            <div key={stop.id} style={{ borderBottom: `1px solid ${C.outlineVariant}`, padding: "10px 0" }}>
              <div style={{ display: "flex", gap: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, textDecoration: stop.done ? "line-through" : "none" }}>
                      {stop.kind === "hub_out" ? "Salida: " : stop.kind === "hub_back" ? "Regreso: " : `${i + 1}. `}{stop.name}
                    </div>
                    <LocationBadge
                      mode={stop.location_mode}
                      precision={stop.location_precision}
                      kind="stop"
                    />
                  </div>
                  {stop.lat != null && stop.lng != null && (
                    <div style={{ fontSize: 12, color: C.onSurfaceVariant, marginTop: 2, fontFamily: "var(--font-mono)" }}>
                      {stop.lat}, {stop.lng}
                    </div>
                  )}
                  <Meta>{[stop.how_to_get, stop.est_duration, stop.detail].filter(Boolean).join(" · ")}</Meta>
                </div>
                <button type="button" aria-label={stopLabel("Subir parada")} style={{ ...S.ghost, minWidth: 44, minHeight: 44 }} disabled={busy || i === 0} onClick={() => onMoveStop(stop, -1)}>↑</button>
                <button type="button" aria-label={stopLabel("Bajar parada")} style={{ ...S.ghost, minWidth: 44, minHeight: 44 }} disabled={busy || i === stops.length - 1} onClick={() => onMoveStop(stop, 1)}>↓</button>
                <button type="button" aria-label={stopLabel("Parada hecha")} aria-pressed={!!stop.done} style={{ ...S.ghost, minWidth: 44, minHeight: 44 }} disabled={busy} onClick={() => onToggleStopDone(stop)}>{stop.done ? "✓" : "○"}</button>
                <button type="button" aria-label={stopLabel("Editar parada")} style={{ ...S.ghost, minWidth: 44, minHeight: 44 }} disabled={busy} onClick={() => onEditStop(stop)}>✎</button>
                <button type="button" aria-label={stopLabel("Eliminar parada")} style={{ ...S.ghost, minWidth: 44, minHeight: 44 }} disabled={busy} onClick={() => onDeleteStop(stop)}>✕</button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                {onLocateStop && (
                  <button type="button" style={locateBtn} disabled={busy} onClick={() => onLocateStop(stop)}>
                    {locateCtaLabel(stopResolved, "stop")}
                  </button>
                )}
              </div>
              <StopMapsLinks stop={stop} day={day || v} stops={stops} index={i} />
            </div>
            );
          })}
        </>
      )}
      {!isEdit && (
        <div style={{ fontSize: 12, color: C.onSurfaceVariant, marginBottom: 8 }}>
          Guardá el día para poder agregar paradas.
        </div>
      )}
    </>
  );

  return (
    <div
      role="presentation"
      onClick={() => !busy && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: isDesktop ? "center" : "flex-end",
        justifyContent: "center",
        ...(isDesktop ? { padding: 24 } : {}),
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="day-sheet-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: isDesktop && showMap ? "min(100%, 1080px)" : isDesktop ? "min(100%, 640px)" : 520,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          background: C.surfaceContainer,
          borderRadius: isDesktop ? 16 : "16px 16px 0 0",
          boxShadow: C.elevation2,
          paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "14px 16px", borderBottom: `1px solid ${C.outlineVariant}` }}>
          <div id="day-sheet-title" style={{ fontWeight: 700, fontSize: 16, minWidth: 0 }}>
            {isEdit ? `Día ${v.day_number}${cal ? ` · ${cal}` : ""}` : "Nuevo día"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {showMap && !isDesktop && (
              <ListaMapaToggle value={pane} onChange={setPane} />
            )}
            <button type="button" style={S.ghost} onClick={onClose} disabled={busy} aria-label="Cerrar">✕</button>
          </div>
        </div>
        <div
          data-day-pane-layout={isDesktop && showMap ? "split" : "stack"}
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: isDesktop && showMap ? "row" : "column",
            overflow: "hidden",
          }}
        >
          {showListPane && (
            <div
              style={{
                flex: 1,
                minWidth: 0,
                overflowY: "auto",
                padding: "12px 16px",
                WebkitOverflowScrolling: "touch",
              }}
            >
              {listBody}
            </div>
          )}
          {showMapPane && (
            <div
              data-day-map-pane
              style={{
                flex: isDesktop ? "0 0 46%" : 1,
                minWidth: isDesktop ? 280 : 0,
                overflowY: "auto",
                padding: isDesktop ? "12px 16px 12px 8px" : "12px 16px",
                borderLeft: isDesktop ? `1px solid ${C.outlineVariant}` : undefined,
                position: isDesktop ? "sticky" : undefined,
                top: 0,
                alignSelf: isDesktop ? "stretch" : undefined,
                WebkitOverflowScrolling: "touch",
              }}
            >
              <DayMap
                day={mapDay}
                theme={theme}
                height={isDesktop ? "min(56vh, 480px)" : "min(55vh, 420px)"}
                onLocatePending={onLocatePending}
                onLocateStop={onLocateStop}
                onLocateStay={onLocateStay}
              />
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, padding: "10px 16px 4px", borderTop: `1px solid ${C.outlineVariant}` }}>
          <button type="button" style={{ ...S.secondary, flex: 1, marginTop: 0 }} disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="button" style={{ ...S.primary, flex: 1.4, marginTop: 0 }} disabled={busy} onClick={onSave}>
            {busy ? "Guardando…" : "Guardar día"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ItineraryStopSheet({ sheet, stop = null, day = null, busy, onChange, onSave, onClose, onLocate }) {
  const v = sheet.values;
  const isDesktop = useIsDesktop();
  const stopResolved = stop ? isLocationResolved(stop, day) : false;
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div
      role="presentation"
      onClick={() => !busy && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: isDesktop ? "center" : "flex-end",
        justifyContent: "center",
        ...(isDesktop ? { padding: 24 } : {}),
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stop-sheet-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: isDesktop ? "min(100%, 640px)" : 520,
          maxHeight: "85vh",
          overflowY: "auto",
          background: C.surfaceContainer,
          borderRadius: isDesktop ? 16 : "16px 16px 0 0",
          padding: "16px 16px max(16px, env(safe-area-inset-bottom))",
          boxShadow: C.elevation2,
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <div id="stop-sheet-title" style={{ fontWeight: 700, fontSize: 16 }}>
            {sheet.mode === "edit" ? "Editar parada" : "Nueva parada"}
          </div>
          {stop && (
            <LocationBadge
              mode={stop.location_mode}
              precision={stop.location_precision}
              kind="stop"
            />
          )}
        </div>
        {[
          ["name", "Nombre"],
          ["detail", "Detalle"],
          ["how_to_get", "Cómo llegar"],
          ["est_duration", "Est. en sitio"],
          ["notes", "Notas / reserva"],
        ].map(([k, label]) => {
          const id = `stop-field-${sheet.id || "new"}-${k}`;
          return (
            <div key={k}>
              <label
                htmlFor={id}
                style={{ display: "block", fontSize: 11, color: C.onSurfaceVariant, marginBottom: 4 }}
              >
                {label}
              </label>
              <input
                id={id}
                name={k}
                style={{ ...S.input, marginBottom: 10 }}
                value={v[k] || ""}
                disabled={busy}
                onChange={(e) => onChange({ ...v, [k]: e.target.value })}
              />
            </div>
          );
        })}
        <label htmlFor="stop-field-kind" style={{ display: "block", fontSize: 11, color: C.onSurfaceVariant, marginBottom: 4 }}>Tipo</label>
        <select
          id="stop-field-kind"
          name="kind"
          style={{ ...S.input, marginBottom: 14 }}
          value={v.kind || "stop"}
          disabled={busy}
          onChange={(e) => onChange({ ...v, kind: e.target.value })}
        >
          <option value="stop">Parada</option>
          <option value="hub_out">Salida hub</option>
          <option value="hub_back">Retorno hub</option>
        </select>
        {onLocate && (
          <button
            type="button"
            style={{ ...S.secondary, width: "100%", minHeight: 44, marginBottom: 12, marginTop: 0 }}
            disabled={busy}
            onClick={onLocate}
          >
            {locateCtaLabel(stopResolved, "stop")}
          </button>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={{ ...S.secondary, flex: 1, marginTop: 0, minHeight: 44 }} disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="button" style={{ ...S.primary, flex: 1.4, marginTop: 0, minHeight: 44 }} disabled={busy} onClick={onSave}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================= ASISTENTE AI (Fase 2 — historial en server) ================= */
const SESSION_AI_OPTIONS = [
  { value: "deepseek", label: "DeepSeek" },
  { value: "google", label: "Google" },
];

function Asistente({ sessions, setSessions }) {
  const isDesktop = useIsDesktop();
  const [mode, setMode] = useState("planificar");
  const [activeId, setActiveId] = useState(sessions[0]?.id || null);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [exportText, setExportText] = useState(null);
  const [copied, setCopied] = useState(false);
  const [copiedMsgKey, setCopiedMsgKey] = useState(null);
  const [importing, setImporting] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [nameSheet, setNameSheet] = useState(null);
  /** Preferencia al crear sesión nueva (default DeepSeek). */
  const [draftAiProvider, setDraftAiProvider] = useState("deepseek");
  const bottomRef = useRef(null);
  const importRef = useRef(null);
  const [askConfirm, confirmNode] = useConfirmDialog();

  const active = sessions.find((s) => s.id === activeId) || null;
  const currentSession =
    mode === "consultar"
      ? sessions.find((s) => s.mode === "consultar") || null
      : active?.mode === "planificar"
        ? active
        : null;
  const sessionAiProvider = currentSession?.ai_provider === "google" ? "google" : (currentSession ? "deepseek" : draftAiProvider);

  const refreshSessions = async () => {
    const list = await api.listSessions();
    setSessions(list);
    return list;
  };

  const loadMessages = async (id) => {
    if (!id) { setMsgs([]); return; }
    const data = await api.getMessages(id);
    setMsgs((data.messages || []).map((m) => ({ role: m.role, content: m.content, id: m.id })));
  };

  useEffect(() => {
    if (mode !== "planificar") return;
    const selectedIsPlan = sessions.some((s) => s.id === activeId && s.mode === "planificar");
    if (!selectedIsPlan) {
      setActiveId(sessions.find((s) => s.mode === "planificar")?.id || null);
    }
  }, [activeId, mode, sessions]);

  useEffect(() => {
    if (mode === "planificar" && active?.mode === "planificar") {
      loadMessages(activeId).catch((e) => setError(e.message));
    }
    if (mode === "consultar") setMsgs([]);
  }, [activeId, mode]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  const ensureSession = async (desiredMode) => {
    if (desiredMode === "consultar") {
      let consult = sessions.find((s) => s.mode === "consultar");
      if (!consult) {
        consult = await api.createSession({
          mode: "consultar",
          name: "Consultar plan",
          ai_provider: draftAiProvider === "google" ? "google" : "deepseek",
        });
        await refreshSessions();
      }
      setActiveId(consult.id);
      return consult.id;
    }
    if (activeId) {
      const cur = sessions.find((s) => s.id === activeId);
      if (cur && cur.mode === "planificar") return activeId;
    }
    const plan = sessions.find((s) => s.mode === "planificar");
    if (plan) {
      setActiveId(plan.id);
      return plan.id;
    }
    const created = await api.createSession({
      mode: "planificar",
      ai_provider: draftAiProvider === "google" ? "google" : "deepseek",
    });
    await refreshSessions();
    setActiveId(created.id);
    return created.id;
  };

  const onChangeSessionAi = async (next) => {
    const provider = next === "google" ? "google" : "deepseek";
    setDraftAiProvider(provider);
    if (!currentSession) return;
    setSessionBusy(true);
    setError(null);
    try {
      await api.updateSession(currentSession.id, { ai_provider: provider });
      await refreshSessions();
    } catch (e) {
      setError(e.message);
    } finally {
      setSessionBusy(false);
    }
  };

  const openNewSession = () => {
    setNameSheet({ kind: "create", name: "" });
  };

  const saveSessionName = async (name) => {
    setSessionBusy(true);
    setError(null);
    try {
      if (nameSheet?.kind === "create") {
        const s = await api.createSession({
          mode: "planificar",
          name,
          ai_provider: draftAiProvider === "google" ? "google" : "deepseek",
        });
        await refreshSessions();
        setMode("planificar");
        setActiveId(s.id);
        setMsgs([]);
      } else if (nameSheet?.sessionId) {
        await api.renameSession(nameSheet.sessionId, name);
        await refreshSessions();
      }
      setNameSheet(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSessionBusy(false);
    }
  };

  const resetSession = async () => {
    if (!currentSession) return;
    const ok = await askConfirm({
      title: "Limpiar memoria",
      message: `¿Limpiar la memoria de “${currentSession.name}”?\n\nSe borrarán todos sus mensajes y el resumen de contexto. La sesión seguirá existiendo.`,
      confirmLabel: "Limpiar",
      danger: true,
    });
    if (!ok) return;
    setSessionBusy(true);
    setError(null);
    try {
      await api.resetSession(currentSession.id);
      setMsgs([]);
      await refreshSessions();
    } catch (e) {
      setError(e.message);
    } finally {
      setSessionBusy(false);
    }
  };

  const deleteCurrentSession = async () => {
    if (mode !== "planificar" || !currentSession || currentSession.mode !== "planificar") return;
    const ok = await askConfirm({
      title: "Eliminar sesión",
      message: `¿Eliminar “${currentSession.name}”?\n\nEsta acción borra la sesión y todos sus mensajes de forma permanente.`,
      confirmLabel: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    setSessionBusy(true);
    setError(null);
    try {
      await api.deleteSession(currentSession.id);
      const list = await refreshSessions();
      const next = list.find((s) => s.mode === "planificar") || null;
      setActiveId(next?.id || null);
      setMsgs([]);
    } catch (e) {
      setError(e.message);
    } finally {
      setSessionBusy(false);
    }
  };

  const openExport = async () => {
    const sid = currentSession?.id || (await ensureSession(mode));
    const payload = await api.exportSession(sid);
    setCopied(false);
    setExportText(JSON.stringify(payload, null, 2));
  };

  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied(true);
    } catch {
      const ta = document.getElementById("export-ta");
      if (ta) { ta.focus(); ta.select(); try { document.execCommand("copy"); setCopied(true); } catch { /* */ } }
    }
  };

  const downloadExport = () => {
    try {
      const blob = new Blob([exportText], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nihon-planner-${(currentSession?.name || "sesion").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { /* */ }
  };

  const onImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (payload["jp:expenses"] || payload["jp:itinerary"]) {
        throw new Error(
          "Ese archivo es un respaldo de viaje. Restauralo con «Importar viaje» en la pestaña Plan.",
        );
      }
      if (!payload.herramienta && !payload.tipo && !payload.sesion && !payload["jp:sessions"]) {
        throw new Error("JSON no parece un export de Nihon Planner");
      }
      const res = await api.importData(payload);
      const list = await refreshSessions();
      const importedId = payload.sesion?.id || payload.sesiones?.[0]?.id;
      const match = list.find((s) => s.id === importedId) || list.find((s) => s.mode === "planificar");
      if (match) {
        setMode("planificar");
        setActiveId(match.id);
        await loadMessages(match.id);
      }
      const n = res?.imported?.sessions ?? 0;
      if (!n && !match) throw new Error("No se importó ninguna sesión");
    } catch (err) {
      setError(err.message || "Error al importar");
    } finally {
      setImporting(false);
    }
  };

  const copyMessage = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsgKey(key);
      setTimeout(() => setCopiedMsgKey((k) => (k === key ? null : k)), 1600);
    } catch {
      setError("No se pudo copiar al portapapeles");
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    try {
      const sid = await ensureSession(mode);
      const res = await api.chat(sid, text);
      setMsgs((m) => [...m, { role: "assistant", content: res.message.content, id: res.message.id }]);
      await refreshSessions();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const planSessions = sessions.filter((s) => s.mode === "planificar");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: isDesktop ? "calc(100vh - 170px)" : "calc(100vh - 190px)" }}>
      {confirmNode}
      <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button style={{ ...S.chip, ...(mode === "planificar" ? S.chipOn : {}) }} onClick={() => setMode("planificar")}>Planificar</button>
        <button style={{ ...S.chip, ...(mode === "consultar" ? S.chipOn : {}) }} onClick={() => setMode("consultar")}>Consultar plan</button>
        <div style={{ flex: 1 }} />
        {mode === "planificar" && <button style={S.secondary} onClick={openNewSession}>+ Nueva sesión</button>}
        <button style={S.secondary} onClick={() => importRef.current?.click()} disabled={importing}>
          {importing ? "Importando…" : "Importar"}
        </button>
        <input ref={importRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={onImportFile} />
        <button style={S.secondary} onClick={openExport}>Exportar</button>
      </div>

      {exportText !== null && (
        <div style={{ background: C.card, border: `1px solid ${C.accent}`, borderRadius: 14, padding: 12, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ ...S.label, marginBottom: 0 }}>Exportar JSON</span>
            <button style={S.ghost} onClick={() => setExportText(null)} aria-label="Cerrar">✕</button>
          </div>
          <textarea id="export-ta" readOnly value={exportText}
            style={{ ...S.input, height: 140, fontFamily: "monospace", fontSize: 11, resize: "vertical" }}
            onFocus={(e) => e.target.select()} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={S.secondary} onClick={copyExport}>{copied ? "✓ Copiado" : "Copiar"}</button>
            <button style={S.secondary} onClick={downloadExport}>Descargar .json</button>
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          padding: 8,
          marginBottom: 8,
          background: C.surfaceContainer,
          border: `1px solid ${C.outlineVariant}`,
          borderRadius: 12,
        }}
      >
        {mode === "planificar" ? (
          planSessions.length > 0 ? (
            <select
              aria-label="Sesión activa"
              style={{ ...S.input, flex: "1 1 180px", marginBottom: 0, minHeight: 44, alignSelf: "center" }}
              value={currentSession?.id || ""}
              onChange={(e) => setActiveId(e.target.value)}
            >
              {planSessions.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.message_count || 0} msj)</option>
              ))}
            </select>
          ) : (
            <span style={{ flex: 1, color: C.onSurfaceVariant, fontSize: 13, alignSelf: "center" }}>Todavía no hay sesiones de planificación.</span>
          )
        ) : (
          <div style={{ flex: "1 1 180px", minWidth: 0, alignSelf: "center" }}>
            <div style={{ color: C.onSurface, fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {currentSession?.name || "Consultar plan"}
            </div>
            <div style={{ color: C.onSurfaceVariant, fontSize: 11 }}>
              {currentSession ? `${currentSession.message_count || 0} mensajes` : "La sesión se creará con tu primera consulta"}
            </div>
          </div>
        )}
        <select
          aria-label="Modelo AI de la sesión"
          title="Modelo AI"
          style={{ ...S.input, flex: "0 1 140px", minWidth: 120, marginBottom: 0, minHeight: 44, alignSelf: "center" }}
          value={sessionAiProvider}
          disabled={sessionBusy || busy}
          onChange={(e) => onChangeSessionAi(e.target.value)}
        >
          {SESSION_AI_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          type="button"
          style={{ ...S.secondary, alignSelf: "center" }}
          disabled={!currentSession || sessionBusy}
          onClick={() => setNameSheet({ kind: "rename", sessionId: currentSession.id, name: currentSession.name })}
        >
          Renombrar
        </button>
        <button type="button" style={{ ...S.secondary, alignSelf: "center" }} disabled={!currentSession || sessionBusy} onClick={resetSession}>
          Limpiar memoria
        </button>
        {mode === "planificar" && (
          <button
            type="button"
            style={{ ...S.secondary, color: C.error, borderColor: C.error, alignSelf: "center" }}
            disabled={!currentSession || sessionBusy}
            onClick={deleteCurrentSession}
          >
            Eliminar
          </button>
        )}
      </div>

      {nameSheet && (
        <SessionNameSheet
          key={`${nameSheet.kind}-${nameSheet.sessionId || "new"}`}
          kind={nameSheet.kind}
          initialName={nameSheet.name}
          busy={sessionBusy}
          onSave={saveSessionName}
          onClose={() => !sessionBusy && setNameSheet(null)}
        />
      )}

      <div style={{ flex: 1, overflowY: "auto", background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 12 }}>
        {msgs.length === 0 && (
          <Empty text={mode === "planificar"
            ? "Preguntame por rutas, itinerarios, JR Pass, Daikoku PA… La memoria queda en el server."
            : "Consultá sobre lo ya cargado: gastos, reservas, documentación. Respondo solo con tus datos."} />
        )}
        {msgs.map((m, i) => {
          const key = m.id ?? `${m.role}-${i}`;
          const isAssistant = m.role === "assistant";
          return (
            <div key={key} style={{ display: "flex", justifyContent: isAssistant ? "flex-start" : "flex-end", marginBottom: 10 }}>
              <div style={{
                maxWidth: isDesktop ? "72%" : "92%",
                position: "relative",
                padding: isAssistant ? "10px 14px 12px" : "10px 14px",
                borderRadius: isAssistant ? "16px 16px 16px 4px" : "16px 16px 4px 16px",
                fontSize: 14, lineHeight: 1.5,
                whiteSpace: isAssistant ? "normal" : "pre-wrap",
                background: isAssistant ? C.surfaceContainer : C.primary,
                color: isAssistant ? C.onSurface : C.onPrimary,
                border: isAssistant ? `1px solid ${C.outlineVariant}` : "none",
                boxShadow: C.elevation1,
              }}>
                {isAssistant && (
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4, marginTop: -2 }}>
                    <button
                      type="button"
                      onClick={() => copyMessage(key, m.content)}
                      title={copiedMsgKey === key ? "Copiado" : "Copiar respuesta"}
                      aria-label="Copiar respuesta del asistente"
                      style={{
                        ...S.ghost,
                        minHeight: 32,
                        minWidth: 32,
                        padding: 4,
                        color: copiedMsgKey === key ? C.primary : C.onSurfaceVariant,
                        opacity: 0.85,
                      }}
                    >
                      {copiedMsgKey === key ? (
                        <span style={{ fontSize: 12, fontWeight: 700 }}>✓</span>
                      ) : (
                        <CopyIcon size={15} />
                      )}
                    </button>
                  </div>
                )}
                {isAssistant
                  ? <Markdown content={m.content} C={C} />
                  : m.content}
              </div>
            </div>
          );
        })}
        {busy && <div style={{ color: C.soft, fontSize: 13, padding: 8 }}>考え中… pensando</div>}
        {error && <div style={S.warn}>Error: {error}</div>}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input style={{ ...S.input, flex: 1, marginBottom: 0 }} placeholder={mode === "planificar" ? "¿Cuántos días en Kyoto?" : "¿Qué reservas me faltan confirmar?"}
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()} />
        <button style={{ ...S.primary, width: "auto", padding: "0 18px", marginTop: 0, minHeight: 44 }} onClick={send} disabled={busy}>➤</button>
      </div>
    </div>
  );
}

function SessionNameSheet({ kind, initialName, busy, onSave, onClose }) {
  const isDesktop = useIsDesktop();
  const [name, setName] = useState(initialName || "");
  const inputRef = useRef(null);
  const isCreate = kind === "create";

  useEffect(() => {
    inputRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const submit = (event) => {
    event.preventDefault();
    const clean = name.trim();
    if (clean && !busy) onSave(clean);
  };

  return (
    <div
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: isDesktop ? "center" : "flex-end",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.58)",
        padding: isDesktop ? 24 : "12px 12px 0",
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-name-title"
        onSubmit={submit}
        style={{
          width: "min(100%, 480px)",
          padding: "20px 18px max(20px, env(safe-area-inset-bottom))",
          background: C.surfaceContainer,
          border: `1px solid ${C.outlineVariant}`,
          borderRadius: isDesktop ? 16 : "20px 20px 0 0",
          boxShadow: C.elevation2,
        }}
      >
        <div id="session-name-title" style={{ color: C.onSurface, fontSize: 18, fontWeight: 800, marginBottom: 6 }}>
          {isCreate ? "Nueva sesión" : "Renombrar sesión"}
        </div>
        <div style={{ color: C.onSurfaceVariant, fontSize: 13, lineHeight: 1.45, marginBottom: 16 }}>
          Usá un nombre que te permita reconocer rápidamente el tema de esta conversación.
        </div>
        <label style={{ ...S.label, display: "block" }} htmlFor="session-name-input">Nombre</label>
        <input
          ref={inputRef}
          id="session-name-input"
          style={{ ...S.input, marginBottom: 6 }}
          value={name}
          maxLength={80}
          placeholder="Ej. Itinerario Tokio y Kyoto"
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
          required
        />
        <div style={{ color: C.onSurfaceVariant, fontSize: 11, textAlign: "right", marginBottom: 16 }}>
          {name.length}/80
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={{ ...S.secondary, flex: 1 }} onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" style={{ ...S.primary, flex: 1, marginTop: 0 }} disabled={!name.trim() || busy}>
            {busy ? "Guardando…" : isCreate ? "Crear sesión" : "Guardar nombre"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ================= átomos ================= */
function Card({ children, style }) {
  return <div style={{ ...S.card, ...style }}>{children}</div>;
}
function Row({ k, v, accent }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 14 }}>
      <span style={{ color: C.soft }}>{k}</span>
      <span style={{ fontWeight: 600, color: accent ? C.hanko : C.ink }}>{v}</span>
    </div>
  );
}
function Empty({ text }) {
  return <div style={{ color: C.soft, fontSize: 13, padding: "10px 0", lineHeight: 1.5 }}>{text}</div>;
}
function Meta({ children }) {
  return <div style={{ fontSize: 12, color: C.soft, marginTop: 2 }}>{children}</div>;
}
function AddInline({ placeholder, onAdd }) {
  const [v, setV] = useState("");
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
      <input style={{ ...S.input, flex: 1, marginBottom: 0 }} placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && v.trim()) { onAdd(v.trim()); setV(""); } }} />
      <button style={{ ...S.secondary }} onClick={() => { if (v.trim()) { onAdd(v.trim()); setV(""); } }}>+</button>
    </div>
  );
}

/* estilos: ver buildStyles() en theme.js */
