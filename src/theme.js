/**
 * Design tokens semánticos — kyz.com.ar + Material Design 3 (sin MUI).
 * Dark: portfolio H-kANAME. Light: surface tinted + primary denso (contraste WCAG).
 * Brand: hinomaru #BC002D (solo marca, no estado UI).
 */

export const fonts = {
  display: "Roboto, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  body: "Roboto, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
};

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const type = {
  display: { fontSize: 28, fontWeight: 700, letterSpacing: -0.4, lineHeight: 1.2 },
  title: { fontSize: 22, fontWeight: 700, letterSpacing: -0.3, lineHeight: 1.25 },
  body: { fontSize: 14, fontWeight: 400, lineHeight: 1.5 },
  label: { fontSize: 12, fontWeight: 600, letterSpacing: 0.4, lineHeight: 1.3 },
  caption: { fontSize: 11, fontWeight: 400, lineHeight: 1.4 },
};

export const themes = {
  dark: {
    mode: "dark",
    surface: "#2d2e32",
    surfaceDim: "#202022",
    surfaceContainer: "#25262a",
    surfaceContainerHigh: "#2f3035",
    onSurface: "#f3f4f6",
    onSurfaceVariant: "#9ca3af",
    outline: "#374151",
    outlineVariant: "#2a2f36",
    primary: "#15eb80",
    onPrimary: "#042016",
    primaryContainer: "rgba(21, 235, 128, 0.14)",
    onPrimaryContainer: "#64f4ac",
    secondary: "#64f4ac",
    error: "#e57373",
    onError: "#1a0000",
    errorContainer: "rgba(229, 115, 115, 0.14)",
    hanko: "#BC002D",
    elevation1: "0 1px 3px rgba(0,0,0,0.4)",
    elevation2: "0 4px 12px rgba(0,0,0,0.5)",
    themeColor: "#202022",
  },
  light: {
    mode: "light",
    surface: "#F4F6F5",
    surfaceDim: "#E8ECEA",
    surfaceContainer: "#FFFFFF",
    surfaceContainerHigh: "#EEF2F0",
    onSurface: "#1A1C1E",
    onSurfaceVariant: "#5C6560",
    outline: "#C5CDC8",
    outlineVariant: "#E1E8E4",
    primary: "#0B8F55",
    onPrimary: "#FFFFFF",
    primaryContainer: "#C8F7DC",
    onPrimaryContainer: "#045C38",
    secondary: "#3D6B5C",
    error: "#B3261E",
    onError: "#FFFFFF",
    errorContainer: "#F9DEDC",
    hanko: "#BC002D",
    elevation1: "0 1px 3px rgba(0,0,0,0.08)",
    elevation2: "0 4px 12px rgba(0,0,0,0.12)",
    themeColor: "#F4F6F5",
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
    warnBg: t.errorContainer,
    inputBg: t.surfaceDim,
    success: t.primary,
  };
}

const STORAGE_KEY = "nihon-theme";

export function resolveInitialMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* */ }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export function persistMode(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch { /* */ }
}

export function getTheme(mode) {
  return withAliases(themes[mode === "light" ? "light" : "dark"]);
}

export function applyCssVars(theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", theme.mode);
  const map = {
    "--surface": theme.surface,
    "--surface-dim": theme.surfaceDim,
    "--surface-container": theme.surfaceContainer,
    "--surface-container-high": theme.surfaceContainerHigh,
    "--on-surface": theme.onSurface,
    "--on-surface-variant": theme.onSurfaceVariant,
    "--outline": theme.outline,
    "--outline-variant": theme.outlineVariant,
    "--primary": theme.primary,
    "--on-primary": theme.onPrimary,
    "--primary-container": theme.primaryContainer,
    "--on-primary-container": theme.onPrimaryContainer,
    "--secondary": theme.secondary,
    "--error": theme.error,
    "--error-container": theme.errorContainer,
    "--hanko": theme.hanko,
    "--elevation-1": theme.elevation1,
    "--elevation-2": theme.elevation2,
    "--theme-color": theme.themeColor,
  };
  for (const [k, v] of Object.entries(map)) root.style.setProperty(k, v);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme.themeColor);
}

/** Estilos Material-inspired derivados del tema activo */
export function buildStyles(C) {
  return {
    app: {
      minHeight: "100vh",
      background: `radial-gradient(ellipse at 80% -10%, ${C.primaryContainer} 0%, transparent 45%), ${C.surface}`,
      color: C.onSurface,
      fontFamily: fonts.body,
      maxWidth: 520,
      margin: "0 auto",
      paddingBottom: "calc(76px + env(safe-area-inset-bottom, 0px))",
    },
    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "16px 16px 10px",
    },
    eyebrow: {
      ...type.caption,
      letterSpacing: 2,
      textTransform: "uppercase",
      color: C.secondary,
    },
    title: {
      margin: "2px 0 0",
      ...type.title,
      fontSize: 24,
    },
    stamp: {
      width: 44,
      height: 44,
      borderRadius: "50%",
      background: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      border: `1px solid ${C.outline}`,
      boxShadow: C.elevation1,
    },
    hinomaru: {
      width: 26,
      height: 26,
      borderRadius: "50%",
      background: C.hanko,
      display: "block",
    },
    main: { padding: "4px 16px" },
    nav: {
      position: "fixed",
      bottom: 0,
      left: "50%",
      transform: "translateX(-50%)",
      width: "100%",
      maxWidth: 520,
      display: "flex",
      background: C.surfaceContainer,
      borderTop: `1px solid ${C.outlineVariant}`,
      boxShadow: C.elevation1,
      padding: "6px 0 max(10px, env(safe-area-inset-bottom, 0px))",
      zIndex: 20,
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
      ...type.label,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: C.secondary,
      marginBottom: 10,
    },
    input: {
      width: "100%",
      boxSizing: "border-box",
      padding: "12px 14px",
      fontSize: 14,
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
      borderRadius: radii.md,
      fontSize: 14,
      fontWeight: 700,
      cursor: "pointer",
      marginTop: 4,
      minHeight: 48,
      boxShadow: C.elevation1,
      touchAction: "manipulation",
    },
    secondary: {
      padding: "10px 14px",
      background: "transparent",
      color: C.primary,
      border: `1px solid ${C.outline}`,
      borderRadius: radii.md,
      fontSize: 12,
      fontWeight: 600,
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
      background: C.errorContainer,
      border: `1px solid ${C.error}`,
      color: C.error,
      fontSize: 12,
      padding: "10px 12px",
      borderRadius: radii.sm,
      marginBottom: 10,
      lineHeight: 1.4,
    },
    card: {
      background: C.surfaceContainer,
      border: `1px solid ${C.outlineVariant}`,
      borderRadius: radii.lg,
      padding: 16,
      marginBottom: 12,
      boxShadow: C.elevation1,
    },
  };
}

/** Live bindings — actualizar con applyTheme() en cada render de App */
export let C = getTheme("dark");
export let S = buildStyles(C);

export function applyTheme(mode) {
  C = getTheme(mode);
  S = buildStyles(C);
  applyCssVars(C);
  return C;
}

export const themeColor = themes.dark.themeColor;
