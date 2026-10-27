import {
  observeNativeContent,
  type NativeContentState,
} from "./native-content";

export type NativeSurfaceOptions = {
  windowIds?: readonly string[];
  onThreadState?: (panelIndex: number, state: NativeContentState) => void;
  onWindowState?: (windowId: string, state: NativeContentState) => void;
  onHostInstance?: (instanceId: string) => void;
};

export type NativeSurfaceFrame = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type NativeSurfaceLayout = {
  frames: readonly NativeSurfaceFrame[];
  interactiveId?: string | null;
};

export type NativeSurfaceHandle = {
  start: () => void;
  pause: () => void;
  dispose: () => void;
  setLayout?: (layout: NativeSurfaceLayout) => void;
  bindWindowAtColumn?: (windowId: string, column: number) => void;
  getWindowState?: (windowId: string) => NativeContentState | null;
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
): NativeSurfaceHandle {
  const view = document.defaultView;
  if (!view) throw new Error("原生界面暂时不可访问");
  const managed = new Set<HTMLIFrameElement>();
  const content = new Map<
    HTMLIFrameElement,
    ReturnType<typeof observeNativeContent>
  >();
  const contentWindowIds = new Map<HTMLIFrameElement, string | undefined>();
  const contentIdentities = new Map<HTMLIFrameElement, string>();
  const lastStates = new Map<HTMLIFrameElement, NativeContentState>();
  const dynamicBindings = new Map<string, number>();
  const initialWindowFrames = new Map<HTMLIFrameElement, string>();
  let reportedInstanceId: string | null = null;
  const publishHostInstance = () => {
    // The companion activates before VS Code restores its editor layout. An
    // early open can be moved by that restoration after its receipt completes.
    // Observe the original startup mark; do not infer readiness from a marker.
    try {
      if (
        !view.performance.getEntriesByName?.("code/didStartWorkbench", "mark")
          .length
      )
        return;
    } catch {
      return;
    }
    for (const item of document.querySelectorAll(".statusbar-item")) {
      const value = item.textContent?.match(
        /Kanban host ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/,
      );
      if (!value || value[1] === reportedInstanceId) continue;
      reportedInstanceId = value[1]!;
      options.onHostInstance?.(reportedInstanceId);
      break;
    }
  };
  let layout: NativeSurfaceLayout | null = null;
  // A retained native editor can have several cached webviews in one column.
  // Columns locate editors; only one original webview may own a window.
  const windowFrames = () => {
    const owners = new Map<string, HTMLIFrameElement>();
    for (const frame of managed) {
      const id = contentIdentities.get(frame);
      if (!id) continue;
      const previousFrame = owners.get(id);
      const exact = lastStates.get(frame)?.conversationId === id;
      const previousExact =
        previousFrame && lastStates.get(previousFrame)?.conversationId === id;
      if (!previousExact || exact) owners.set(id, frame);
    }
    return owners;
  };
  const applyLayout = () => {
    if (!layout) return;
    const placed = new Map(layout.frames.map((frame) => [frame.id, frame]));
    const owners = windowFrames();
    for (const frame of managed) {
      const identity = contentIdentities.get(frame);
      const box =
        identity && owners.get(identity) === frame
          ? placed.get(identity)
          : undefined;
      const interactive =
        Boolean(box) &&
        Boolean(layout.interactiveId) &&
        identity === layout.interactiveId;
      frame.setAttribute("data-kanban-native-hidden", String(!box));
      frame.setAttribute("data-kanban-native-interactive", String(interactive));
      if (!box) continue;
      frame.style.setProperty("--kanban-native-left", `${Math.round(box.x)}px`);
      frame.style.setProperty("--kanban-native-top", `${Math.round(box.y)}px`);
      frame.style.setProperty(
        "--kanban-native-width",
        `${Math.max(1, Math.round(box.width))}px`,
      );
      frame.style.setProperty(
        "--kanban-native-height",
        `${Math.max(1, Math.round(box.height))}px`,
      );
    }
  };
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
    {
      marker: string | null;
      hidden: string | null;
      interactive: string | null;
      column: string;
      geometry: string[];
      container: HTMLElement | null;
      ancestors: HTMLElement[];
    }
  >();
  const containers = new Map<
    HTMLElement,
    { marker: string | null; frames: Set<HTMLIFrameElement> }
  >();
  const ancestors = new Map<
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
    html.kanban-native-surface [data-kanban-native-ancestor] {
      visibility:visible!important; pointer-events:none!important;
      position:fixed!important; inset:0!important; width:100vw!important; height:100vh!important;
    }
    html.kanban-native-surface [data-kanban-native-container] {
      visibility:visible!important; clip-path:none!important;
      overflow:visible!important; pointer-events:none!important;
      position:fixed!important; inset:0!important; width:100vw!important; height:100vh!important;
    }
    html.kanban-native-surface iframe[data-kanban-native-surface] {
      visibility:visible!important; position:fixed!important; z-index:10000!important;
      top:var(--kanban-native-top, 0px)!important; bottom:auto!important; right:auto!important;
      left:var(--kanban-native-left, calc(var(--kanban-native-column) * 100% / var(--kanban-native-columns)))!important;
      width:var(--kanban-native-width, calc(100% / var(--kanban-native-columns)))!important;
      height:var(--kanban-native-height, 100%)!important;
      transform:none!important; margin:0!important; border:0!important; pointer-events:none!important;
    }
    html.kanban-native-surface iframe[data-kanban-native-surface][data-kanban-native-interactive="true"][data-kanban-native-hidden="false"] {
      pointer-events:auto!important;
    }
    html.kanban-native-surface iframe[data-kanban-native-surface][data-kanban-native-hidden="true"] {
      visibility:hidden!important; opacity:0!important; pointer-events:none!important;
    }
    /* The host owns file pickers and dialogs. Preserve those native portals
       above retained chat frames without moving their nodes or MessagePorts. */
    html.kanban-native-surface :is(.quick-input-widget, .monaco-dialog-box, .monaco-dialog-modal-block) {
      visibility:visible!important; pointer-events:auto!important; z-index:10001!important;
    }
    html.kanban-native-surface :is(.quick-input-widget, .monaco-dialog-box, .monaco-dialog-modal-block) * {
      visibility:visible!important; pointer-events:auto!important;
    }
    html.kanban-native-surface :is(.notifications-toasts, .notifications-center) {
      visibility:visible!important; pointer-events:none!important; z-index:10001!important;
    }
    html.kanban-native-surface :is(.notifications-toasts, .notifications-center) * {
      visibility:visible!important; pointer-events:auto!important;
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
  const bindAncestors = (frame: HTMLIFrameElement): HTMLElement[] => {
    const chain: HTMLElement[] = [];
    for (
      let element = frame.parentElement;
      element && element !== document.body;
      element = element.parentElement
    ) {
      if (element.classList.contains("monaco-workbench")) break;
      chain.push(element);
      let entry = ancestors.get(element);
      if (!entry) {
        entry = {
          marker: element.getAttribute("data-kanban-native-ancestor"),
          frames: new Set(),
        };
        ancestors.set(element, entry);
      }
      entry.frames.add(frame);
      element.setAttribute("data-kanban-native-ancestor", "true");
    }
    return chain;
  };
  const releaseAncestors = (
    frame: HTMLIFrameElement,
    chain: readonly HTMLElement[],
  ) => {
    for (const element of chain) {
      const entry = ancestors.get(element);
      if (!entry) continue;
      entry.frames.delete(frame);
      if (entry.frames.size) continue;
      if (entry.marker === null)
        element.removeAttribute("data-kanban-native-ancestor");
      else element.setAttribute("data-kanban-native-ancestor", entry.marker);
      ancestors.delete(element);
    }
  };
  const restore = (frame: HTMLIFrameElement) => {
    const original = previous.get(frame);
    if (!original) return;
    if (original.marker === null)
      frame.removeAttribute("data-kanban-native-surface");
    else frame.setAttribute("data-kanban-native-surface", original.marker);
    if (original.hidden === null)
      frame.removeAttribute("data-kanban-native-hidden");
    else frame.setAttribute("data-kanban-native-hidden", original.hidden);
    if (original.interactive === null)
      frame.removeAttribute("data-kanban-native-interactive");
    else
      frame.setAttribute(
        "data-kanban-native-interactive",
        original.interactive,
      );
    if (original.column)
      frame.style.setProperty("--kanban-native-column", original.column);
    else frame.style.removeProperty("--kanban-native-column");
    for (const [index, property] of [
      "--kanban-native-left",
      "--kanban-native-top",
      "--kanban-native-width",
      "--kanban-native-height",
    ].entries()) {
      if (original.geometry[index])
        frame.style.setProperty(property, original.geometry[index]!);
      else frame.style.removeProperty(property);
    }
    releaseContainer(original.container, frame);
    releaseAncestors(frame, original.ancestors);
    content.get(frame)?.dispose();
    content.delete(frame);
    contentWindowIds.delete(frame);
    contentIdentities.delete(frame);
    lastStates.delete(frame);
    managed.delete(frame);
    previous.delete(frame);
  };
  const refresh = () => {
    queued = null;
    if (!running || disposed) return;
    publishHostInstance();
    const candidates = Array.from(
      document.querySelectorAll<HTMLIFrameElement>("iframe.webview.ready"),
    ).filter((frame) => {
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
    });
    const windowIds = options.windowIds ?? [];
    const nativeEditor = (frame: HTMLIFrameElement) => {
      const flowId = frame.parentElement?.getAttribute(
        "data-parent-flow-to-element-id",
      );
      return flowId
        ? (document
            .getElementById(flowId)
            ?.closest<HTMLElement>(".editor-instance") ?? null)
        : null;
    };
    const nativeGroup = (frame: HTMLIFrameElement) =>
      nativeEditor(frame)?.closest<HTMLElement>(".editor-group-container") ??
      null;
    const groups = Array.from(
      document.querySelectorAll<HTMLElement>(".editor-group-container"),
    )
      // Native viewColumn counts collapsed/empty groups too. Filtering by
      // visible size renumbers later columns and hides a correctly opened chat.
      .sort(
        (left, right) =>
          left.getBoundingClientRect().left -
            right.getBoundingClientRect().left ||
          left.getBoundingClientRect().top - right.getBoundingClientRect().top,
      );
    const visibleFrames = candidates.filter((frame) => {
      const editor = nativeEditor(frame);
      if (editor) {
        const rect = editor.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }
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
    const frames = (visibleFrames.length ? visibleFrames : candidates).sort(
      (left, right) => {
        const leftGroup = nativeGroup(left),
          rightGroup = nativeGroup(right);
        if (
          leftGroup &&
          rightGroup &&
          groups.includes(leftGroup) &&
          groups.includes(rightGroup)
        )
          return groups.indexOf(leftGroup) - groups.indexOf(rightGroup);
        if (!visibleFrames.length) return 0;
        return (
          left.parentElement!.getBoundingClientRect().left -
          right.parentElement!.getBoundingClientRect().left
        );
      },
    );
    const nativeColumn = (frame: HTMLIFrameElement, index: number) => {
      const group = nativeGroup(frame);
      return group && groups.includes(group)
        ? groups.indexOf(group) + 1
        : index + 1;
    };
    for (const frame of managed) if (!frames.includes(frame)) restore(frame);
    document.documentElement.style.setProperty(
      "--kanban-native-columns",
      String(Math.max(1, frames.length)),
    );
    frames.forEach((frame, index) => {
      if (!managed.has(frame)) {
        previous.set(frame, {
          marker: frame.getAttribute("data-kanban-native-surface"),
          hidden: frame.getAttribute("data-kanban-native-hidden"),
          interactive: frame.getAttribute("data-kanban-native-interactive"),
          column: frame.style.getPropertyValue("--kanban-native-column"),
          geometry: [
            "--kanban-native-left",
            "--kanban-native-top",
            "--kanban-native-width",
            "--kanban-native-height",
          ].map((property) => frame.style.getPropertyValue(property)),
          container: frame.parentElement,
          ancestors: bindAncestors(frame),
        });
        managed.add(frame);
        bindContainer(frame.parentElement, frame);
      } else {
        const original = previous.get(frame)!;
        if (original.container !== frame.parentElement) {
          releaseContainer(original.container, frame);
          releaseAncestors(frame, original.ancestors);
          original.container = frame.parentElement;
          original.ancestors = bindAncestors(frame);
          bindContainer(original.container, frame);
        }
      }
      frame.setAttribute("data-kanban-native-surface", "true");
      const column = nativeColumn(frame, index);
      frame.style.setProperty("--kanban-native-column", String(column - 1));
      if (
        windowIds.length > 0 &&
        !initialWindowFrames.has(frame) &&
        windowIds[column - 1]
      )
        initialWindowFrames.set(frame, windowIds[column - 1]!);
      const boundId = Array.from(dynamicBindings).find(
        ([, boundColumn]) => boundColumn === column,
      )?.[0];
      const windowId =
        boundId && !boundId.startsWith("new:")
          ? undefined
          : windowIds.length > 0
            ? initialWindowFrames.get(frame)
            : windowIds.length === 0 && index === 0
              ? "native-default"
              : undefined;
      if (windowId) contentIdentities.set(frame, `new:${windowId}`);
      if (boundId) {
        // A blank or cached composer is not evidence that a requested thread
        // rendered. Its observed native conversation UUID must match first.
        if (
          boundId.startsWith("new:") ||
          !onReady ||
          lastStates.get(frame)?.onboarding === true ||
          lastStates.get(frame)?.startupError !== undefined ||
          lastStates.get(frame)?.conversationId === boundId
        )
          contentIdentities.set(frame, boundId);
        else if (contentIdentities.get(frame) === boundId)
          contentIdentities.delete(frame);
      }
      if (onReady) {
        let tracker = content.get(frame);
        if (tracker && contentWindowIds.get(frame) !== windowId) {
          tracker.dispose();
          content.delete(frame);
          contentWindowIds.delete(frame);
          tracker = undefined;
        }
        if (!tracker) {
          tracker = observeNativeContent(frame, publishReady, (state) => {
            lastStates.set(frame, state);
            if (windowId)
              options.onThreadState?.(windowIds.indexOf(windowId), state);
            const previousIdentity = contentIdentities.get(frame);
            const requested = Array.from(dynamicBindings).find(
              ([, column]) =>
                column ===
                Number(frame.style.getPropertyValue("--kanban-native-column")) +
                  1,
            )?.[0];
            if (
              !windowId &&
              (state.conversationId === requested || state.startupError) &&
              requested &&
              !requested.startsWith("new:")
            ) {
              // The exact native portal can arrive after a provisional blank
              // identity. Its own event is sufficient; no outer DOM change is needed.
              contentIdentities.set(frame, requested);
            } else if (!windowId && !previousIdentity?.startsWith("new:")) {
              if (state.conversationId)
                contentIdentities.set(frame, state.conversationId);
              else {
                const requested =
                  (state.onboarding || state.startupError) &&
                  Array.from(dynamicBindings).find(
                    ([, boundColumn]) =>
                      boundColumn ===
                      Number(
                        frame.style.getPropertyValue("--kanban-native-column"),
                      ) +
                        1,
                  )?.[0];
                if (requested) contentIdentities.set(frame, requested);
                else contentIdentities.delete(frame);
              }
            }
            const identity = contentIdentities.get(frame);
            if (
              previousIdentity &&
              previousIdentity !== identity &&
              !windowFrames().has(previousIdentity)
            )
              options.onWindowState?.(previousIdentity, {
                ...state,
                ready: false,
                hasComposer: false,
              });
            if (identity) options.onWindowState?.(identity, state);
            applyLayout();
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
    applyLayout();
  };
  const observer = new view.MutationObserver(() => {
    if (running && queued === null)
      queued = view.requestAnimationFrame(refresh);
  });
  const startupObserver =
    typeof view.PerformanceObserver === "function"
      ? new view.PerformanceObserver((entries) => {
          if (
            running &&
            !disposed &&
            entries
              .getEntries()
              .some((entry) => entry.name === "code/didStartWorkbench")
          )
            publishHostInstance();
        })
      : null;
  const pause = () => {
    running = false;
    observer.disconnect();
    startupObserver?.disconnect();
    view.removeEventListener("resize", applyLayout);
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
      view.addEventListener("resize", applyLayout);
      try {
        startupObserver?.observe({ type: "mark", buffered: true });
      } catch {
        startupObserver?.disconnect();
      }
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "src"],
      });
      refresh();
    },
    pause,
    setLayout(next: NativeSurfaceLayout) {
      layout = next;
      applyLayout();
    },
    bindWindowAtColumn(windowId: string, column: number) {
      if (
        !Number.isInteger(column) ||
        column < 1 ||
        !/^(?:new:)?[0-9a-f-]{36}$/.test(windowId)
      )
        return;
      for (const [id, previousColumn] of dynamicBindings)
        if (previousColumn === column && id !== windowId)
          dynamicBindings.delete(id);
      dynamicBindings.set(windowId, column);
      refresh();
      const owner = windowFrames().get(windowId);
      const state = owner && lastStates.get(owner);
      if (state) options.onWindowState?.(windowId, state);
    },
    getWindowState(windowId: string) {
      if (!running) return null;
      const owner = windowFrames().get(windowId);
      return owner ? (content.get(owner)?.snapshot() ?? null) : null;
    },
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
