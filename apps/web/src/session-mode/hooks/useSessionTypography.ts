import { useEffect } from "react";
import {
  startTypographySync,
  useTypographyStore,
} from "@session/stores/settings/useTypographyStore";
const chatFonts = {
  sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: 'ui-serif, Georgia, "Noto Serif CJK SC", serif',
};
const codeFonts = {
  system: 'ui-monospace, "SFMono-Regular", Menlo, monospace',
  consolas: 'Consolas, "Liberation Mono", monospace',
};
export function useSessionTypography() {
  const { chatFont, codeFont, textSize, codeSize } = useTypographyStore();
  useEffect(() => startTypographySync(), []);
  useEffect(() => {
    const properties: Record<string, string | null> = {
      "--vscode-font-family":
        chatFont === "default" ? null : chatFonts[chatFont],
      "--vscode-chat-font-family":
        chatFont === "default" ? null : chatFonts[chatFont],
      "--session-chat-font":
        chatFont === "default" ? null : chatFonts[chatFont],
      "--vscode-editor-font-family":
        codeFont === "default" ? null : codeFonts[codeFont],
      "--codex-chat-font-size": textSize === null ? null : `${textSize}px`,
      "--vscode-chat-font-size": textSize === null ? null : `${textSize}px`,
      "--session-chat-font-size": textSize === null ? null : `${textSize}px`,
      "--codex-chat-code-font-size": codeSize === null ? null : `${codeSize}px`,
      "--session-code-font-size": codeSize === null ? null : `${codeSize}px`,
    };
    for (const root of document.querySelectorAll<HTMLElement>(
      ".session-mode",
    )) {
      for (const [key, value] of Object.entries(properties)) {
        if (value === null) root.style.removeProperty(key);
        else root.style.setProperty(key, value);
      }
      for (const [key, enabled] of [
        ["data-session-chat-font", chatFont !== "default"],
        ["data-session-chat-size", textSize !== null],
        ["data-session-code-size", codeSize !== null],
      ] as const) {
        if (enabled) root.setAttribute(key, "");
        else root.removeAttribute(key);
      }
    }
  }, [chatFont, codeFont, textSize, codeSize]);
}
