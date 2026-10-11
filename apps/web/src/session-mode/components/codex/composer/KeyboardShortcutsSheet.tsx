import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ComposerSheet } from "./v2/ComposerSheet";

const SHORTCUTS = [
  { title: "切换到 Codex", keys: "Ctrl+3 / Alt+3" },
  { title: "设置", keys: "Ctrl+," },
  { title: "个性", keys: "Ctrl+Shift+I" },
  { title: "显示键盘快捷键", keys: "Ctrl+/" },
  { title: "搜索聊天", keys: "Ctrl+K" },
  { title: "聚焦主聊天输入框", keys: "Shift+Esc" },
  { title: "编号列表", keys: "Alt+4 / Shift+9" },
  { title: "项目符号列表", keys: "Alt+5 / Shift+8" },
  { title: "核对清单", keys: "Alt+6" },
] as const;

export function KeyboardShortcutsSheet({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<string | null>(null);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return SHORTCUTS;
    return SHORTCUTS.filter(
      (row) =>
        row.title.toLowerCase().includes(needle) ||
        row.keys.toLowerCase().includes(needle),
    );
  }, [query]);

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
                onClick={() => setRecording(row.title)}
              >
                {recording === row.title ? "按下新的组合键" : row.keys}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => {
          setRecording(null);
          toast.message("无法保存快捷键偏好设置");
        }}
      >
        全部重置为默认值
      </button>
    </ComposerSheet>
  );
}
