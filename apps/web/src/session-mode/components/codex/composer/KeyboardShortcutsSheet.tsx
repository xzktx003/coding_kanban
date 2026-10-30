import { useMemo, useState } from "react";
import { ComposerSheet } from "./v2/ComposerSheet";
import {
  SESSION_SHORTCUTS,
  shortcutBinding,
  shortcutLabel,
  recordShortcut,
  saveSessionShortcut,
  resetSessionShortcuts,
  useSessionShortcutBindings,
  type SessionShortcutId,
  numberNavigationTarget,
  saveNumberNavigationTarget,
} from "@session/services/sessionKeyboardShortcuts";

export function KeyboardShortcutsSheet({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<SessionShortcutId | null>(null);
  const [message, setMessage] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  const bindings = useSessionShortcutBindings();
  const rows = useMemo(() => {
    const shortcuts = SESSION_SHORTCUTS.map((row) => ({
      ...row,
      keys: shortcutLabel(shortcutBinding(row.id)),
    }));
    const needle = query.trim().toLowerCase();
    if (!needle) return shortcuts;
    return shortcuts.filter(
      (row) =>
        row.title.toLowerCase().includes(needle) ||
        row.keys.toLowerCase().includes(needle),
    );
  }, [query, bindings]);

  return (
    <ComposerSheet
      title="键盘快捷方式"
      description="自定义键盘快捷键"
      onClose={onClose}
    >
      <label>
        搜索键盘快捷键
        <input
          aria-label="搜索键盘快捷键"
          placeholder="搜索快捷键"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <fieldset className="my-4 space-y-2">
        <legend>数字键导航</legend>
        <label className="flex items-center gap-2"><input type="radio" name="number-shortcut-target" checked={numberNavigationTarget() === "tabs"} onChange={() => { const error=saveNumberNavigationTarget("tabs");setMessage({error:!!error,text:error??"数字键导航偏好已保存"}); }} />优先切换当前窗口标签</label>
        <label className="flex items-center gap-2"><input type="radio" name="number-shortcut-target" checked={numberNavigationTarget() === "chats"} onChange={() => { const error=saveNumberNavigationTarget("chats");setMessage({error:!!error,text:error??"数字键导航偏好已保存"}); }} />优先切换关注会话</label>
        <p className="text-xs text-muted-foreground">{shortcutLabel("Mod+Shift+Digit1–9")} 切换{numberNavigationTarget() === "tabs" ? "当前窗口标签" : "关注会话"}；{shortcutLabel("Mod+Alt+Shift+Digit1–9")} 切换{numberNavigationTarget() === "tabs" ? "关注会话" : "当前窗口标签"}。浏览器的 {shortcutLabel("Mod+Digit1–9")} 保持原行为。</p>
      </fieldset>
      {rows.length === 0 ? (
        <p role="status">没有匹配的快捷键</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.title}>
              <span>{row.title}</span>
              <button
                type="button"
                aria-label={`为 ${row.title} 录入快捷键`}
                onClick={() => {
                  setRecording(row.id);
                  setMessage(null);
                }}
                onKeyDown={(event) => {
                  if (recording !== row.id) return;
                  event.stopPropagation();
                  if (event.nativeEvent.isComposing || event.keyCode === 229)
                    return;
                  event.preventDefault();
                  if (event.key === "Escape") {
                    setRecording(null);
                    return;
                  }
                  const binding = recordShortcut(event.nativeEvent);
                  if (!binding) return;
                  const error = saveSessionShortcut(row.id, binding);
                  setMessage({ error: !!error, text: error ?? "快捷键已保存" });
                  if (!error) setRecording(null);
                }}
              >
                {recording === row.id ? "按下新的组合键" : row.keys}
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p role={message.error ? "alert" : "status"}>{message.text}</p>
      )}
      <button
        type="button"
        onClick={() => {
          setRecording(null);
          const error = resetSessionShortcuts();
          setMessage({ error: !!error, text: error ?? "已恢复默认快捷键" });
        }}
      >
        全部重置为默认值
      </button>
    </ComposerSheet>
  );
}
