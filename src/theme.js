/**
 * Runtime theme bridge → brand_app (SoT).
 * Tokens canónicos: brand_app/tokens.json + tokens.css
 * Inline styles (C/S) mapean semántica brand; Tailwind consume las mismas CSS vars.
 */

export const fonts = {
  display: "'Space Grotesk', system-ui, -apple-system, sans-serif",
  body: "'IBM Plex Sans', system-ui, -apple-system, sans-serif",
  mono: "'IBM Plex Mono', 'SF Mono', Consolas, monospace",
};

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
};

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const type = {
  display: { fontSize: 28, fontWeight: 600, letterSpacing: -0.5, lineHeight: 1.08 },
  title: { fontSize: 22, fontWeight: 600, letterSpacing: -0.4, lineHeight: 1.2 },
  body: { fontSize: 15, fontWeight: 400, lineHeight: 1.55 },
  label: { fontSize: 11, fontWeight: 600, letterSpacing: 1.6, lineHeight: 1.3 },
  caption: { fontSize: 12, fontWeight: 400, lineHeight: 1.4 },
};

/** Paletas alineadas a brand_app primitives / semantics */
export const themes = {
  light: {
    mode: "light",
    surface: "#F5F1E8", // paper-100
    surfaceDim: "#ECE7DA", // paper-200
    surfaceContainer: "#FAFAF7", // paper-50
    surfaceContainerHigh: "#ECE7DA",
    onSurface: "#2D2E32", // sumi-800
    onSurfaceVariant: "#6B6D73", // ink-600
    outline: "#E5E1D3", // paper-300
    outlineVariant: "#CFC9B8", // paper-400
    primary: "#BC002D", // maru-600 · acento UI
    onPrimary: "#FAFAF7",
    primaryContainer: "rgba(188, 0, 45, 0.08)",
    onPrimaryContainer: "#BC002D",
    secondary: "#6B6D73",
    error: "#BC002D",
    onError: "#FAFAF7",
    errorContainer: "rgba(188, 0, 45, 0.08)",
    warn: "#C97A2B",
    warnText: "#8F4F0E",
    warnSoft: "rgba(232, 160, 85, 0.14)",
    hanko: "#BC002D",
    elevation1: "0 1px 2px rgba(45,46,50,.04), 0 8px 24px rgba(45,46,50,.06)",
    elevation2: "0 4px 12px rgba(45,46,50,.08), 0 20px 40px rgba(45,46,50,.10)",
    themeColor: "#F5F1E8",
  },
  dark: {
    mode: "dark",
    surface: "#2D2E32", // sumi-800
    surfaceDim: "#26272B", // sumi-900
    surfaceContainer: "#34363B", // sumi-700
    surfaceContainerHigh: "#3E4046", // sumi-600
    onSurface: "#FAFAF7",
    onSurfaceVariant: "#A6A8AE", // sumi-300
    outline: "#3E4046",
    outlineVariant: "#4E5057",
    primary: "#E11845", // maru-500
    onPrimary: "#FAFAF7",
    primaryContainer: "rgba(225, 24, 69, 0.14)",
    onPrimaryContainer: "#FF7F99", // maru-300 (AA sobre sumi)
    secondary: "#A6A8AE",
    error: "#FF7F99",
    onError: "#26272B",
    errorContainer: "rgba(225, 24, 69, 0.14)",
    warn: "#E8A055",
    warnText: "#E8A055",
    warnSoft: "rgba(232, 160, 85, 0.16)",
    hanko: "#E11845",
    elevation1: "0 1px 2px rgba(0,0,0,.20), 0 8px 24px rgba(0,0,0,.30)",
    elevation2: "0 4px 12px rgba(0,0,0,.30), 0 20px 40px rgba(0,0,0,.40)",
    themeColor: "#2D2E32",
  },
};

