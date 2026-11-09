import { useEffect, useState } from "react";
import { WorkbenchModeSwitch } from "../components/WorkbenchModeSwitch";
import type { WorkbenchMode } from "../lib/workbench-mode";
import "./chatgpt-mode.css";

function openNativeClipboard(button: HTMLButtonElement, active: boolean) {
  if (!active || button.ownerDocument.visibilityState === "hidden") return;
  const section = button.closest<HTMLElement>("section.chatgpt-mode");
  if (!section || section.hidden) return;
  const frame = section.querySelector<HTMLIFrameElement>('iframe[title="ChatGPT 原生桌面"]');
  if (!frame) return;
  try {
    const url = new URL(frame.src, button.ownerDocument.baseURI);
    if (url.origin !== button.ownerDocument.location.origin || url.pathname !== "/chatgpt-remote-desktop/vnc.html") return;
    const doc = frame.contentDocument;
    const input = doc?.getElementById("noVNC_clipboard_text") as HTMLTextAreaElement | null;
    const panel = doc?.getElementById("noVNC_clipboard");
    const toggle = doc?.getElementById("noVNC_clipboard_button");
    if (!doc?.documentElement.classList.contains("noVNC_connected") || !panel || !toggle || !input || input.tagName !== "TEXTAREA" || input.disabled || input.readOnly) return;
    // Use noVNC's authenticated clipboard path. Opening this panel neither
    // changes its text nor types, pastes or sends a model message.
    if (!panel.classList.contains("noVNC_open")) toggle.click();
    input.focus({ preventScroll: true });
  } catch {
    // A loading, disconnected or navigated viewer is not an input target.
  }
}

export default function ChatgptNativeDesktopApp({
  active,
  onModeChange,
}: {
  active: boolean;
  onModeChange: (mode: WorkbenchMode) => void;
}) {
  const [opened, setOpened] = useState(active);
  useEffect(() => {
    if (active) setOpened(true);
  }, [active]);
  return (
    <section
      className="chatgpt-mode"
      hidden={!active}
      aria-label="ChatGPT 模式"
    >
      <header className="chatgpt-workbench-header">
        <WorkbenchModeSwitch mode="chatgpt" onChange={onModeChange} />
        <button
          type="button"
          className="chatgpt-reconnect"
          disabled={!active || !opened}
          title="在剪贴板面板输入文字，然后点击聊天输入框并按 Ctrl+V；不会自动发送。"
          onClick={(event) => openNativeClipboard(event.currentTarget, active)}
        >
          粘贴文字
        </button>
        <span style={{ fontSize: "12px", color: "var(--chatgpt-muted)" }}>
          中文请用粘贴文字：输入后点聊天输入框，再按 Ctrl+V
        </span>
        <span className="chatgpt-workbench-label">独立原生桌面</span>
      </header>
      {opened && (
        <iframe
          title="ChatGPT 原生桌面"
          className="chatgpt-desktop-surface"
          src="/chatgpt-remote-desktop/vnc.html?autoconnect=true&resize=off&path=chatgpt-remote-desktop%2Fwebsockify"
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="same-origin"
        />
      )}
    </section>
  );
}
