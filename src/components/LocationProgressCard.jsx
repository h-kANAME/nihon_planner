import { C, S } from "../theme";
import {
  formatGlobalLocationProgress,
  locationProgressPercent,
  locationProgressTone,
} from "../lib/locations.js";

/** @typedef {{ total?: number, resolved?: number, pending?: number }} LocationProgress */

const BAR_FILL = {
  accent: "var(--accent)",
  warn: "var(--warn)",
  muted: "var(--fg-muted)",
};

/**
 * Card Resumen §8.3: progreso global desde `dashboard.itinerary.locations`.
 * Un solo job: mostrar % / resolved/total y CTA opcional a Plan (pendientes).
 *
 * @param {{
 *   locations?: LocationProgress|null,
 *   onLocatePending?: () => void,
 *   style?: object,
 * }} props
 */
export function LocationProgressCard({ locations, onLocatePending, style }) {
  const progress = {
    total: Number(locations?.total) || 0,
    resolved: Number(locations?.resolved) || 0,
    pending: Number(locations?.pending) || 0,
  };
  const pct = locationProgressPercent(progress);
  const tone = locationProgressTone(progress);
  const fill = BAR_FILL[tone] || BAR_FILL.muted;
  const summary = formatGlobalLocationProgress(progress);
  const showCta = progress.pending > 0 && typeof onLocatePending === "function";

  return (
    <div style={{ ...S.card, ...style }} data-location-progress-card>
      <div style={S.label}>Ubicaciones</div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
          marginTop: 4,
        }}
      >
        <span
          style={{ fontSize: 34, fontWeight: 700, color: C.ink, fontVariantNumeric: "tabular-nums" }}
          aria-hidden={progress.total === 0}
        >
          {progress.total === 0 ? "—" : `${pct}%`}
        </span>
        <span style={{ fontSize: 14, color: C.soft }}>{summary}</span>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={summary}
        style={{
          height: 6,
          background: C.line,
          borderRadius: 3,
          marginTop: 12,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: 6,
            width: `${pct}%`,
            background: fill,
            borderRadius: 3,
            transition: "width 200ms ease",
          }}
        />
      </div>

      {showCta && (
        <button
          type="button"
          style={{ ...S.ghost, marginTop: 10, fontSize: 13 }}
          onClick={onLocatePending}
        >
          Ubicar pendientes →
        </button>
      )}
    </div>
  );
}

export default LocationProgressCard;
