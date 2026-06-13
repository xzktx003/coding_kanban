import type { SelectedHost } from "../components/HostDropdown";

export interface FileBrowserSessionState {
  selectedHost: SelectedHost;
}

function parseSelectedHost(value: unknown): SelectedHost | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<SelectedHost>;
  if (candidate.type === "local") {
    return { type: "local" };
  }

  if (
    candidate.type === "ssh" &&
    candidate.preset &&
    typeof candidate.preset === "object" &&
    typeof candidate.preset.host === "string"
  ) {
    return {
      type: "ssh",
      preset: {
        ...candidate.preset,
        name: candidate.preset.name || candidate.preset.host,
        host: candidate.preset.host,
        port: candidate.preset.port ?? 22,
      },
    };
  }

  return null;
}

export function parseSidePanelSessionStates(
  raw: string | null,
): Record<string, FileBrowserSessionState> {
  if (!raw) {
    return {};
  }

  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const entries = Object.entries(parsed).flatMap(([sessionId, value]) => {
    if (!value || typeof value !== "object") {
      return [];
    }

    const selectedHost = parseSelectedHost(
      (value as Partial<FileBrowserSessionState>).selectedHost,
    );
    return selectedHost ? [[sessionId, { selectedHost }] as const] : [];
  });

  return Object.fromEntries(entries);
}

export function parseInitialSidePanelTool(
  raw: string | null,
  focusedId: string | null,
): "files" | "vscode" | null {
  if (!raw || !focusedId) {
    return null;
  }

  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return parsed[focusedId] ? "files" : null;
}
