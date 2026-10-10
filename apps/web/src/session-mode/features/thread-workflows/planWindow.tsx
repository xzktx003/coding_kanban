import type { ThemeContextType } from "@session/contexts/ThemeContext";
import type { i18n } from "i18next";
import { parseFileReference } from "@session/components/codex/presentation/fileReference";
import { useEditorStore } from "@session/stores/useEditorStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import {
  PLAN_WINDOW_STORAGE_PREFIX,
  planWindowChannel,
  planWindowUrl,
  savePlanWindowSnapshot,
} from "./planSnapshot";
export interface PlanWindowSnapshot {
  text: string;
  threadId?: string;
  turnId?: string;
  cwd?: string | null;
  theme: ThemeContextType;
  i18n: i18n;
}
/** The real same-origin route owns its document/JS realm and never mounts the workbench. */
export function openPlanWindow(input: PlanWindowSnapshot): Window {
  const root = document.querySelector<HTMLElement>(".session-mode");
  const cssVariables: Record<string, string> = {};
  if (root) {
    const computed = getComputedStyle(root);
    for (let index = 0; index < computed.length; index++) {
      const key = computed[index];
      if (key.startsWith("--"))
        cssVariables[key] = computed.getPropertyValue(key);
    }
  }
  const snapshot = Object.freeze({
    text: input.text,
    threadId: input.threadId,
    turnId: input.turnId,
    cwd: input.cwd,
    language: input.i18n.language || "en",
    rootClassName:
      root?.className ?? `session-mode ${input.theme.resolvedTheme}`,
    cssVariables,
    theme: {
      theme: input.theme.theme,
      resolvedTheme: input.theme.resolvedTheme,
      accent: input.theme.accent,
      starfield: input.theme.starfield,
      backgroundImage: input.theme.backgroundImage,
    },
  });
  const id = savePlanWindowSnapshot(snapshot);
  const channel = new BroadcastChannel(planWindowChannel(id));
  channel.onmessage = (event) => {
    const message = event.data;
    if (
      !message ||
      message.id !== id ||
      message.type !== "openFile" ||
      typeof message.reference !== "string" ||
      message.reference.length > 8192 ||
      typeof message.requestId !== "string" ||
      message.requestId.length > 100
    )
      return;
    try {
      const file = parseFileReference(message.reference, snapshot.cwd);
      if (!file) throw new Error("文件引用无效，未打开其他项目文件。");
      useEditorStore
        .getState()
        .revealFile(
          file.path,
          snapshot.cwd ?? undefined,
          file.line,
          file.column,
        );
      useLayoutStore.getState().setActiveRightPanelTab("files");
      useLayoutStore.getState().setRightPanelOpen(true);
      channel.postMessage({
        id,
        type: "fileOpened",
        requestId: message.requestId,
      });
    } catch (error) {
      channel.postMessage({
        id,
        type: "fileOpened",
        requestId: message.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const popup = window.open(
    planWindowUrl(location.href, id),
    "_blank",
    "popup=yes,width=960,height=720",
  );
  sessionStorage.removeItem(PLAN_WINDOW_STORAGE_PREFIX + id);
  if (!popup) {
    channel.close();
    throw new Error("浏览器未能打开计划窗口，请允许此站点弹出窗口后重试。");
  }
  popup.opener = null;
  const cleanup = () => {
    window.clearInterval(timer);
    window.removeEventListener("pagehide", cleanup);
    channel.close();
  };
  const timer = window.setInterval(() => {
    if (popup.closed) cleanup();
  }, 500);
  window.addEventListener("pagehide", cleanup, { once: true });
  return popup;
}
