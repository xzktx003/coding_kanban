export type ViewMode = "grid" | "focus";

export interface FocusViewState {
  viewMode: ViewMode;
  focusedId: string | null;
}

export function defaultFocusViewState(): FocusViewState {
  return {
    viewMode: "grid",
    focusedId: null,
  };
}

export function parseFocusViewState(raw: string | null): FocusViewState {
  if (!raw) {
    return defaultFocusViewState();
  }

  const parsed = JSON.parse(raw) as Partial<FocusViewState>;
  const focusedId =
    typeof parsed.focusedId === "string" && parsed.focusedId.trim()
      ? parsed.focusedId
      : null;

  return {
    viewMode: parsed.viewMode === "focus" && focusedId ? "focus" : "grid",
    focusedId,
  };
}
