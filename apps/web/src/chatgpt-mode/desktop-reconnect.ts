/** New symbols also initialize refs retained from a previous hot update. */
export const nextDesktopReconnectEpoch = (): symbol => Symbol('desktop-reconnect');

/** Only a real user click on the current original surface's own error control
 * may request a fresh profile. This does not connect or send a native turn. */
export function isDesktopReconnectGesture({
  frame,
  document,
  event,
  active,
}: {
  frame: HTMLIFrameElement;
  document: Document;
  event: Pick<Event, 'type' | 'isTrusted' | 'target' | 'currentTarget'>;
  active: boolean;
}): boolean {
  try {
    if (!active || event.type !== 'click' || event.isTrusted !== true ||
        event.currentTarget !== document || !frame.isConnected ||
        frame.contentDocument !== document) return false;
    const target = event.target as Element | null;
    const button = typeof target?.closest === 'function' ? target.closest('button') : null;
    const status = document.getElementById('chatgpt-host-connection-status');
    return !!button && !!status && status.isConnected && button.isConnected &&
      status.getAttribute('role') === 'alert' && button.parentElement === status &&
      button.ownerDocument === document && button.getAttribute('type') === 'button';
  } catch {
    return false;
  }
}

export type DesktopReconnectRequest = Readonly<{
  isCurrent: () => boolean;
  reload: () => void;
}>;

export function isDesktopSurfaceReconnectGesture({ frame, button, event, active }: {
  frame: HTMLIFrameElement;
  button: HTMLButtonElement;
  event: Pick<Event, 'type' | 'isTrusted' | 'currentTarget'>;
  active: boolean;
}): boolean {
  return active && event.type === 'click' && event.isTrusted === true && event.currentTarget === button &&
    frame.isConnected && button.isConnected && button.ownerDocument === frame.ownerDocument && !button.disabled;
}

/** Capture the current document and activation, not merely the reusable iframe. */
export function captureDesktopReconnectRequest({ frame, getEpoch }: {
  frame: HTMLIFrameElement;
  getEpoch: () => symbol | null;
}): DesktopReconnectRequest | null {
  try {
    const document = frame.contentDocument, child = frame.contentWindow, owner = frame.ownerDocument, source = frame.src, epoch = getEpoch();
    if (!frame.isConnected || !document || !child || epoch === null) return null;
    let reloaded = false;
    const isCurrent = () => {
      try { return frame.isConnected && frame.ownerDocument === owner && frame.contentWindow === child &&
        frame.contentDocument === document && frame.src === source && getEpoch() === epoch; }
      catch { return false; }
    };
    return Object.freeze({
      isCurrent,
      reload() {
        if (reloaded || !isCurrent()) return;
        reloaded = true;
        // An in-flight first navigation can still expose the initial blank
        // document. Re-request the pinned iframe URL rather than reload blank.
        if (document.URL === 'about:blank') frame.src = source;
        else child.location.reload();
      },
    });
  } catch { return null; }
}

const SLOW_SURFACE_MS = 20_000;

function visiblyPresent(element: Element): boolean {
  try {
    if (!element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const view = element.ownerDocument.defaultView;
    if (!view) return false;
    for (let node: Element | null = element, depth = 0; node && depth < 128; node = node.parentElement, depth++) {
      if (node.hasAttribute('hidden') || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true') return false;
      const style = view.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
    }
    return true;
  } catch { return false; }
}

function originalSurfaceIsVisible(document: Document): boolean {
  const composer = document.querySelector('[data-codex-composer]');
  if (composer && visiblyPresent(composer)) return true;
  // Login is itself a usable original screen. These are fixed UI labels, not
  // conversation text, and are only inspected locally to suppress the hint.
  const headings = document.querySelectorAll('h1,h2');
  for (let i = 0; i < Math.min(headings.length, 16); i++) {
    const heading = headings[i];
    if (['Sign in to ChatGPT', '登录 ChatGPT', '登入 ChatGPT'].includes(heading.textContent?.trim() ?? '') && visiblyPresent(heading)) return true;
  }
  const error = document.getElementById('chatgpt-host-connection-status');
  return !!error && error.getAttribute('role') === 'alert' && visiblyPresent(error);
}

/** Report uncertainty after a bounded wait; never navigate, reconnect or send. */
export function installDesktopReadinessObserver({ frame, isActive, onSlow }: {
  frame: HTMLIFrameElement;
  isActive: () => boolean;
  onSlow: (slow: boolean) => void;
}): () => void {
  let closed = false, ready = false, current: Document | null = null;
  let observer: MutationObserver | undefined, timer: number | undefined;
  const clear = () => { if (timer !== undefined) window.clearTimeout(timer); timer = undefined; };
  const active = () => !closed && frame.isConnected && isActive();
  const inspect = () => {
    try {
      if (!active() || !current || frame.contentDocument !== current || ready) return;
      if (originalSurfaceIsVisible(current)) {
        ready = true; clear(); observer?.disconnect(); observer = undefined; onSlow(false);
      }
    } catch { /* inaccessible documents remain unconfirmed */ }
  };
  const start = () => {
    if (timer !== undefined || ready || !active()) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      if (!active()) return;
      inspect();
      if (!ready) onSlow(true);
    }, SLOW_SURFACE_MS);
  };
  const attach = () => {
    if (!active()) return;
    let next: Document | null = null;
    try { next = frame.contentDocument; } catch { /* inaccessible: still unconfirmed */ }
    if (next !== current) {
      observer?.disconnect(); observer = undefined;
      if (ready) { ready = false; onSlow(false); }
      current = next;
      if (current) {
        try {
          observer = new MutationObserver(inspect);
          observer.observe(current, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'inert', 'aria-hidden', 'class', 'style', 'data-codex-composer'] });
        } catch { observer?.disconnect(); observer = undefined; }
      }
    }
    inspect(); start();
  };
  frame.addEventListener('load', attach);
  attach();
  return () => { closed = true; clear(); observer?.disconnect(); frame.removeEventListener('load', attach); };
}

/** Observe only this iframe's current document; do not alter its native bridge. */
export function installDesktopReconnectObserver({
  frame,
  getEpoch,
  onReconnect,
}: {
  frame: HTMLIFrameElement;
  getEpoch: () => symbol | null;
  onReconnect: (request: DesktopReconnectRequest) => void | Promise<void>;
}): () => void {
  let document: Document | null = null;
  let closed = false;
  let pending = false;
  const onClick = (event: Event) => {
    const captured = document;
    const epoch = getEpoch();
    if (!captured || !isDesktopReconnectGesture({ frame, document: captured, event, active: epoch !== null })) return;
    // The original child would immediately reload its old profile URL. First
    // let the parent resolve the fixed current profile after this user gesture.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (pending) return;
    pending = true;
    const request = captureDesktopReconnectRequest({ frame, getEpoch: () => closed ? null : getEpoch() });
    if (!request || getEpoch() !== epoch || frame.contentDocument !== captured) { pending = false; return; }
    void Promise.resolve().then(() => onReconnect(request)).catch(() => {}).finally(() => { pending = false; });
  };
  const attach = () => {
    document?.removeEventListener('click', onClick, true);
    document = null;
    if (closed) return;
    try {
      const current = frame.contentDocument;
      if (current && frame.isConnected) {
        document = current;
        current.addEventListener('click', onClick, true);
      }
    } catch { /* An inaccessible document has no active recovery control. */ }
  };
  frame.addEventListener('load', attach);
  attach();
  return () => {
    closed = true;
    frame.removeEventListener('load', attach);
    document?.removeEventListener('click', onClick, true);
    document = null;
  };
}
