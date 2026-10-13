export type WorkbenchColorTheme = "light" | "dark";

const NATIVE_COLOR_THEMES = {
  dark: "Default Dark Modern",
  light: "Default Light Modern",
} as const;

export function nativeCodexTheme(theme: WorkbenchColorTheme) {
  if (theme !== "light" && theme !== "dark")
    throw new Error("native Codex theme must be light or dark");
  return { theme, colorTheme: NATIVE_COLOR_THEMES[theme] };
}

/** Keep both mounted workbenches on the same resolved light or dark theme. */
export function applyWorkbenchTheme(
  document: Document,
  theme: WorkbenchColorTheme,
) {
  if (theme !== "light" && theme !== "dark")
    throw new Error("workbench theme must be light or dark");
  for (const root of document.querySelectorAll<HTMLElement>(
    ".session-mode, .codex-mode",
  )) {
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    root.style.setProperty("color-scheme", theme);
  }
}
