export const FILE_BROWSER_MIN_WIDTH = 360;

export interface FileBrowserUiState {
  width: number;
  sideCollapsed: boolean;
  mainCollapsed: boolean;
}

const DEFAULT_FILE_BROWSER_UI_STATE: FileBrowserUiState = {
  width: 520,
  sideCollapsed: false,
  mainCollapsed: false,
};

export function parseFileBrowserUiState(
  raw: string | null,
): FileBrowserUiState {
  if (!raw) {
    return DEFAULT_FILE_BROWSER_UI_STATE;
  }

  const parsed = JSON.parse(raw) as Partial<FileBrowserUiState>;
  const width =
    typeof parsed.width === "number" && Number.isFinite(parsed.width)
      ? Math.max(FILE_BROWSER_MIN_WIDTH, Math.min(960, parsed.width))
      : DEFAULT_FILE_BROWSER_UI_STATE.width;
  const sideCollapsed = Boolean(parsed.sideCollapsed);
  const mainCollapsed = Boolean(parsed.mainCollapsed);

  return {
    width,
    sideCollapsed,
    mainCollapsed: sideCollapsed ? false : mainCollapsed,
  };
}
