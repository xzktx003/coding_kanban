import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@session/components/ui/tooltip";

const HOVER_DELAY = 200;
const SKIP_DELAY = 300;
// Private notification compatibility with the pinned Radix Tooltip 1.2.8.
const TOOLTIP_OPEN = "tooltip.open";

type TriggerIdentity = {
  node: HTMLButtonElement;
  document: Document;
  view: Window;
};
type PendingHover = TriggerIdentity & { timer: number; generation: number };

function createInputController(
  publish: (value: boolean) => void,
  initialPopupOpen: boolean,
) {
  let mounted = false;
  let popupOpen = initialPopupOpen;
  let trigger: HTMLButtonElement | null = null;
  let ownerDocument: Document | null = null;
  let open = false;
  let generation = 0;
  let mountIdentity: object | null = null;
  let refRevision = 0;
  let pendingDetach: { mount: object; revision: number } | null = null;
  let detachCheck: object | null = null;
  let pending: PendingHover | null = null;
  let skipUntil = 0;
  let clickLocked = false;
  let pointerDown: number | null = null;
  let pointerReleaseToken: object | null = null;
  let removePointerRelease: (() => void) | null = null;
  let selfNotificationDepth = 0;
  const notificationToken = {};

  function cancelPending() {
    generation += 1;
    if (pending) {
      pending.view.clearTimeout(pending.timer);
      pending = null;
    }
  }

  function close() {
    cancelPending();
    if (!open) return;
    open = false;
    skipUntil = (ownerDocument?.defaultView?.performance.now() ?? 0) + SKIP_DELAY;
    if (mounted) publish(false);
  }

  function releasePointer() {
    removePointerRelease?.();
    removePointerRelease = null;
    pointerDown = null;
    pointerReleaseToken = null;
  }

  function onPeerOpen(event: Event) {
    if ((event as CustomEvent<unknown>).detail === notificationToken) return;
    // A foreign (including nested) notification is never covered by self depth.
    close();
  }

  function detachDocument() {
    ownerDocument?.removeEventListener(TOOLTIP_OPEN, onPeerOpen);
    ownerDocument = null;
  }

  function bindDocument() {
    if (!mounted || !trigger) return;
    ownerDocument = trigger.ownerDocument;
    ownerDocument.addEventListener(TOOLTIP_OPEN, onPeerOpen);
  }

  function replaceIdentity(next: HTMLButtonElement | null) {
    close();
    releasePointer();
    detachDocument();
    trigger = next;
    skipUntil = 0;
    clickLocked = false;
    bindDocument();
  }

  function scheduleDetachCheck() {
    if (detachCheck || !mountIdentity) return;
    const ticket = {};
    const expectedMount = mountIdentity;
    detachCheck = ticket;
    queueMicrotask(() => {
      if (detachCheck !== ticket) return;
      detachCheck = null;
      const detached = pendingDetach;
      if (
        !mounted ||
        mountIdentity !== expectedMount ||
        !detached ||
        detached.mount !== expectedMount ||
        detached.revision !== refRevision
      ) {
        return;
      }
      pendingDetach = null;
      replaceIdentity(null);
    });
  }

  function reconcileDocument() {
    if (trigger && mounted && trigger.ownerDocument !== ownerDocument) {
      replaceIdentity(trigger);
    }
  }

  function current(target?: HTMLButtonElement): TriggerIdentity | null {
    reconcileDocument();
    if (pendingDetach || !mounted || !trigger || (target && target !== trigger)) {
      return null;
    }
    if (!trigger.isConnected) {
      close();
      releasePointer();
      detachDocument();
      return null;
    }
    const view = ownerDocument?.defaultView;
    if (!ownerDocument || trigger.ownerDocument !== ownerDocument || !view) {
      return null;
    }
    return { node: trigger, document: ownerDocument, view };
  }

  function stillCurrent(intent: number, identity: TriggerIdentity) {
    if (popupOpen || intent !== generation) return false;
    const next = current(identity.node);
    if (!next) return false;
    return (
      !popupOpen &&
      intent === generation &&
      next.node === identity.node &&
      next.document === identity.document &&
      next.view === identity.view
    );
  }

  function commitOpen(intent: number, identity: TriggerIdentity) {
    if (open || selfNotificationDepth || !stillCurrent(intent, identity)) return;
    const event = new CustomEvent(TOOLTIP_OPEN, { detail: notificationToken });
    selfNotificationDepth += 1;
    try {
      identity.document.dispatchEvent(event);
    } finally {
      selfNotificationDepth -= 1;
    }
    if (!stillCurrent(intent, identity)) return;
    open = true;
    publish(true);
  }

  function requestHover(target: HTMLButtonElement) {
    const identity = current(target);
    if (
      popupOpen ||
      !identity ||
      open ||
      pending ||
      pointerDown !== null ||
      clickLocked
    ) {
      return;
    }
    const intent = ++generation;
    if (identity.view.performance.now() < skipUntil) {
      commitOpen(intent, identity);
      return;
    }
    const timer = identity.view.setTimeout(() => {
      if (!pending || pending.generation !== intent) return;
      pending = null;
      commitOpen(intent, identity);
    }, HOVER_DELAY);
    pending = { ...identity, timer, generation: intent };
  }

  return {
    mount(node: HTMLButtonElement | null) {
      mounted = true;
      mountIdentity = {};
      refRevision += 1;
      pendingDetach = null;
      detachCheck = null;
      replaceIdentity(node);
      publish(false);
      return () => {
        mounted = false;
        mountIdentity = null;
        refRevision += 1;
        pendingDetach = null;
        detachCheck = null;
        close();
        releasePointer();
        detachDocument();
        trigger = null;
        skipUntil = 0;
        clickLocked = false;
      };
    },
    commitPopup(value: boolean) {
      popupOpen = value;
      reconcileDocument();
      if (value) close();
    },
    captureTrigger(next: HTMLButtonElement | null) {
      refRevision += 1;
      if (next === null && mounted && mountIdentity) {
        // Slot can detach and reattach a callback ref around the same Button.
        pendingDetach = { mount: mountIdentity, revision: refRevision };
        scheduleDetachCheck();
        return;
      }
      pendingDetach = null;
      if (trigger !== next || (next && next.ownerDocument !== ownerDocument)) {
        replaceIdentity(next);
      }
    },
    onRootChange(value: boolean) {
      // A Root true callback is not a fresh owned input request. During our
      // synchronous broadcast an exiting native Content may close itself.
      if (!value && selfNotificationDepth === 0) close();
    },
    onPointerEnter(
      event: ReactPointerEvent<HTMLButtonElement>,
      suppressed: boolean,
    ) {
      if (event.defaultPrevented || event.pointerType === "touch") return;
      if (!current(event.currentTarget)) return;
      clickLocked = false;
      if (!suppressed) requestHover(event.currentTarget);
    },
    onPointerMove(
      event: ReactPointerEvent<HTMLButtonElement>,
      suppressed: boolean,
    ) {
      if (event.defaultPrevented || event.pointerType === "touch") return;
      // Slot ran the child's handler first. Veto only Radix's private opener.
      event.preventDefault();
      if (!suppressed) requestHover(event.currentTarget);
    },
    onPointerLeave(event: ReactPointerEvent<HTMLButtonElement>) {
      if (event.defaultPrevented) return;
      if (!current(event.currentTarget)) {
        event.preventDefault();
        return;
      }
      close();
    },
    onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
      if (event.defaultPrevented) return;
      const identity = current(event.currentTarget);
      close();
      clickLocked = true;
      releasePointer();
      if (!identity) return;
      pointerDown = event.pointerId;
      const releaseToken = {};
      pointerReleaseToken = releaseToken;
      const release = (released: PointerEvent) => {
        if (
          pointerReleaseToken === releaseToken &&
          trigger === identity.node &&
          ownerDocument === identity.document &&
          released.pointerId === pointerDown
        ) {
          releasePointer();
        }
      };
      identity.document.addEventListener("pointerup", release, true);
      identity.document.addEventListener("pointercancel", release, true);
      removePointerRelease = () => {
        identity.document.removeEventListener("pointerup", release, true);
        identity.document.removeEventListener("pointercancel", release, true);
      };
    },
    onFocus(event: ReactFocusEvent<HTMLButtonElement>, suppressed: boolean) {
      if (event.defaultPrevented) return;
      event.preventDefault();
      const identity = current(event.currentTarget);
      if (!identity || popupOpen || suppressed || pointerDown !== null) return;
      clickLocked = false;
      if (open) return;
      cancelPending();
      commitOpen(generation, identity);
    },
    onBlur(event: ReactFocusEvent<HTMLButtonElement>) {
      if (!event.defaultPrevented) close();
    },
    onClick(event: ReactMouseEvent<HTMLButtonElement>) {
      if (event.defaultPrevented) return;
      clickLocked = true;
      close();
    },
    onContextMenu(event: ReactMouseEvent<HTMLButtonElement>) {
      if (!event.defaultPrevented) close();
    },
  };
}

