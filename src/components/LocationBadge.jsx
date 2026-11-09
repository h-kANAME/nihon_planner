import {
  formatLocationProgressLabel,
  locationProgressTone,
  resolveLocationBadge,
} from "../lib/locations.js";

/** @typedef {'accent'|'warn'|'muted'} BadgeTone */

const TONE_STYLE = {
  accent: {
    background: "var(--accent-soft)",
    color: "var(--accent-text)",
    border: "1px solid color-mix(in srgb, var(--accent) 35%, var(--border))",
  },
  warn: {
    background: "var(--warn-soft)",
    color: "var(--warn-text)",
    border: "1px solid color-mix(in srgb, var(--warn) 35%, var(--border))",
  },
  muted: {
    background: "var(--bg-sunken)",
    color: "var(--fg-muted)",
    border: "1px solid var(--border)",
  },
};

const CHIP_BASE = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
  minHeight: 32,
  minWidth: 44,
  padding: "6px 12px",
  borderRadius: "var(--radius-pill)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--fs-micro)",
  fontWeight: 500,
  letterSpacing: "0.02em",
  lineHeight: 1.2,
  whiteSpace: "nowrap",
  touchAction: "manipulation",
};

/**
 * Chip de estado de ubicación: Pendiente · Ubicada · Heredada · No aplica · Aproximada.
 *
 * @param {{
 *   mode?: string|null,
 *   precision?: string|null,
 *   kind?: 'stop'|'stay',
 *   className?: string,
 *   style?: object,
 * }} props
 */
export function LocationBadge({ mode, precision, kind = "stop", className, style }) {
  const state = resolveLocationBadge({ mode, precision, kind });
  const tone = TONE_STYLE[/** @type {BadgeTone} */ (state.tone)] || TONE_STYLE.muted;

  return (
    <span
      role="status"
      aria-label={`Ubicación: ${state.label}`}
      data-location-badge={state.key}
      data-tone={state.tone}
      className={className}
      style={{
        ...CHIP_BASE,
        ...tone,
        ...style,
      }}
    >
      {state.label}
    </span>
  );
}

/**
 * Badge de progreso por día en Plan: `6/8 ubicadas` (§8.3).
 * @param {{
 *   progress: { total: number, resolved: number, pending: number },
 *   className?: string,
 *   style?: object,
 * }} props
 */
export function LocationProgressBadge({ progress, className, style }) {
  const toneKey = locationProgressTone(progress);
  const tone = TONE_STYLE[toneKey] || TONE_STYLE.muted;
  const label = formatLocationProgressLabel(progress);

  return (
    <span
      role="status"
      aria-label={label}
      data-location-progress={`${progress?.resolved ?? 0}/${progress?.total ?? 0}`}
      data-tone={toneKey}
      className={className}
      style={{
        ...CHIP_BASE,
        ...tone,
        ...style,
      }}
    >
      {label}
    </span>
  );
}

export default LocationBadge;
export { resolveLocationBadge };
