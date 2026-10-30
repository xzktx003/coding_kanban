import { useSyncExternalStore } from "react";

export const SESSION_SHORTCUTS = [
  { id: "settings", title: "设置", binding: "Mod+Comma" },
  { id: "personality", title: "个性", binding: "Mod+Alt+KeyP" },
  { id: "shortcuts", title: "显示键盘快捷键", binding: "Mod+Slash" },
  { id: "search", title: "搜索聊天", binding: "Mod+KeyK" },
  { id: "focus", title: "聚焦主聊天输入框", binding: "Shift+Escape" },
  { id: "ordered-list", title: "编号列表", binding: "Mod+Alt+Digit4" },
  { id: "unordered-list", title: "项目符号列表", binding: "Mod+Alt+Digit5" },
  { id: "checklist", title: "核对清单", binding: "Mod+Alt+Digit6" },
] as const;
export type SessionShortcutId = (typeof SESSION_SHORTCUTS)[number]["id"];
export type NumberNavigationTarget = "tabs" | "chats";
type Bindings = Partial<Record<SessionShortcutId, string>> & { numberTarget?: NumberNavigationTarget };
const key = "session-keyboard-shortcuts-v1";
const listeners = new Set<() => void>();
let current: Bindings | undefined;

function validBinding(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 80 &&
    /^(?:(?:Mod|Ctrl|Meta|Alt|Shift)\+)*(?:Key[A-Z]|Digit[0-9]|Comma|Period|Slash|Semicolon|BracketLeft|BracketRight|Backquote|Minus|Equal|Escape|F[1-9]|F1[0-2])$/.test(
      value,
    )
  );
}
function parse(value: string | null): Bindings {
  try {
    const data = JSON.parse(value ?? "null");
    if (
      data?.version !== 1 ||
      !data.bindings ||
      typeof data.bindings !== "object"
    )
      return {};
    const result: Bindings = {};
    for (const row of SESSION_SHORTCUTS)
      if (
        validBinding(data.bindings[row.id]) &&
        !reserved(data.bindings[row.id]) && !numberNavigationBinding(data.bindings[row.id])
      )
        result[row.id] = data.bindings[row.id];
    if (["tabs", "chats"].includes(data.bindings.numberTarget)) result.numberTarget = data.bindings.numberTarget;
    return result;
  } catch {
    return {};
  }
}
function snapshot(): Bindings {
  if (!current) {
    try {
      current = parse(localStorage.getItem(key));
    } catch {
      current = {};
    }
  }
  return current;
}
function onStorage(event: StorageEvent) {
  if (event.key !== key && event.key !== null) return;
  current = parse(event.newValue);
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", onStorage);
  };
}
export function useSessionShortcutBindings() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
export function shortcutBinding(id: SessionShortcutId): string {
  return (
    snapshot()[id] ?? SESSION_SHORTCUTS.find((row) => row.id === id)!.binding
  );
}
export function shortcutLabel(binding: string): string {
  const apple = /Mac|iPhone|iPad/.test(navigator.platform);
  return binding
    .split("+")
    .map((part) =>
      part === "Mod"
        ? apple
          ? "⌘"
          : "Ctrl"
        : part === "Comma"
          ? ","
          : part === "Slash"
            ? "/"
            : part === "Escape"
              ? "Esc"
              : part.replace(/^Key|^Digit/, ""),
    )
    .join("+");
}
export function recordShortcut(
  event: Pick<
    KeyboardEvent,
    | "code"
    | "key"
    | "metaKey"
    | "ctrlKey"
    | "altKey"
    | "shiftKey"
    | "isComposing"
    | "keyCode"
  >,
): string | null {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    ["Control", "Meta", "Alt", "Shift", "Process", "Dead"].includes(event.key)
  )
    return null;
  const code =
    event.code ||
    (event.key.length === 1 && /[a-z]/i.test(event.key)
      ? `Key${event.key.toUpperCase()}`
      : /^[0-9]$/.test(event.key)
        ? `Digit${event.key}`
        : event.key === ","
          ? "Comma"
          : event.key === "/"
            ? "Slash"
            : event.key);
  const modifiers = [
    event.ctrlKey || event.metaKey ? "Mod" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
  ].filter(Boolean);
  const value = [...modifiers, code].join("+");
  return validBinding(value) ? value : null;
}
function reserved(binding: string): boolean {
  return (
    /^(?:Mod|Ctrl|Meta)\+(?:Key[LNRTWOPFSACVXYZBIU]|F[1-9]|F1[0-2])$/.test(
      binding,
    ) ||
    /^(?:Mod|Ctrl|Meta)\+Shift\+Key[IJCNTPZY]$/.test(binding) ||
    /^(?:Alt\+(?:F4|ArrowLeft|ArrowRight)|F(?:5|11|12))$/.test(binding)
  );
}
export function saveSessionShortcut(
  id: SessionShortcutId,
  binding: string,
): string | null {
  if (!validBinding(binding) || (!binding.includes("+") && !/^F/.test(binding)))
    return "请使用带修饰键的组合键";
  if (reserved(binding)) return "该组合键由浏览器保留，请选择其他快捷键";
  if (numberNavigationBinding(binding)) return "该组合键用于数字键会话导航，请选择其他快捷键";
  const conflict = SESSION_SHORTCUTS.find(
    (row) => row.id !== id && shortcutBinding(row.id) === binding,
  );
  if (conflict) return `该组合键已用于“${conflict.title}”`;
  return write({ ...snapshot(), [id]: binding });
}
function numberNavigationBinding(binding: string): boolean {
  return /^(?:Mod|Ctrl|Meta)\+(?:Alt\+)?Shift\+Digit[1-9]$/.test(binding);
}
export function numberNavigationTarget(): NumberNavigationTarget {
  return snapshot().numberTarget ?? "tabs";
}
export function saveNumberNavigationTarget(target: NumberNavigationTarget): string | null {
  if (target !== "tabs" && target !== "chats") return "无效的数字键导航目标";
  return write({ ...snapshot(), numberTarget: target });
}
/** Browsers reserve Cmd/Ctrl+1–9 for browser tabs. Preserve that behavior and
 * expose equivalent workbench navigation through explicit Shift modifiers. */
export function numberNavigationIntent(event: KeyboardEvent): { index: number; target: NumberNavigationTarget } | null {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || !event.shiftKey ||
      event.ctrlKey === event.metaKey) return null;
  const digit = /^Digit([1-9])$/.exec(event.code)?.[1] ?? (/^[1-9]$/.test(event.key) ? event.key : undefined);
  if (!digit) return null;
  const primary = numberNavigationTarget();
  return { index: Number(digit) - 1, target: event.altKey ? primary === "tabs" ? "chats" : "tabs" : primary };
}
function write(next: Bindings): string | null {
  try {
    localStorage.setItem(key, JSON.stringify({ version: 1, bindings: next }));
  } catch {
    return "无法保存快捷键偏好设置，请检查浏览器存储后重试";
  }
  current = next;
  listeners.forEach((listener) => listener());
  return null;
}
export function resetSessionShortcuts(): string | null {
  return write({});
}
export function matchesSessionShortcut(
  event: KeyboardEvent,
  id: SessionShortcutId,
): boolean {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.keyCode === 229
  )
    return false;
  return recordShortcut(event) === shortcutBinding(id);
}