export function ComposerTooltip({
  label,
  shortcut,
  popupOpen = false,
  children,
}: {
  label: string;
  shortcut?: string;
  popupOpen?: boolean;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [controller] = useState(() => createInputController(setOpen, popupOpen));
  const triggerNode = useRef<HTMLButtonElement | null>(null);
  const captureTrigger = useCallback(
    (node: HTMLButtonElement | null) => {
      triggerNode.current = node;
      controller.captureTrigger(node);
    },
    [controller],
  );
  useLayoutEffect(() => controller.mount(triggerNode.current), [controller]);
  useLayoutEffect(() => {
    controller.commitPopup(popupOpen);
  });
  return (
    <TooltipProvider>
      <Tooltip
        disableHoverableContent
        delayDuration={200}
        open={!popupOpen && open}
        onOpenChange={controller.onRootChange}
      >
        <TooltipTrigger
          asChild
          ref={captureTrigger}
          onPointerEnter={(event) => controller.onPointerEnter(event, popupOpen)}
          onPointerMove={(event) => controller.onPointerMove(event, popupOpen)}
          onPointerLeave={controller.onPointerLeave}
          onPointerDown={controller.onPointerDown}
          onFocus={(event) => controller.onFocus(event, popupOpen)}
          onBlur={controller.onBlur}
          onClick={controller.onClick}
          onContextMenu={controller.onContextMenu}
        >
          {children}
        </TooltipTrigger>
        {open && !popupOpen && (
          <TooltipContent
            className="session-native-composer-tooltip"
            side="top"
            sideOffset={4}
          >
            <span className="session-native-composer-tooltip-label">
              {label}
              {shortcut && <kbd>{shortcut}</kbd>}
            </span>
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}
