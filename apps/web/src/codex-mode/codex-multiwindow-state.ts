import type { CodexProjectConversation } from "./project-conversations";

export const CODEX_MULTIWINDOW_KEY = "kanban.codex.multiwindow.v2";
const CODEX_MULTIWINDOW_KEY_V1 = "kanban.codex.multiwindow.v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const validNativeWindowId = (value: string) => UUID.test(value) || value === "native-default";
let groupSequence = 0;
const nextGroupId = () => `codex-group-${++groupSequence}`;

export type CodexWindow = {
  id: string;
  kind: "new" | "thread";
  title: string;
  cwd: string;
  threadId?: string;
  state: "ready" | "opening" | "error";
  error?: string;
};

export type CodexSplitEdge = "left" | "right" | "top" | "bottom" | "center";
export type CodexSplitGroup = {
  type: "group";
  id: string;
  keys: string[];
  selected: string | null;
  keepEmpty?: true;
};
export type CodexSplitBranch = {
  type: "split";
  id: string;
  direction: "horizontal" | "vertical";
  ratio: number;
  first: CodexSplitNode;
  second: CodexSplitNode;
};
export type CodexSplitNode = CodexSplitGroup | CodexSplitBranch;

export type CodexWindowState = {
  windows: CodexWindow[];
  activeId: string | null;
  tree: CodexSplitNode;
  activeGroupId: string;
};

export const codexSplitGroups = (node: CodexSplitNode): CodexSplitGroup[] =>
  node.type === "group" ? [node] : [...codexSplitGroups(node.first), ...codexSplitGroups(node.second)];

const groupNode = (keys: string[] = []): CodexSplitGroup => ({
  type: "group",
  id: nextGroupId(),
  keys,
  selected: keys[0] ?? null,
});

const mapGroups = (
  node: CodexSplitNode,
  fn: (group: CodexSplitGroup) => CodexSplitGroup,
): CodexSplitNode =>
  node.type === "group"
    ? fn(node)
    : { ...node, first: mapGroups(node.first, fn), second: mapGroups(node.second, fn) };

function pruneCodexSplit(node: CodexSplitNode): CodexSplitNode | null {
  if (node.type === "group") return node.keys.length || node.keepEmpty ? node : null;
  const first = pruneCodexSplit(node.first);
  const second = pruneCodexSplit(node.second);
  return first && second ? { ...node, first, second } : (first ?? second);
}

function replaceCodexSplit(node: CodexSplitNode, id: string, next: CodexSplitNode): CodexSplitNode {
  if (node.id === id) return next;
  return node.type === "group"
    ? node
    : { ...node, first: replaceCodexSplit(node.first, id, next), second: replaceCodexSplit(node.second, id, next) };
}

function withWindow(state: CodexWindowState, id: string, windows: CodexWindow[]): CodexWindowState {
  const groups = codexSplitGroups(state.tree);
  const owner = groups.find((group) => group.keys.includes(id));
  if (owner) {
    return {
      ...state,
      windows,
      activeId: id,
      activeGroupId: owner.id,
      tree: mapGroups(state.tree, (group) => group.id === owner.id ? { ...group, selected: id } : group),
    };
  }
  const target = groups.find((group) => group.id === state.activeGroupId) ?? groups[0];
  const tree = target
    ? mapGroups(state.tree, (group) => group.id === target.id
      ? { ...group, keepEmpty: undefined, keys: [...group.keys, id], selected: id }
      : group)
    : groupNode([id]);
  const nextGroups = codexSplitGroups(tree);
  return {
    ...state,
    windows,
    activeId: id,
    tree,
    activeGroupId: nextGroups.find((group) => group.selected === id)?.id ?? nextGroups[0]?.id ?? state.activeGroupId,
  };
}

function syncTree(state: CodexWindowState, windows: CodexWindow[], removedId?: string): CodexWindowState {
  const allowed = new Set(windows.map((window) => window.id));
  const seen = new Set<string>();
  let tree = mapGroups(state.tree, (group) => {
    const keys = group.keys.filter((key) => allowed.has(key) && !seen.has(key) && Boolean(seen.add(key)));
    const { keepEmpty, ...identity } = group;
    return {
      ...identity,
      ...(!keys.length && keepEmpty ? { keepEmpty } : {}),
      keys,
      selected: keys.includes(group.selected ?? "") ? group.selected : (keys[0] ?? null),
    };
  });
  tree = pruneCodexSplit(tree) ?? groupNode(windows.map((window) => window.id));
  const missing = windows.filter((window) => !seen.has(window.id)).map((window) => window.id);
  if (missing.length) {
    const groups = codexSplitGroups(tree);
    const target = groups.find((group) => group.id === state.activeGroupId) ?? groups[0];
    tree = target
      ? mapGroups(tree, (group) => group.id === target.id
        ? { ...group, keepEmpty: undefined, keys: [...group.keys, ...missing], selected: group.selected ?? missing[0] ?? null }
        : group)
      : groupNode(missing);
  }
  const groups = codexSplitGroups(tree);
  const activeGroupId = groups.some((group) => group.id === state.activeGroupId)
    ? state.activeGroupId
    : groups[0]?.id ?? tree.id;
  const selected = groups.find((group) => group.id === activeGroupId)?.selected ?? null;
  const activeId = state.activeId !== removedId && windows.some((window) => window.id === state.activeId)
    ? state.activeId
    : selected ?? windows.at(-1)?.id ?? null;
  return { ...state, windows, tree, activeGroupId, activeId };
}

