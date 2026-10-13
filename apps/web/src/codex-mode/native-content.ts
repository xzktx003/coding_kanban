/** Observe original webview rendering without replacing its documents or ports. */
export type NativeContentState = {
  ready: boolean;
  conversationId: string | null;
  hasComposer: boolean;
  composerEmpty: boolean;
  userInteracted: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
  let rootObserverTimer: number | null = null;
  let rootObserverExpired = false;
  let lastState = "";
  const appObserver = new view.MutationObserver(() => check());
  const conversationObserver = new view.MutationObserver(() =>
    checkConversation(),
  );
  const publish = (value: boolean) => {
    ready = value;
    onReady(value);
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
    const state: NativeContentState = {
      ready: rendered,
      conversationId,
      hasComposer: Boolean(composer),
      composerEmpty:
        Boolean(composer) && !composerValue.trim() && !hasAttachment,
      userInteracted,
    };
    const key = JSON.stringify(state);
    if (key !== lastState) {
      lastState = key;
      onState?.(state);
    }
    if (portal) {
      appObserver.disconnect();
      if (rootObserverTimer !== null) view.clearTimeout(rootObserverTimer);
      rootObserverTimer = null;
    } else if (app && !rootObserverExpired) {
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
      if (rootObserverTimer === null)
        rootObserverTimer = view.setTimeout(() => {
          appObserver.disconnect();
          rootObserverTimer = null;
          rootObserverExpired = true;
        }, 15_000);
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
      readConversationState(root, rendered);
    } catch {
      conversationObserver.disconnect();
      appObserver.disconnect();
      if (rootObserverTimer !== null) view.clearTimeout(rootObserverTimer);
      rootObserverTimer = null;
      rootObserverExpired = true;
      conversationPortal = null;
      composer?.removeEventListener("input", handleInput);
      composer = null;
      onState?.({
        ready: false,
        conversationId: null,
        hasComposer: false,
        composerEmpty: false,
        userInteracted,
      });
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
        if (rootObserverTimer !== null) view.clearTimeout(rootObserverTimer);
        rootObserverTimer = null;
        rootObserverExpired = false;
        composer?.removeEventListener("input", handleInput);
        app?.removeEventListener("pointerdown", handleUserAction, true);
        app?.removeEventListener("keydown", handleUserAction, true);
        app?.removeEventListener("input", handleUserAction, true);
        composer = null;
        conversationPortal = null;
        app = next;
        userInteracted = false;
        lastState = "";
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
      // Keep observing only until the composer portal and editor exist; then observe the portal alone.
    } catch {
      const failedApp = app;
      appObserver.disconnect();
      conversationObserver.disconnect();
      if (rootObserverTimer !== null) view.clearTimeout(rootObserverTimer);
      rootObserverTimer = null;
      rootObserverExpired = true;
      app = null;
      conversationPortal = null;
      composer?.removeEventListener("input", handleInput);
      failedApp?.removeEventListener("pointerdown", handleUserAction, true);
      failedApp?.removeEventListener("keydown", handleUserAction, true);
      failedApp?.removeEventListener("input", handleUserAction, true);
      composer = null;
      publish(false);
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
        if (rootObserverTimer !== null) view.clearTimeout(rootObserverTimer);
        rootObserverTimer = null;
        rootObserverExpired = false;
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
      publish(false);
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
    if (rootObserverTimer !== null) view.clearTimeout(rootObserverTimer);
    rootObserverTimer = null;
    rootObserverExpired = false;
    outerObserver.disconnect();
    outer = null;
    inner = null;
    app = null;
    conversationPortal = null;
    composer = null;
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
    pause,
    dispose: pause,
  };
}
