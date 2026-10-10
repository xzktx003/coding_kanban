import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { I18nextProvider } from "react-i18next";
import { CodexMarkdown } from "@session/components/codex/presentation/CodexMarkdown";
import { CapturedCodexContentOwner } from "@session/components/codex/presentation/ownerContext";
import { parseFileReference } from "@session/components/codex/presentation/fileReference";
import {
  CapturedThemeProvider,
  type ThemeContextType,
} from "@session/contexts/ThemeContext";
import { SessionPortalDocumentProvider } from "@session/session-dom";
import { i18n } from "@session/lib/i18n";
import { NativeMessageCopy } from "./NativeMessageCopy";
import { downloadThreadMarkdown } from "./service";
import { planWindowChannel, readPlanWindowSnapshot } from "./planSnapshot";
import "@session/App.css";
import "@session/session-theme.css";
import "./native-message.css";
const noop = () => {};
export function PlanWindowEntry() {
  const [loaded] = useState(() => {
    const id = new URL(location.href).searchParams.get("planWindow") ?? "";
    try {
      return { id, snapshot: readPlanWindowSnapshot(id), error: null };
    } catch (error) {
      return {
        id,
        snapshot: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  const content = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    // This entry owns a separate document, including its resize and overscroll canvas.
    const body = document.body;
    const properties = ["margin", "background-color", "color-scheme"];
    const previous = properties.map((name) => ({
      name,
      value: body.style.getPropertyValue(name),
      priority: body.style.getPropertyPriority(name),
    }));
    const root = content.current?.closest<HTMLElement>(".session-mode");
    const rootBackground =
      root?.style.getPropertyValue("background-color") ?? "";
    body.style.setProperty("margin", "0");
    if (loaded.snapshot) {
      const nativeStyle = content.current && getComputedStyle(content.current);
      const nativeBackground = nativeStyle?.backgroundColor;
      const background =
        (nativeBackground &&
          nativeBackground !== "transparent" &&
          nativeBackground !== "rgba(0, 0, 0, 0)" &&
          nativeBackground) ||
        nativeStyle?.getPropertyValue("--vscode-editor-background").trim() ||
        loaded.snapshot.cssVariables["--vscode-editor-background"] ||
        loaded.snapshot.cssVariables["--background"];
      body.style.colorScheme = loaded.snapshot.theme.resolvedTheme;
      body.style.backgroundColor = "Canvas";
      if (background) body.style.backgroundColor = background;
      if (root) root.style.backgroundColor = body.style.backgroundColor;
    }
    return () => {
      if (root)
        if (rootBackground) root.style.backgroundColor = rootBackground;
        else root.style.removeProperty("background-color");
      for (const { name, value, priority } of previous)
        if (value) body.style.setProperty(name, value, priority);
        else body.style.removeProperty(name);
    };
  }, [loaded]);
  const [fileError, setFileError] = useState<string | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const requests = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    if (!loaded.snapshot) return;
    document.title = "Plan";
    document.documentElement.lang = loaded.snapshot.language;
    const bridge = new BroadcastChannel(planWindowChannel(loaded.id));
    channel.current = bridge;
    bridge.onmessage = (event) => {
      const message = event.data;
      if (
        !message ||
        message.id !== loaded.id ||
        message.type !== "fileOpened" ||
        !requests.current.has(message.requestId)
      )
        return;
      clearTimeout(requests.current.get(message.requestId));
      requests.current.delete(message.requestId);
      if (message.error) setFileError(String(message.error));
    };
    return () => {
      for (const timer of requests.current.values()) clearTimeout(timer);
      requests.current.clear();
      channel.current = null;
      bridge.close();
    };
  }, [loaded]);
  const locale = useMemo(
    () => i18n.cloneInstance({ lng: loaded.snapshot?.language ?? "en" }),
    [loaded.snapshot?.language],
  );
  if (!loaded.snapshot)
    return (
      <main className="session-mode codex-plan-window-error" role="alert">
        {loaded.error}
        <button type="button" onClick={() => window.close()}>
          关闭
        </button>
      </main>
    );
  const snapshot = loaded.snapshot;
  const theme: ThemeContextType = {
    ...snapshot.theme,
    toggleTheme: noop,
    setTheme: noop,
    setAccent: noop,
    setStarfield: noop,
    setBackgroundImage: noop,
  };
  const openFile = (event: MouseEvent) => {
    const anchor = (event.target as Element).closest?.("a");
    const href = anchor?.getAttribute("href");
    if (!href?.startsWith("#codex-file=")) return;
    event.preventDefault();
    event.stopPropagation();
    let reference: string;
    try {
      reference = decodeURIComponent(href.slice("#codex-file=".length));
    } catch {
      setFileError("文件引用无效。");
      return;
    }
    if (!parseFileReference(reference, snapshot.cwd)) {
      setFileError("文件引用无效。");
      return;
    }
    if (!channel.current) {
      setFileError("原工作台连接尚未建立，请稍后重试。");
      return;
    }
    setFileError(null);
    const requestId = crypto.randomUUID();
    requests.current.set(
      requestId,
      setTimeout(() => {
        requests.current.delete(requestId);
        setFileError("原工作台未回应，请在原会话编辑区打开该文件。");
      }, 3000),
    );
    channel.current.postMessage({
      id: loaded.id,
      type: "openFile",
      reference,
      requestId,
    });
  };
  return (
    <div
      className={snapshot.rootClassName}
      style={
        {
          ...snapshot.cssVariables,
          minHeight: "100dvh",
          width: "100%",
          overflow: "auto",
          colorScheme: snapshot.theme.resolvedTheme,
        } as CSSProperties
      }
    >
      <SessionPortalDocumentProvider ownerDocument={document}>
        <CapturedThemeProvider value={theme}>
          <I18nextProvider i18n={locale}>
            <CapturedCodexContentOwner.Provider
              value={{ threadId: snapshot.threadId, cwd: snapshot.cwd }}
            >
              <section
                ref={content}
                className="codex-presentation codex-plan-window"
                data-owner-thread={snapshot.threadId}
                data-owner-turn={snapshot.turnId}
                onClickCapture={openFile}
              >
                <header>
                  <span>Plan</span>
                  <NativeMessageCopy text={snapshot.text} />
                  <button
                    type="button"
                    onClick={() =>
                      downloadThreadMarkdown(snapshot.text, "PLAN")
                    }
                  >
                    下载
                  </button>
                  <button type="button" onClick={() => window.close()}>
                    关闭
                  </button>
                </header>
                {fileError && <p role="alert">{fileError}</p>}
                <CodexMarkdown
                  value={snapshot.text}
                  threadId={snapshot.threadId}
                />
              </section>
            </CapturedCodexContentOwner.Provider>
          </I18nextProvider>
        </CapturedThemeProvider>
      </SessionPortalDocumentProvider>
    </div>
  );
}
export default PlanWindowEntry;