function validPath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") &&
    value.length <= 4096 && value.trim() === value && !/[\\\x00-\x1f\x7f]/.test(value);
}

export function initialCodexWindows(windowId: string, project: string): CodexWindowState {
  const id = validNativeWindowId(windowId) && validPath(project) ? `new:${windowId}` : null;
  const tree = groupNode(id ? [id] : []);
  return {
    windows: id ? [{ id, kind: "new", title: "新聊天", cwd: project, state: "ready" }] : [],
    activeId: id,
    tree,
    activeGroupId: tree.id,
  };
}

export function openCodexConversation(
  state: CodexWindowState,
  conversation: CodexProjectConversation,
): CodexWindowState {
  if (!UUID.test(conversation.id) || !validPath(conversation.cwd)) return state;
  const existing = state.windows.find((window) => window.id === conversation.id || window.threadId === conversation.id);
  if (existing) return withWindow(state, existing.id, state.windows);
  return withWindow(state, conversation.id, [...state.windows, {
    id: conversation.id,
    kind: "thread",
    threadId: conversation.id,
    title: (conversation.name?.trim() || conversation.preview.trim() || "未命名会话").slice(0, 160),
    cwd: conversation.cwd,
    state: "opening",
  }]);
}

export function appendCodexNewWindow(state: CodexWindowState, windowId: string, project: string): CodexWindowState {
  if (!UUID.test(windowId) || !validPath(project)) return state;
  const id = `new:${windowId}`;
  if (state.windows.some((item) => item.id === id)) return withWindow(state, id, state.windows);
  return withWindow(state, id, [...state.windows, {
    id, kind: "new", title: `新聊天 ${state.windows.filter((item) => item.kind === "new").length + 1}`, cwd: project, state: "opening",
  }]);
}

export function replaceCodexWindows(state: CodexWindowState, windows: CodexWindow[]): CodexWindowState {
  const same = state.windows.length === windows.length && state.windows.every((item, index) => {
    const next = windows[index];
    return next && item.id === next.id && item.title === next.title && item.cwd === next.cwd &&
      item.threadId === next.threadId && item.state === next.state && item.error === next.error;
  });
  if (same) return state;
  const removed = new Set(state.windows.filter((item) => !windows.some((next) => next.id === item.id)).map((item) => item.id));
  const removedActive = state.activeId && removed.has(state.activeId) ? state.activeId : undefined;
  const next = syncTree({ ...state, activeId: removedActive ? null : state.activeId }, windows, removedActive);
  return state.activeId && next.windows.some((item) => item.id === state.activeId) ? focusCodexWindow(next, state.activeId) : next;
}

export function closeCodexWindow(state: CodexWindowState, id: string): CodexWindowState {
  const windows = state.windows.filter((window) => window.id !== id);
  if (windows.length === state.windows.length) return state;
  return syncTree(state, windows, id);
}

export function placeCodexWindow(
  state: CodexWindowState,
  key: string,
  targetId: string,
  edge: CodexSplitEdge,
  beforeKey?: string,
): CodexWindowState {
  const groups = codexSplitGroups(state.tree);
  const owner = groups.find((group) => group.keys.includes(key));
  const target = groups.find((group) => group.id === targetId);
  if (!owner || !target || !state.windows.some((window) => window.id === key)) return state;
  let tree = mapGroups(state.tree, (group) => {
    const keys = group.keys.filter((item) => item !== key);
    return { ...group, keys, selected: group.selected === key ? (keys[0] ?? null) : group.selected };
  });
  const current = codexSplitGroups(tree).find((group) => group.id === targetId);
  if (!current) return state;
  let focused: CodexSplitGroup;
  if (edge === "center") {
    const keys = [...current.keys];
    const index = beforeKey ? keys.indexOf(beforeKey) : -1;
    keys.splice(index < 0 ? keys.length : index, 0, key);
    const { keepEmpty: _keepEmpty, ...filled } = current;
    focused = { ...filled, keys, selected: key };
    tree = replaceCodexSplit(tree, targetId, focused);
  } else {
    focused = groupNode([key]);
    const original = owner.id === targetId && !current.keys.length
      ? { ...current, keepEmpty: true as const }
      : current;
    const leading = edge === "left" || edge === "top";
    tree = replaceCodexSplit(tree, targetId, {
      type: "split",
      id: nextGroupId(),
      direction: edge === "left" || edge === "right" ? "horizontal" : "vertical",
      ratio: 50,
      first: leading ? focused : original,
      second: leading ? original : focused,
    });
  }
  const pruned = pruneCodexSplit(tree) ?? focused;
  return { ...state, tree: pruned, activeGroupId: focused.id, activeId: key };
}

