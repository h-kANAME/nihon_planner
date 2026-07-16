/**
 * Design tokens extraídos de https://kyz.com.ar (portfolio H-kANAME).
 * Paleta dark + acento verde neón. Tipografía system/ui-sans.
 *
 * Gate de diseño (§10.2): tokens documentados para aprobación Product.
 * Aplicados en la app; ajustar acá si Emma pide cambios.
 */
export const C = {
  bg: "#2d2e32",
  bgDeep: "#202022",
  card: "#25262a",
  ink: "#f3f4f6",
  soft: "#9ca3af",
  line: "#374151",
  accent: "#15eb80",
  accentDim: "#047857",
  accentSoft: "rgba(21, 235, 128, 0.12)",
  hanko: "#BC002D", // hinomaru — branding Nihon
  indigo: "#15eb80", // alias: CTAs usan acento kyz
  matcha: "#64f4ac",
  danger: "#be6464",
  warnBg: "rgba(190, 100, 100, 0.12)",
  inputBg: "#202022",
  success: "#15eb80",
};

export const fonts = {
  display: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  body: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
};

export const radii = {
  sm: 3,
  md: 10,
  lg: 14,
  pill: 999,
};

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const themeColor = C.bgDeep;