function withAliases(t) {
  return {
    ...t,
    bg: t.surface,
    bgDeep: t.surfaceDim,
    card: t.surfaceContainer,
    ink: t.onSurface,
    soft: t.onSurfaceVariant,
    line: t.outline,
    accent: t.primary,
    accentDim: t.primary,
    accentSoft: t.primaryContainer,
    matcha: t.secondary,
    indigo: t.primary,
    danger: t.error,
    warnBg: t.warnSoft || t.errorContainer,
    inputBg: t.surfaceDim,
    success: t.primary,
  };
}

const STORAGE_KEY = "nihon-theme";

/** Light-first (brand_app); respeta preferencia guardada / SO. */
export function resolveInitialMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* */ }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

export function persistMode(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch { /* */ }
}

export function getTheme(mode) {
  return withAliases(themes[mode === "dark" ? "dark" : "light"]);
}

export function applyCssVars(theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", theme.mode);
  // brand_app/tokens.css reacciona a data-theme; aliases legacy vía index.css
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme.themeColor);
}

/** Estilos derivados del tema (bridge hacia Tailwind + layout desktop/mobile). */
export function buildStyles(C, isDesktop = false) {
  return {
    app: {
      minHeight: "100vh",
      background: C.surface,
      color: C.onSurface,
      fontFamily: fonts.body,
      ...(isDesktop
        ? { maxWidth: "none", margin: 0, paddingLeft: 264, paddingBottom: 32 }
        : { maxWidth: 520, margin: "0 auto", paddingBottom: "calc(64px + env(safe-area-inset-bottom, 0px))" }),
    },
    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: isDesktop ? "24px 0 12px" : "16px 16px 10px",
    },
    eyebrow: {
      fontFamily: fonts.mono,
      fontSize: 11,
      fontWeight: 500,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: C.onSurfaceVariant,
    },
    title: {
      margin: "2px 0 0",
      fontFamily: fonts.display,
      fontSize: 22,
      fontWeight: 600,
      letterSpacing: "-0.03em",
      lineHeight: 1.2,
    },
    stamp: {
      width: 44,
      height: 44,
      borderRadius: "50%",
      background: C.surfaceContainer,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      border: `1px solid ${C.outline}`,
      boxShadow: C.elevation1,
    },
    hinomaru: {
      width: 26,
      height: 26,
      borderRadius: 50,
      background: C.hanko,
      display: "block",
    },
    main: { padding: isDesktop ? "4px 0" : "4px 16px" },
    nav: {
      position: "fixed",
      bottom: 0,
      left: "50%",
      transform: "translateX(-50%)",
      width: "100%",
      maxWidth: 520,
      display: "flex",
      background: C.surfaceContainer,
      borderTop: `1px solid ${C.outline}`,
      boxShadow: C.elevation1,
      padding: "6px 0 max(10px, env(safe-area-inset-bottom, 0px))",
      zIndex: 30,
      minHeight: 64,
    },
    navBtn: {
      flex: 1,
      background: "none",
      border: "none",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 2,
      cursor: "pointer",
      padding: "6px 4px",
      minHeight: 48,
      borderRadius: radii.sm,
      color: C.onSurfaceVariant,
      position: "relative",
      touchAction: "manipulation",
    },
    navBtnActive: {
      color: C.onPrimaryContainer,
      background: C.primaryContainer,
    },
    navIndicator: {
      position: "absolute",
      top: 4,
      width: 18,
      height: 3,
      borderRadius: radii.pill,
      background: C.primary,
    },
    label: {
      fontFamily: fonts.mono,
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: "0.16em",
      textTransform: "uppercase",
      color: C.onSurfaceVariant,
      marginBottom: 10,
    },
    input: {
      width: "100%",
      boxSizing: "border-box",
      padding: "12px 14px",
      fontSize: 15,
      border: "none",
      borderBottom: `2px solid ${C.outline}`,
      borderRadius: `${radii.sm}px ${radii.sm}px 0 0`,
      background: C.surfaceContainerHigh,
      color: C.onSurface,
      marginBottom: 8,
      outline: "none",
      transition: "border-color 150ms ease, background 150ms ease",
    },
    primary: {
      width: "100%",
      padding: "12px 16px",
      background: C.primary,
      color: C.onPrimary,
      border: "none",
      borderRadius: radii.sm,
      fontSize: 14,
      fontWeight: 500,
      cursor: "pointer",
      marginTop: 4,
      minHeight: 48,
      boxShadow: C.elevation1,
      touchAction: "manipulation",
    },
    secondary: {
      padding: "10px 14px",
      background: "transparent",
      color: C.onSurface,
      border: `1px solid ${C.outline}`,
      borderRadius: radii.sm,
      fontSize: 13,
      fontWeight: 500,
      cursor: "pointer",
      minHeight: 44,
      touchAction: "manipulation",
    },
    ghost: {
      background: "none",
      border: "none",
      color: C.onSurfaceVariant,
      cursor: "pointer",
      fontSize: 14,
      padding: 8,
      minHeight: 44,
      minWidth: 44,
      borderRadius: radii.sm,
      touchAction: "manipulation",
    },
    chip: {
      padding: "8px 14px",
      borderRadius: radii.pill,
      border: `1px solid ${C.outline}`,
      background: C.surfaceContainer,
      fontSize: 12,
      fontWeight: 500,
      cursor: "pointer",
      color: C.onSurface,
      minHeight: 40,
      touchAction: "manipulation",
    },
    chipOn: {
      background: C.primaryContainer,
      color: C.onPrimaryContainer,
      borderColor: "transparent",
    },
    warn: {
      background: C.warnSoft || C.errorContainer,
      border: `1px solid ${C.warn || C.error}`,
      color: C.warnText || C.error,
      fontSize: 13,
      padding: "10px 12px",
      borderRadius: radii.md,
      marginBottom: 10,
      lineHeight: 1.4,
    },
    card: {
      background: C.surfaceContainer,
      border: `1px solid ${C.outline}`,
      borderRadius: radii.md,
      padding: isDesktop ? 20 : 16,
      marginBottom: 12,
      boxShadow: C.elevation1,
    },
    content: isDesktop
      ? { maxWidth: 920, margin: "0 auto", padding: "0 32px 40px" }
      : {},
    rail: {
      position: "fixed",
      top: 0,
      bottom: 0,
      left: 0,
      width: 264,
      display: "flex",
      flexDirection: "column",
      gap: 8,
      padding: "20px 12px",
      background: C.surfaceContainer,
      borderRight: `1px solid ${C.outline}`,
      zIndex: 30,
      overflowY: "auto",
    },
    railBrand: {
      display: "flex",
      gap: 10,
      alignItems: "center",
      padding: "0 8px 14px",
      marginBottom: 6,
      borderBottom: `1px solid ${C.outline}`,
    },
    railNav: { display: "flex", flexDirection: "column", gap: 4, flex: 1 },
    railBtn: {
      width: "100%",
      display: "flex",
      gap: 10,
      alignItems: "center",
      padding: "8px 10px",
      borderRadius: radii.sm,
      border: "none",
      background: "none",
      color: C.onSurfaceVariant,
      fontSize: 14,
      fontWeight: 400,
      minHeight: 44,
      position: "relative",
      textAlign: "left",
      cursor: "pointer",
    },
    railBtnActive: {
      color: C.onPrimaryContainer,
      background: C.primaryContainer,
      fontWeight: 500,
    },
    railIndicator: {
      position: "absolute",
      left: 0,
      top: "50%",
      transform: "translateY(-50%)",
      width: 3,
      height: 18,
      borderRadius: 999,
      background: C.primary,
    },
    railFooter: {
      display: "flex",
      gap: 4,
      paddingTop: 12,
      borderTop: `1px solid ${C.outline}`,
    },
    grid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
      columnGap: 16,
      rowGap: 0,
      alignItems: "start",
    },
    spanFull: { gridColumn: "1 / -1" },
  };
}

/** Live bindings — actualizar con applyTheme() en cada render de App */
export let C = getTheme("light");
export let S = buildStyles(C);

export function applyTheme(mode, isDesktop = false) {
  C = getTheme(mode);
  S = buildStyles(C, isDesktop);
  applyCssVars(C);
  return C;
}

export const themeColor = themes.light.themeColor;
