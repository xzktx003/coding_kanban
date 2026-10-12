/** Observe original webview rendering without replacing its documents or ports. */
export function observeNativeContent(
  frame: HTMLIFrameElement,
  onReady: (ready: boolean) => void,
) {
  const view = frame.ownerDocument.defaultView!;
  let running = false;
  let outer: Document | null = null;
  let inner: HTMLIFrameElement | null = null;
  let app: Document | null = null;
  let ready = false;
  const appObserver = new view.MutationObserver(() => check());
  const outerObserver = new view.MutationObserver(() => connect());
  const publish = (value: boolean) => {
    ready = value;
    onReady(value);
  };
  const check = () => {
    if (!running) return;
    try {
      const next = inner?.contentDocument ?? null;
      if (app !== next) {
        appObserver.disconnect();
        app = next;
      }
      const root = app?.getElementById("root");
      const rendered = Boolean(
        root &&
          !root.querySelector(".startup-loader") &&
          root.querySelector('button, [role="textbox"], [data-conversation-role]'),
      );
      publish(rendered);
      // Do not observe growing chat bodies after startup. Reload reconnects below.
      if (rendered) appObserver.disconnect();
      else if (app) appObserver.observe(app, { childList: true, subtree: true });
    } catch {
      appObserver.disconnect();
      app = null;
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
        if (outer) outerObserver.observe(outer, {
          childList: true, subtree: true, attributes: true, attributeFilter: ["id"],
        });
      }
      const nextInner = outer?.querySelector<HTMLIFrameElement>("iframe#active-frame") ?? null;
      if (inner !== nextInner) {
        inner?.removeEventListener("load", check);
        appObserver.disconnect();
        app = null;
        inner = nextInner;
        inner?.addEventListener("load", check);
      }
      check();
    } catch {
      publish(false);
    }
  };
  const pause = () => {
    running = false;
    frame.removeEventListener("load", connect);
    inner?.removeEventListener("load", check);
    appObserver.disconnect();
    outerObserver.disconnect();
    outer = null;
    inner = null;
    app = null;
  };
  return {
    get ready() { return ready; },
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
