/** Observe original webview rendering without replacing its documents or ports. */
export type NativeContentState = {
  ready: boolean;
  conversationId: string | null;
  hasComposer: boolean;
  composerEmpty: boolean;
  userInteracted: boolean;
  blockedByOtherApp?: boolean;
  onboarding?: boolean;
  startupError?: "renderer-timeout";
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function hasNativeWriterLock(root: HTMLElement | null): boolean {
  if (!root) return false;
  for (const button of root.querySelectorAll("button")) {
    if (button.textContent?.trim() !== "Retry") continue;
    for (
      let scope = button.parentElement, depth = 0;
      scope && scope !== root && depth < 8;
      scope = scope.parentElement, depth++
    ) {
      // Inspect only a bounded local notice. Flattening the whole transcript
      // for every composer event can allocate megabytes of text.
      const walker = scope.ownerDocument.createTreeWalker(scope, 4);
      let copy = "";
      let visited = 0;
      while (walker.nextNode() && visited++ < 64 && copy.length < 2048) {
        const value = walker.currentNode.nodeValue ?? "";
        if (value.length > 256) continue;
        copy += value;
        if (
          copy.includes("This is open in another app") &&
          copy.includes("Close it there to continue here.")
        )
          return true;
      }
    }
  }
  return false;
}

export function observeNativeContent(
  frame: HTMLIFrameElement,
  onReady: (ready: boolean) => void,
  onState?: (state: NativeContentState) => void,
) {
  const view = frame.ownerDocument.defaultView!;
  let running = false;
  let outer: Document | null = null;
  let inner: HTMLIFrameElement | null = null;
  let app: Document | null = null;
  let conversationPortal: HTMLElement | null = null;
  let composer: HTMLElement | null = null;
  let ready = false;
  let userInteracted = false;
  let lastState = "";
  let lastValue: NativeContentState | null = null;
  let observedLockRoot: HTMLElement | null = null;
  let lockCheckTimer: number | null = null;
  let lockWatchDeadline: number | null = null;
  let lockWatchExpired = false;
  const appObserver = new view.MutationObserver(() => check());
  const conversationObserver = new view.MutationObserver(() =>
    checkConversation(),
  );
  const portalStructureObserver = new view.MutationObserver(() =>
    checkConversation(),
  );
  let portalAncestors: HTMLElement[] = [];
  const stopPortalStructureWatch = () => {
    portalStructureObserver.disconnect();
    portalAncestors = [];
  };
  const watchPortalStructure = (
    portal: HTMLElement | null,
    root: HTMLElement | null,
  ) => {
    const next: HTMLElement[] = [];
    for (
      let parent = portal?.parentElement;
      parent && next.length < 64;
      parent = parent.parentElement
    ) {
      next.push(parent);
      if (parent === root) break;
    }
    if (
      next.length === portalAncestors.length &&
      next.every((parent, index) => parent === portalAncestors[index])
    )
      return;
    stopPortalStructureWatch();
    portalAncestors = next;
    // Watch only direct children along the portal's ancestry. Changes deep in
    // a sibling transcript do not rescan the application after it becomes ready.
    for (const parent of next)
      portalStructureObserver.observe(parent, { childList: true });
  };
  const lockObserver = new view.MutationObserver(() => {
    if (lockCheckTimer !== null) return;
    lockCheckTimer = view.setTimeout(() => {
      lockCheckTimer = null;
      checkConversation();
    }, 20);
  });
  const stopLockWatch = () => {
    lockObserver.disconnect();
    observedLockRoot = null;
    if (lockCheckTimer !== null) view.clearTimeout(lockCheckTimer);
    if (lockWatchDeadline !== null) view.clearTimeout(lockWatchDeadline);
    lockCheckTimer = null;
    lockWatchDeadline = null;
  };
  const publish = (value: boolean) => {
    ready = value;
    onReady(value);
  };
  const publishFailure = () => {
    const state: NativeContentState = {
      ready: false,
      conversationId: null,
      hasComposer: false,
      composerEmpty: false,
      userInteracted,
      blockedByOtherApp: false,
    };
    lastValue = state;
    publish(false);
    const key = JSON.stringify(state);
    if (lastState !== key) {
      lastState = key;
      onState?.(state);
    }
  };
  const composerIsHidden = (element: HTMLElement) => {
    for (
      let current: HTMLElement | null = element;
      current;
      current = current.parentElement
    ) {
      if (current.hidden || current.getAttribute("aria-hidden") === "true")
        return true;
      const style = view.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden")
        return true;
    }
    return false;
  };
  const readConversationState = (
    root: HTMLElement | null,
    rendered: boolean,
  ) => {
    // The pinned official timeout replaces React with a static document. Do
    // not inspect transcript text or global toasts belonging to other windows.
    const startupError =
      !root &&
      app?.title === "Codex could not start" &&
      app.body?.querySelector("h1")?.textContent?.trim() ===
        "Codex could not start" &&
      app.body?.querySelector("p")?.textContent?.trim() ===
        "The extension could not start its user interface.";
    const portal =
      root?.querySelector<HTMLElement>("[data-above-composer-portal]") ?? null;
    if (portal !== conversationPortal) {
      conversationObserver.disconnect();
      conversationPortal = portal;
      if (portal)
        conversationObserver.observe(portal, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: [
            "class",
            "aria-hidden",
            "hidden",
            "style",
            "type",
            "role",
            "contenteditable",
            "data-above-composer-conversation-id",
            "data-composer-attachment-pill",
            "data-appshot-attachment",
            "data-attachment-thumbnail-source",
          ],
        });
    }
    watchPortalStructure(portal, root);
    const candidate =
      Array.from(
        root?.querySelectorAll<HTMLElement>(
          '[contenteditable="true"], textarea, [role="textbox"]',
        ) ?? [],
      ).find(
        (element) =>
          !composerIsHidden(element) &&
          element.getAttribute("type") !== "hidden",
      ) ?? null;
    if (candidate !== composer) {
      composer?.removeEventListener("input", handleInput);
      composer = candidate;
      composer?.addEventListener("input", handleInput);
    }
    const rawId =
      portal?.getAttribute("data-above-composer-conversation-id") ?? null;
    const conversationId = rawId && UUID.test(rawId) ? rawId : null;
    const composerValue = composer
      ? composer.tagName === "TEXTAREA" || composer.tagName === "INPUT"
        ? (composer as HTMLInputElement).value
        : (composer.innerText ?? composer.textContent ?? "")
      : "";
    const hasAttachment = Boolean(
      root?.querySelector(
        "[data-composer-attachment-pill], [data-appshot-attachment], [data-attachment-thumbnail-source]",
      ),
    );
    const blockedByOtherApp = hasNativeWriterLock(root);
    const hasComposer = Boolean(composer) && !blockedByOtherApp;
    // This pinned native onboarding has Back/Next controls and no thread or
    // composer. Expose its own controls without accepting an unrelated chat.
    const buttons =
      !conversationId && !hasComposer
        ? Array.from(root?.querySelectorAll("button") ?? [], (button) =>
            button.textContent?.trim(),
          )
        : [];
    const onboarding =
      buttons.some((text) => text === "Next" || text === "下一步") &&
      buttons.some(
        (text) => text === "Back" || text === "上一步" || text === "返回",
      );
    const state: NativeContentState = {
      ready: rendered,
      conversationId,
      hasComposer,
      composerEmpty: hasComposer && !composerValue.trim() && !hasAttachment,
      userInteracted,
      blockedByOtherApp,
      ...(onboarding ? { onboarding: true } : {}),
      ...(startupError ? { startupError: "renderer-timeout" as const } : {}),
    };
    lastValue = state;
    const key = JSON.stringify(state);
    if (key !== lastState) {
      lastState = key;
      onState?.(state);
    }
    if (
      root &&
      conversationId &&
      !lockWatchExpired &&
      observedLockRoot !== root
    ) {
      stopLockWatch();
      observedLockRoot = root;
      lockObserver.observe(root, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      lockWatchDeadline = view.setTimeout(() => {
        lockWatchDeadline = null;
        lockWatchExpired = true;
        if (!lastValue?.blockedByOtherApp) stopLockWatch();
      }, 30_000);
    } else if (lockWatchExpired && observedLockRoot && !blockedByOtherApp)
      stopLockWatch();
    // The native first send can replace the entire blank composer portal.
    // Keep structural observation until the real conversation identity exists;
    // observing the detached old portal cannot discover that transition.
    if (portal && composer && conversationId) appObserver.disconnect();
    else if (app) {
      appObserver.observe(root ?? app, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "class",
          "aria-hidden",
          "hidden",
          "style",
          "type",
          "role",
          "contenteditable",
          "data-above-composer-portal",
          "data-above-composer-conversation-id",
          "data-composer-attachment-pill",
          "data-appshot-attachment",
          "data-attachment-thumbnail-source",
        ],
      });
    }
  };
  function checkConversation() {
    if (!running) return;
    try {
      const root = app?.getElementById("root") ?? null;
      const rendered = Boolean(
        root &&
        !root.querySelector(".startup-loader") &&
        root.querySelector(
          'button, [role="textbox"], [data-conversation-role], textarea, [contenteditable="true"]',
        ),
      );
      if (ready !== rendered) publish(rendered);
      readConversationState(root, rendered);
    } catch {
      conversationObserver.disconnect();
      stopPortalStructureWatch();
      appObserver.disconnect();
      stopLockWatch();
      conversationPortal = null;
      composer?.removeEventListener("input", handleInput);
      composer = null;
      publishFailure();
    }
  }
  function handleInput() {
    if (composer) userInteracted = true;
    checkConversation();
  }
  function handleUserAction() {
    checkConversation();
    if (!composer) return;
    userInteracted = true;
    checkConversation();
  }
  const check = () => {
    if (!running) return;
    try {
      const next = inner?.contentDocument ?? null;
      if (app !== next) {
        appObserver.disconnect();
        conversationObserver.disconnect();
        stopPortalStructureWatch();
        stopLockWatch();
        lockWatchExpired = false;
        composer?.removeEventListener("input", handleInput);
        app?.removeEventListener("pointerdown", handleUserAction, true);
        app?.removeEventListener("keydown", handleUserAction, true);
        app?.removeEventListener("input", handleUserAction, true);
        composer = null;
        conversationPortal = null;
        app = next;
        userInteracted = false;
        lastState = "";
        lastValue = null;
        app?.addEventListener("pointerdown", handleUserAction, true);
        app?.addEventListener("keydown", handleUserAction, true);
        app?.addEventListener("input", handleUserAction, true);
      }
      const root = app?.getElementById("root") ?? null;
      const rendered = Boolean(
        root &&
        !root.querySelector(".startup-loader") &&
        root.querySelector(
          'button, [role="textbox"], [data-conversation-role], textarea, [contenteditable="true"]',
        ),
      );
      publish(rendered);
      readConversationState(root, rendered);
      // A known composer keeps its portal and bounded ancestor structure watch.
    } catch {
      const failedApp = app;
      appObserver.disconnect();
      conversationObserver.disconnect();
      stopPortalStructureWatch();
      stopLockWatch();
      lockWatchExpired = true;
      app = null;
      conversationPortal = null;
      composer?.removeEventListener("input", handleInput);
      failedApp?.removeEventListener("pointerdown", handleUserAction, true);
      failedApp?.removeEventListener("keydown", handleUserAction, true);
      failedApp?.removeEventListener("input", handleUserAction, true);
      composer = null;
      publishFailure();
    }
  };
  const connect = () => {
    if (!running) return;
    try {
      const nextOuter = frame.contentDocument;
      if (outer !== nextOuter) {
        outerObserver.disconnect();
        outer = nextOuter;
        if (outer)
          outerObserver.observe(outer, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["id"],
          });
      }
      const nextInner =
        outer?.querySelector<HTMLIFrameElement>("iframe#active-frame") ?? null;
      if (inner !== nextInner) {
        inner?.removeEventListener("load", check);
        appObserver.disconnect();
        conversationObserver.disconnect();
        stopPortalStructureWatch();
        stopLockWatch();
        lockWatchExpired = false;
        composer?.removeEventListener("input", handleInput);
        app?.removeEventListener("pointerdown", handleUserAction, true);
        app?.removeEventListener("keydown", handleUserAction, true);
        app?.removeEventListener("input", handleUserAction, true);
        composer = null;
        conversationPortal = null;
        app = null;
        userInteracted = false;
        inner = nextInner;
        inner?.addEventListener("load", check);
      }
      check();
    } catch {
      outerObserver.disconnect();
      inner?.removeEventListener("load", check);
      appObserver.disconnect();
      conversationObserver.disconnect();
      stopPortalStructureWatch();
      stopLockWatch();
      composer?.removeEventListener("input", handleInput);
      app?.removeEventListener("pointerdown", handleUserAction, true);
      app?.removeEventListener("keydown", handleUserAction, true);
      app?.removeEventListener("input", handleUserAction, true);
      outer = null;
      inner = null;
      app = null;
      composer = null;
      conversationPortal = null;
      publishFailure();
    }
  };
  const outerObserver = new view.MutationObserver(() => connect());
  const pause = () => {
    running = false;
    frame.removeEventListener("load", connect);
    inner?.removeEventListener("load", check);
    composer?.removeEventListener("input", handleInput);
    app?.removeEventListener("pointerdown", handleUserAction, true);
    app?.removeEventListener("keydown", handleUserAction, true);
    app?.removeEventListener("input", handleUserAction, true);
    appObserver.disconnect();
    conversationObserver.disconnect();
    stopPortalStructureWatch();
    stopLockWatch();
    lockWatchExpired = false;
    outerObserver.disconnect();
    outer = null;
    inner = null;
    app = null;
    conversationPortal = null;
    composer = null;
    lastValue = null;
  };
  return {
    get ready() {
      return ready;
    },
    start() {
      if (running) return;
      running = true;
      frame.addEventListener("load", connect);
      connect();
    },
    snapshot() {
      if (!running) return null;
      // A retained reference is not evidence that the frame still owns this
      // document: native navigation can replace it before the load callback.
      connect();
      return lastValue;
    },
    pause,
    dispose: pause,
  };
}
