import {
  observeNativeContent,
  type NativeContentState,
} from "./native-content";

export type NativeSurfaceOptions = {
  windowIds?: readonly string[];
  onThreadState?: (panelIndex: number, state: NativeContentState) => void;
};

export function nativeIframeUrl(value: unknown, origin: string): string | null {
  if (typeof value !== "string" || !value.startsWith("/native-codex/"))
    return null;
  try {
    const url = new URL(value, origin);
    return url.origin === origin &&
      url.pathname.startsWith("/native-codex/") &&
      !url.hash
      ? `${url.pathname}${url.search}`
      : null;
  } catch {
    return null;
  }
}

/** Preserve the native iframe parent and MessagePort; adapt only its visual surface. */
export function mountNativeSurface(
  document: Document,
  onCount: (count: number) => void,
  onReady?: (count: number) => void,
  options: NativeSurfaceOptions = {},
) {
  const view = document.defaultView;
  if (!view) throw new Error("原生界面暂时不可访问");
  const managed = new Set<HTMLIFrameElement>();
  const content = new Map<
    HTMLIFrameElement,
    ReturnType<typeof observeNativeContent>
  >();
  const contentWindowIds = new Map<HTMLIFrameElement, string | undefined>();
  let readyCount = -1;
  const publishReady = () => {
    const next = Array.from(content.values()).filter(
      (item) => item.ready,
    ).length;
    if (readyCount !== next) {
      readyCount = next;
      onReady?.(next);
    }
  };
  const previous = new WeakMap<
    HTMLIFrameElement,
    { marker: string | null; column: string; container: HTMLElement | null }
  >();
  const containers = new Map<
    HTMLElement,
    { marker: string | null; frames: Set<HTMLIFrameElement> }
  >();
  const oldCount = document.documentElement.style.getPropertyValue(
    "--kanban-native-columns",
  );
  const style = document.createElement("style");
  style.textContent = `
    html.kanban-native-surface body { margin:0!important; overflow:hidden!important; }
    html.kanban-native-surface body * { visibility:hidden!important; }
    html.kanban-native-surface .monaco-workbench {
      visibility:visible!important; pointer-events:none!important;
    }
    html.kanban-native-surface [data-kanban-native-container] {
      visibility:visible!important; clip-path:none!important;
      overflow:visible!important; pointer-events:none!important;
    }
    html.kanban-native-surface iframe[data-kanban-native-surface] {
      visibility:visible!important; position:fixed!important; z-index:10000!important;
      top:0!important; bottom:auto!important; right:auto!important;
      left:calc(var(--kanban-native-column) * 100% / var(--kanban-native-columns))!important;
      width:calc(100% / var(--kanban-native-columns))!important; height:100%!important;
      transform:none!important; margin:0!important; border:0!important; pointer-events:auto!important;
    }
  `;
  document.head.append(style);
  document.documentElement.classList.add("kanban-native-surface");
  let disposed = false,
    running = false,
    queued: number | null = null,
    count = -1;
  const releaseContainer = (
    container: HTMLElement | null,
    frame: HTMLIFrameElement,
  ) => {
    if (!container) return;
    const original = containers.get(container);
    if (!original) return;
    original.frames.delete(frame);
    if (original.frames.size) return;
    if (original.marker === null)
      container.removeAttribute("data-kanban-native-container");
    else
      container.setAttribute("data-kanban-native-container", original.marker);
    containers.delete(container);
  };
  const bindContainer = (
    container: HTMLElement | null,
    frame: HTMLIFrameElement,
  ) => {
    if (!container) return;
    let original = containers.get(container);
    if (!original) {
      original = {
        marker: container.getAttribute("data-kanban-native-container"),
        frames: new Set(),
      };
      containers.set(container, original);
    }
    original.frames.add(frame);
    container.setAttribute("data-kanban-native-container", "true");
  };
  const restore = (frame: HTMLIFrameElement) => {
    const original = previous.get(frame);
    if (!original) return;
    if (original.marker === null)
      frame.removeAttribute("data-kanban-native-surface");
    else frame.setAttribute("data-kanban-native-surface", original.marker);
    if (original.column)
      frame.style.setProperty("--kanban-native-column", original.column);
    else frame.style.removeProperty("--kanban-native-column");
    releaseContainer(original.container, frame);
    content.get(frame)?.dispose();
    content.delete(frame);
    contentWindowIds.delete(frame);
    managed.delete(frame);
    previous.delete(frame);
  };
  const refresh = () => {
    queued = null;
    if (!running || disposed) return;
    const candidates = Array.from(
      document.querySelectorAll<HTMLIFrameElement>("iframe.webview.ready"),
    )
      .filter((frame) => {
        try {
          const url = new URL(frame.src);
          return (
            url.origin === view.location.origin &&
            url.pathname.includes(
              "/workbench/contrib/webview/browser/pre/index.html",
            ) &&
            url.searchParams.get("extensionId") === "openai.chatgpt"
          );
        } catch {
          return false;
        }
      })
      .slice(0, 32);
    const visibleFrames = candidates.filter((frame) => {
      const container = frame.parentElement;
      if (!container) return false;
      const rect = container.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < view.innerWidth &&
        rect.top < view.innerHeight
      );
    });
    const frames = (visibleFrames.length ? visibleFrames : candidates)
      .sort((left, right) => {
        if (!visibleFrames.length) return 0;
        return (
          left.parentElement!.getBoundingClientRect().left -
          right.parentElement!.getBoundingClientRect().left
        );
      })
      .slice(0, 8);
    const windowIds = options.windowIds ?? [];
    const mappedWindowIds =
      frames.length === 2 && windowIds.length === 2 ? windowIds : [];
    for (const frame of managed) if (!frames.includes(frame)) restore(frame);
    document.documentElement.style.setProperty(
      "--kanban-native-columns",
      String(Math.max(1, frames.length)),
    );
    frames.forEach((frame, index) => {
      if (!managed.has(frame)) {
        previous.set(frame, {
          marker: frame.getAttribute("data-kanban-native-surface"),
          column: frame.style.getPropertyValue("--kanban-native-column"),
          container: frame.parentElement,
        });
        managed.add(frame);
        bindContainer(frame.parentElement, frame);
      } else {
        const original = previous.get(frame)!;
        if (original.container !== frame.parentElement) {
          releaseContainer(original.container, frame);
          original.container = frame.parentElement;
          bindContainer(original.container, frame);
        }
      }
      frame.setAttribute("data-kanban-native-surface", "true");
      frame.style.setProperty("--kanban-native-column", String(index));
      if (onReady) {
        let tracker = content.get(frame);
        const windowId = mappedWindowIds[index];
        if (tracker && contentWindowIds.get(frame) !== windowId) {
          tracker.dispose();
          content.delete(frame);
          contentWindowIds.delete(frame);
          tracker = undefined;
        }
        if (!tracker) {
          tracker = observeNativeContent(frame, publishReady, (state) => {
            if (windowId) options.onThreadState?.(index, state);
          });
          content.set(frame, tracker);
          contentWindowIds.set(frame, windowId);
        }
        tracker.start();
      }
    });
    if (count !== frames.length) {
      count = frames.length;
      onCount(count);
    }
    publishReady();
  };
  const observer = new view.MutationObserver(() => {
    if (running && queued === null)
      queued = view.requestAnimationFrame(refresh);
  });
  const pause = () => {
    running = false;
    observer.disconnect();
    for (const tracker of content.values()) tracker.pause();
    if (queued !== null) {
      view.cancelAnimationFrame(queued);
      queued = null;
    }
  };
  return {
    start() {
      if (disposed || running) return;
      running = true;
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "src"],
      });
      refresh();
    },
    pause,
    dispose() {
      if (disposed) return;
      pause();
      disposed = true;
      for (const frame of managed) restore(frame);
      if (oldCount)
        document.documentElement.style.setProperty(
          "--kanban-native-columns",
          oldCount,
        );
      else
        document.documentElement.style.removeProperty(
          "--kanban-native-columns",
        );
      document.documentElement.classList.remove("kanban-native-surface");
      style.remove();
    },
  };
}