export function resizeCodexSplit(state: CodexWindowState, id: string, ratio: number): CodexWindowState {
  if (!Number.isFinite(ratio)) return state;
  const clamped = Math.max(15, Math.min(85, ratio));
  const visit = (node: CodexSplitNode): CodexSplitNode =>
    node.type === "group"
      ? node
      : { ...node, ratio: node.id === id ? clamped : node.ratio, first: visit(node.first), second: visit(node.second) };
  return { ...state, tree: visit(state.tree) };
}

export function focusCodexWindow(state: CodexWindowState, id: string): CodexWindowState {
  const owner = codexSplitGroups(state.tree).find((group) => group.keys.includes(id));
  if (!owner || !state.windows.some((window) => window.id === id)) return state;
  return {
    ...state,
    activeId: id,
    activeGroupId: owner.id,
    tree: mapGroups(state.tree, (group) => group.id === owner.id ? { ...group, selected: id } : group),
  };
}

export function focusCodexGroup(state: CodexWindowState, id: string): CodexWindowState {
  const group = codexSplitGroups(state.tree).find((item) => item.id === id);
  if (!group) return state;
  return { ...state, activeGroupId: id, activeId: group.selected ?? state.activeId };
}

export function closeEmptyCodexGroup(state: CodexWindowState, id: string): CodexWindowState {
  const target = codexSplitGroups(state.tree).find((group) => group.id === id);
  if (!target || target.keys.length) return state;
  const tree = pruneCodexSplit(mapGroups(state.tree, (group) => {
    if (group.id !== id) return group;
    const { keepEmpty: _keepEmpty, ...empty } = group;
    return empty;
  })) ?? groupNode();
  const groups = codexSplitGroups(tree);
  const activeGroupId = groups.some((group) => group.id === state.activeGroupId) ? state.activeGroupId : groups[0]?.id ?? tree.id;
  return {
    ...state,
    tree,
    activeGroupId,
    activeId: groups.find((group) => group.id === activeGroupId)?.selected ?? state.activeId,
  };
}

function persistedWindow(row: Record<string, unknown>, seen: Set<string>, sameHost: boolean, initialWindowId: string): CodexWindow | "skip" | "invalid" {
  if (typeof row.id !== "string" || typeof row.title !== "string" || row.title.length > 160 ||
    !validPath(row.cwd) || seen.has(row.id) || (row.kind !== "new" && row.kind !== "thread")) return "invalid";
  if (row.kind === "new" && (!row.id.startsWith("new:") || !validNativeWindowId(row.id.slice(4)))) return "invalid";
  if (row.kind === "thread" && (!UUID.test(row.id) || row.threadId !== row.id)) return "invalid";
  if (row.kind === "new" && typeof row.threadId === "string" && UUID.test(row.threadId)) {
    return seen.has(row.threadId) ? "skip" : {
      id: row.threadId, kind: "thread", title: row.title, cwd: row.cwd, threadId: row.threadId, state: "opening",
    };
  }
  if (!sameHost && row.kind === "new") return "skip";
  return {
    id: row.id, kind: row.kind, title: row.title, cwd: row.cwd,
    ...(row.kind === "thread" ? { threadId: row.id } : typeof row.threadId === "string" && UUID.test(row.threadId) ? { threadId: row.threadId } : {}),
    state: row.kind === "thread" || row.id !== `new:${initialWindowId}` ? "opening" : "ready",
  };
}

function treeFromWindowIds(ids: string[], split: boolean, activeId: string | null): { tree: CodexSplitNode; activeGroupId: string } {
  if (!split || ids.length <= 1) {
    const tree = groupNode(ids);
    return {
      tree: { ...tree, selected: activeId && ids.includes(activeId) ? activeId : tree.selected },
      activeGroupId: tree.id,
    };
  }
  const groups = ids.map((id) => groupNode([id]));
  let tree: CodexSplitNode = groups[0]!;
  for (const group of groups.slice(1)) {
    tree = {
      type: "split", id: nextGroupId(), direction: "horizontal", ratio: 50, first: tree, second: group,
    };
  }
  return { tree, activeGroupId: groups.find((group) => group.selected === activeId)?.id ?? groups.at(-1)!.id };
}

