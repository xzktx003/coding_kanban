export type WorkbenchMode = "terminal" | "session";
export const WORKBENCH_MODE_KEY = "coding-kanban-workbench-mode-v1";

export function parseWorkbenchMode(value: string | null): WorkbenchMode {
  return value === "session" ? "session" : "terminal";
}

export function resolveWorkbenchMode(
  search: string,
  saved: string | null,
): WorkbenchMode {
  const explicit = new URLSearchParams(search).get("mode");
  return explicit === "session" || explicit === "terminal"
    ? explicit
    : parseWorkbenchMode(saved);
}

export function workbenchModeUrl(path: string, mode: WorkbenchMode): string {
  const url = new URL(path, "http://workbench.local");
  url.searchParams.set("mode", mode);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function readWorkbenchMode(): WorkbenchMode {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(WORKBENCH_MODE_KEY);
  } catch {
    /* Storage may be disabled. */
  }
  return resolveWorkbenchMode(window.location.search, saved);
}
