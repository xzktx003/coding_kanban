import { create } from "zustand";
import { v4 as uuid } from "uuid";
import { persist } from "zustand/middleware";
import type { OpenVsCodeWebResponse } from "@agent-orchestrator/shared";
import { openProjectVsCodeWeb } from "../../lib/api";
import { useLayoutStore } from "./useLayoutStore";

type State = {
  pinnedPath: string | null;
  hasOpened: boolean;
  entries: Record<string, OpenVsCodeWebResponse>;
  aliases: Record<string, string>;
  loading: Record<string, boolean>;
  errors: Record<string, string | undefined>;
  pin: (path: string | null) => void;
  ensure: (path: string, refresh?: boolean) => Promise<void>;
};
const inFlight = new Map<string, Promise<void>>();
// Per page identity: two tabs/devices have independent native editor selections.
// Canonical directory dedup and retained frames within this page are unchanged.
const editorClientId = uuid();
export const useVsCodePanelStore = create<State>()(
  persist(
    (set, get) => ({
      pinnedPath: null,
      hasOpened: false,
      entries: {},
      aliases: {},
      loading: {},
      errors: {},
      pin: (pinnedPath) => set({ pinnedPath }),
      ensure: (path, refresh = false) => {
        if (inFlight.has(path)) return inFlight.get(path)!;
        const canonical = get().aliases[path];
        if (!refresh && canonical && get().entries[canonical])
          return Promise.resolve();
        set((state) => ({
          loading: { ...state.loading, [path]: true },
          errors: { ...state.errors, [path]: undefined },
        }));
        const pending = (async () => {
          try {
            const response = await openProjectVsCodeWeb(path, editorClientId);
            const url = new URL(response.url, window.location.href);
            if (
              url.origin !== window.location.origin ||
              !url.pathname.startsWith("/vscode/") ||
              !response.workingDirectory
            ) {
              throw new Error("编辑器地址无效，请重新连接。");
            }
            const key = response.workingDirectory;
            set((state) => ({
              // Keep a mounted iframe's URL stable. A heartbeat or another alias
              // must not discard unsaved buffers by navigating the editor.
              entries: {
                ...state.entries,
                [key]: state.entries[key] ?? { ...response, url: url.href },
              },
              aliases: { ...state.aliases, [path]: key, [key]: key },
              errors: { ...state.errors, [path]: undefined },
            }));
          } catch (error) {
            set((state) => ({
              errors: {
                ...state.errors,
                [path]:
                  error instanceof Error
                    ? error.message
                    : "VS Code 打开失败，请重试。",
              },
            }));
            throw error;
          } finally {
            set((state) => ({ loading: { ...state.loading, [path]: false } }));
            inFlight.delete(path);
          }
        })();
        inFlight.set(path, pending);
        return pending;
      },
    }),
    {
      name: "kanban.session.vscode-panel",
      // Pin/layout intent belongs to this device. Live editor URLs and buffers do
      // not: revalidate with the server after a page refresh.
      partialize: (state) => ({
        pinnedPath: state.pinnedPath,
        hasOpened: state.hasOpened,
      }),
    },
  ),
);

export function openVsCodePanel() {
  const store = useVsCodePanelStore.getState();
  const layout = useLayoutStore.getState();
  if (!store.hasOpened) {
    layout.setRightPanelSize(55);
    useVsCodePanelStore.setState({ hasOpened: true });
  }
  layout.setActiveRightPanelTab("vscode");
  layout.setRightPanelOpen(true);
  requestAnimationFrame(() => {
    document
      .querySelector<HTMLIFrameElement>(
        ".session-mode .session-editor-frame-wrap:not([hidden]) .session-editor-frame",
      )
      ?.focus();
  });
  // The pane, and not each entry button, owns editor startup and keepalive.
}