function readSplitNode(value: unknown, allowed: Set<string>, seen: Set<string>): CodexSplitNode | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const node = value as Record<string, unknown>;
  if (node.type === "group") {
    if (typeof node.id !== "string" || node.id.length > 80 || !Array.isArray(node.keys)) return null;
    const keys = node.keys.filter((key): key is string => typeof key === "string" && allowed.has(key) && !seen.has(key));
    for (const key of keys) seen.add(key);
    const selected = typeof node.selected === "string" && keys.includes(node.selected) ? node.selected : (keys[0] ?? null);
    return {
      type: "group", id: node.id, keys, selected,
      ...(!keys.length && node.keepEmpty === true ? { keepEmpty: true as const } : {}),
    };
  }
  if (node.type !== "split" || (node.direction !== "horizontal" && node.direction !== "vertical") ||
    typeof node.id !== "string" || typeof node.ratio !== "number") return null;
  const first = readSplitNode(node.first, allowed, seen);
  const second = readSplitNode(node.second, allowed, seen);
  if (!first || !second) return null;
  return {
    type: "split", id: node.id, direction: node.direction,
    ratio: Math.max(15, Math.min(85, node.ratio)), first, second,
  };
}

export function readCodexWindows(
  storage: Pick<Storage, "getItem">,
  initialWindowId: string,
  project: string,
): CodexWindowState {
  const fallback = initialCodexWindows(initialWindowId, project);
  try {
    const currentRaw = storage.getItem(CODEX_MULTIWINDOW_KEY);
    const legacyRaw = storage.getItem(CODEX_MULTIWINDOW_KEY_V1);
    const raw = currentRaw || legacyRaw;
    if (!raw || raw.length > 256 * 1024) return fallback;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return fallback;
    const value = data as Record<string, unknown>;
    const version = currentRaw ? 2 : 1;
    if (value.version !== version || !Array.isArray(value.windows)) return fallback;
    if (version === 1 && value.layout !== "focus" && value.layout !== "split") return fallback;
    const sameHost = value.hostKey === initialWindowId;
    const seen = new Set<string>(sameHost ? [] : fallback.windows.map((item) => item.id));
    const windows: CodexWindow[] = sameHost ? [] : [...fallback.windows];
    const convertedIds = new Map<string, string>();
    for (const item of value.windows) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return fallback;
      const row = item as Record<string, unknown>;
      const window = persistedWindow(row, seen, sameHost, initialWindowId);
      if (window === "invalid") return fallback;
      if (window === "skip") continue;
      if (row.kind === "new" && window.id !== row.id) convertedIds.set(row.id, window.id);
      seen.add(window.id);
      windows.push(window);
    }
    const requestedActive = typeof value.activeId === "string" ? convertedIds.get(value.activeId) ?? value.activeId : null;
    const activeId = requestedActive && windows.some((window) => window.id === requestedActive)
      ? requestedActive : windows.at(-1)?.id ?? null;
    const allowed = new Set(windows.map((window) => window.id));
    let tree = version === 2 && sameHost ? readSplitNode(value.tree, allowed, new Set()) : null;
    if (version === 2 && sameHost && !tree) return { ...fallback, windows };
    if (!tree) {
      const placed = treeFromWindowIds(windows.map((window) => window.id), sameHost && value.layout === "split", activeId);
      tree = placed.tree;
      const activeGroupId = placed.activeGroupId;
      return syncTree({ windows, activeId, tree, activeGroupId }, windows);
    }
    const activeGroupId = typeof value.activeGroupId === "string" && codexSplitGroups(tree).some((group) => group.id === value.activeGroupId)
      ? value.activeGroupId : codexSplitGroups(tree)[0]?.id ?? tree.id;
    return syncTree({ windows, activeId, tree, activeGroupId }, windows);
  } catch {
    return fallback;
  }
}

export function saveCodexWindows(
  storage: Pick<Storage, "setItem">,
  state: CodexWindowState,
  hostKey: string,
): boolean {
  if (!validNativeWindowId(hostKey)) return false;
  try {
    storage.setItem(CODEX_MULTIWINDOW_KEY, JSON.stringify({
      version: 2, hostKey, activeId: state.activeId, activeGroupId: state.activeGroupId, tree: state.tree,
      windows: state.windows.map(({ id, kind, title, cwd, threadId }) => ({ id, kind, title, cwd, threadId })),
    }));
    return true;
  } catch {
    return false;
  }
}
