import { createDesktopSurfaceActivation } from "./surface-activation.mjs";

export const DESKTOP_SURFACE_HOST_KEY = "__kanbanDesktopSurfaceHostV1";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail = () =>
  Object.assign(new Error("Desktop surface host unavailable"), {
    code: "SURFACE_HOST_INVALID_BINDING",
  });
const inactive = Object.freeze({
  getSnapshot: () => null,
  isCurrent: () => false,
  subscribe: () => () => {},
  dispose: () => {},
});

/** Same-origin parent API. The DOM property exposes bind(), never the setters. */
export function installDesktopSurfaceHost({
  window: parent,
  frame,
  profileId,
  generation,
} = {}) {
  if (
    !parent?.document ||
    !frame ||
    frame.localName !== "iframe" ||
    frame.ownerDocument !== parent.document ||
    !UUID.test(profileId ?? "") ||
    !UUID.test(generation ?? "") ||
    Object.hasOwn(frame, DESKTOP_SURFACE_HOST_KEY)
  )
    throw fail();
  let url;
  try {
    url = new URL(frame.src, parent.location.href);
  } catch {
    throw fail();
  }
  if (
    url.origin !== parent.location.origin ||
    url.pathname !==
      `/chatgpt-desktop/${profileId}/${generation}/webview/index.html` ||
    url.search ||
    url.hash
  )
    throw fail();
  const activation = createDesktopSurfaceActivation({ profileId, generation });
  const bind = ({ window: child, document, scope } = {}) => {
    // window is a WindowProxy reused by navigation; compare the actual Document
    // too, so an old async callback cannot retire a newly loaded document.
    if (
      !document ||
      frame.contentWindow !== child ||
      frame.contentDocument !== document ||
      child.parent.document !== frame.ownerDocument ||
      !frame.isConnected ||
      frame.ownerDocument !== parent.document
    )
      throw fail();
    const lease = activation.bind({
      scope,
      document,
      isCurrentDocument: (captured) =>
        frame.isConnected &&
        frame.ownerDocument === parent.document &&
        frame.contentWindow === child &&
        frame.contentDocument === captured,
    });
    const onPageHide = () => {
      lease.dispose();
      child.removeEventListener("pagehide", onPageHide);
    };
    child.addEventListener("pagehide", onPageHide);
    return Object.freeze({
      getSnapshot: lease.getSnapshot,
      isCurrent: lease.isCurrent,
      subscribe: lease.subscribe,
      dispose() {
        child.removeEventListener("pagehide", onPageHide);
        lease.dispose();
      },
    });
  };
  Object.defineProperty(frame, DESKTOP_SURFACE_HOST_KEY, {
    value: Object.freeze({ version: 1, bind }),
    writable: false,
    configurable: false,
  });
  return Object.freeze({
    confirmActive: activation.confirmActive,
    checkDocument: activation.checkDocument,
    close: activation.close,
  });
}

/** Only call after the browser entry has verified its native bootstrap scope. */
export function connectDesktopSurfaceHost({
  window: child,
  document,
  scope,
} = {}) {
  try {
    const frame = child?.frameElement;
    if (
      !frame ||
      child.parent === child ||
      frame.contentWindow !== child ||
      frame.contentDocument !== document
    )
      return inactive;
    const descriptor = Object.getOwnPropertyDescriptor(
        frame,
        DESKTOP_SURFACE_HOST_KEY,
      ),
      host = descriptor?.value;
    if (
      !host ||
      host.version !== 1 ||
      typeof host.bind !== "function" ||
      descriptor.writable ||
      descriptor.configurable
    )
      return inactive;
    return host.bind({ window: child, document, scope });
  } catch {
    return inactive;
  }
}
