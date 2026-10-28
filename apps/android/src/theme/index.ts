export const colors = {
  // Base surfaces
  bg: "#12151c",
  bgElevated: "#1a1e27",
  bgCard: "#1f2430",
  bgHover: "#262c3a",
  border: "#2c3343",
  borderSoft: "#242a37",

  // Text
  text: "#e7e9ee",
  textSecondary: "#a8b0bf",
  textMuted: "#6b7484",
  textInverse: "#12151c",

  // Accent
  accent: "#5b8cff",
  accentSoft: "rgba(91,140,255,0.16)",
  onAccent: "#ffffff",

  // Attention groups (match web kanban)
  response: "#ff6b6b", // 需响应
  review: "#ffb020", // 待验收
  executing: "#5b8cff", // 执行中
  ready: "#3ecf8e", // 可继续

  // State
  success: "#3ecf8e",
  warning: "#ffb020",
  danger: "#ff6b6b",
  info: "#5b8cff",

  // Connection
  online: "#3ecf8e",
  degraded: "#ffb020",
  offline: "#ff6b6b",

  // Terminal chrome
  terminalBg: "#0b0d12",
  terminalBorder: "#262c3a",
  terminalText: "#d7dce6",

  // Misc
  shadow: "rgba(0,0,0,0.35)",
  overlay: "rgba(10,12,16,0.55)",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
};

export const typography = {
  h1: { fontSize: 26, fontWeight: "800" as const, color: colors.text },
  h2: { fontSize: 20, fontWeight: "700" as const, color: colors.text },
  h3: { fontSize: 17, fontWeight: "700" as const, color: colors.text },
  body: { fontSize: 15, color: colors.text },
  bodySecondary: { fontSize: 14, color: colors.textSecondary },
  caption: { fontSize: 12, color: colors.textMuted },
  mono: {
    fontSize: 12,
    fontFamily: "monospace",
    color: colors.terminalText,
  },
};
