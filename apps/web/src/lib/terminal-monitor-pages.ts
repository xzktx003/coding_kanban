import {
  loadTerminalWorkspaceState,
  TERMINAL_WORKSPACE_STORAGE_KEY,
  type TerminalWorkspaceState,
} from "./terminal-workspace-state";

export const TERMINAL_MONITOR_PAGES_STORAGE_KEY = "terminal-monitor-pages-v1";

const DEFAULT_PAGE_NAME = "默认";
const DEFAULT_PAGE_ID = "terminal-monitor-page-1";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface TerminalMonitorPage {
  id: string;
  name: string;
  state: TerminalWorkspaceState;
}

export interface TerminalMonitorPagesState {
  activePageId: string;
  pages: TerminalMonitorPage[];
}

function resolveStorage(storage?: StorageLike): StorageLike {
  return storage ?? localStorage;
}

function defaultWorkspace(): TerminalWorkspaceState {
  return loadTerminalWorkspaceState(emptyStorage());
}

function emptyStorage(): StorageLike {
  return {
    getItem() {
      return null;
    },
    setItem() {
      // The default workspace never writes.
    },
  };
}

function defaultPage(
  state: TerminalWorkspaceState = defaultWorkspace(),
): TerminalMonitorPage {
  return {
    id: DEFAULT_PAGE_ID,
    name: DEFAULT_PAGE_NAME,
    state,
  };
}

function defaultPagesState(
  workspace: TerminalWorkspaceState = defaultWorkspace(),
): TerminalMonitorPagesState {
  const page = defaultPage(workspace);
  return { activePageId: page.id, pages: [page] };
}

function pageNumber(id: string): number | null {
  const match = /^terminal-monitor-page-(\d+)$/.exec(id);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function nextPageId(pages: TerminalMonitorPage[]): string {
  const highest = pages.reduce((max, page) => {
    const number = pageNumber(page.id);
    return number === null ? max : Math.max(max, number);
  }, 0);
  return `terminal-monitor-page-${highest + 1}`;
}

function nextPageName(pages: TerminalMonitorPage[]): string {
  const taken = new Set(pages.map((page) => page.name.trim()));
  let number = 1;
  while (taken.has(`页面 ${number}`)) {
    number += 1;
  }
  return `页面 ${number}`;
}

export function nextTerminalMonitorPageName(
  pages: readonly TerminalMonitorPage[],
  baseName: string,
  currentPageId: string,
): string {
  const trimmed = baseName.trim();
  const taken = new Set(
    pages
      .filter((page) => page.id !== currentPageId)
      .map((page) => page.name.trim()),
  );
  if (!taken.has(trimmed)) {
    return trimmed;
  }

  let number = 2;
  while (taken.has(`${trimmed} ${number}`)) {
    number += 1;
  }
  return `${trimmed} ${number}`;
}

function isDefaultPage(page: TerminalMonitorPage | undefined): boolean {
  return (
    page?.id === DEFAULT_PAGE_ID || page?.name.trim() === DEFAULT_PAGE_NAME
  );
}

function parsePage(value: unknown): TerminalMonitorPage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || !candidate.id.trim()) {
    return null;
  }
  if (typeof candidate.name !== "string" || !candidate.name.trim()) {
    return null;
  }
  if (
    !candidate.state ||
    typeof candidate.state !== "object" ||
    Array.isArray(candidate.state)
  ) {
    return null;
  }

  return {
    id: candidate.id,
    name: candidate.name.trim(),
    state: loadTerminalWorkspaceState({
      getItem(key) {
        return key === TERMINAL_WORKSPACE_STORAGE_KEY
          ? JSON.stringify(candidate.state)
          : null;
      },
      setItem() {
        // Parsing never writes.
      },
    }),
  };
}

function normalizePages(
  parsed: Record<string, unknown>,
): TerminalMonitorPagesState | null {
  if (!Array.isArray(parsed.pages) || parsed.pages.length === 0) {
    return null;
  }

  const pages = parsed.pages.flatMap((page) => {
    const parsedPage = parsePage(page);
    return parsedPage ? [parsedPage] : [];
  });
  if (pages.length === 0 || !isDefaultPage(pages[0])) {
    return null;
  }

  const seenIds = new Set<string>();
  const uniquePages = pages.filter((page) => {
    if (seenIds.has(page.id)) {
      return false;
    }
    seenIds.add(page.id);
    return true;
  });
  const activePageId =
    typeof parsed.activePageId === "string" && seenIds.has(parsed.activePageId)
      ? parsed.activePageId
      : uniquePages[0].id;

  return {
    activePageId,
    pages: uniquePages.map((page, index) =>
      index === 0
        ? { ...page, id: DEFAULT_PAGE_ID, name: DEFAULT_PAGE_NAME }
        : page,
    ),
  };
}

export function loadTerminalMonitorPages(
  storage?: StorageLike,
): TerminalMonitorPagesState {
  const target = resolveStorage(storage);

  try {
    const raw = target.getItem(TERMINAL_MONITOR_PAGES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const normalized = normalizePages(parsed);
      if (normalized) {
        return normalized;
      }
    }
  } catch {
    return defaultPagesState();
  }

  return defaultPagesState(loadTerminalWorkspaceState(target));
}

export function saveTerminalMonitorPages(
  state: TerminalMonitorPagesState,
  storage?: StorageLike,
): void {
  try {
    resolveStorage(storage).setItem(
      TERMINAL_MONITOR_PAGES_STORAGE_KEY,
      JSON.stringify(state),
    );
  } catch {
    // Ignore unavailable or full browser storage.
  }
}

export function createTerminalMonitorPage(
  state: TerminalMonitorPagesState,
): TerminalMonitorPagesState {
  const page: TerminalMonitorPage = {
    id: nextPageId(state.pages),
    name: nextPageName(state.pages),
    state: defaultWorkspace(),
  };

  return {
    activePageId: page.id,
    pages: [...state.pages, page],
  };
}

export function renameTerminalMonitorPage(
  state: TerminalMonitorPagesState,
  pageId: string,
  name: string,
): TerminalMonitorPagesState {
  const trimmed = name.trim();
  const page = state.pages.find((candidate) => candidate.id === pageId);
  if (!page || !trimmed) {
    return state;
  }
  if (
    state.pages.some(
      (candidate) =>
        candidate.id !== pageId && candidate.name.trim() === trimmed,
    )
  ) {
    return state;
  }

  return {
    ...state,
    pages: state.pages.map((candidate) =>
      candidate.id === pageId ? { ...candidate, name: trimmed } : candidate,
    ),
  };
}

export function deleteTerminalMonitorPage(
  state: TerminalMonitorPagesState,
  pageId: string,
): TerminalMonitorPagesState {
  const index = state.pages.findIndex((page) => page.id === pageId);
  const page = index >= 0 ? state.pages[index] : undefined;
  if (!page || state.pages.length < 2) {
    return state;
  }

  const pages = state.pages.filter((candidate) => candidate.id !== pageId);
  const activePageId =
    state.activePageId === pageId
      ? (pages[index - 1]?.id ?? pages[0].id)
      : state.activePageId;

  return { activePageId, pages };
}

export function updateActiveTerminalMonitorPage(
  state: TerminalMonitorPagesState,
  workspace: TerminalWorkspaceState,
): TerminalMonitorPagesState {
  return {
    ...state,
    pages: state.pages.map((page) =>
      page.id === state.activePageId ? { ...page, state: workspace } : page,
    ),
  };
}
