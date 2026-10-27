import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  autoUpdate,
  computePosition,
  offset,
  flip,
  shift,
  size,
} from "@floating-ui/dom";
import { useQueueItemDragging } from "./QueueReorder";
import { fileSrc } from "@session/hooks/runtime";
import { CodexMarkdown } from "../presentation/CodexMarkdown";
import {
  useAgentInteractionVisible,
  sessionPortalContainer,
} from "@session/session-dom";
import { useComposerRailPresent } from "./ComposerRail";
import { queuePreviewLabel } from "./queuePreviewText";
import "./queue-message-preview.css";

/** Codex QueuedMessageList: selectable one-line Markdown and a read-only prompt. */
export function QueueMessagePreview({
  text,
  summary = text,
  imagePath,
  position,
  threadId,
  disabled = false,
}: {
  text: string;
  summary?: string;
  imagePath?: string;
  position: number;
  threadId: string;
  disabled?: boolean;
}) {
  const visible = useAgentInteractionVisible();
  const present = useComposerRailPresent();
  const dragging = useQueueItemDragging();
  const allowed = visible && present && !disabled && !dragging;
  const [open, setOpen] = useState(false);
  const previewId = useId();
  const trigger = useRef<HTMLDivElement>(null);
  const clamp = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const suppressFocus = useRef(false);
  const clearTimers = () => {
    clearTimeout(timer.current);
    clearTimeout(closeTimer.current);
  };
  const canOpen = () => {
    const node = clamp.current;
    return (
      !!node &&
      allowed &&
      !document.hidden &&
      ((!!text.trim() && text !== summary) ||
        node.scrollHeight > node.clientHeight ||
        node.scrollWidth > node.clientWidth)
    );
  };
  const show = () => {
    clearTimers();
    if (canOpen()) setOpen(true);
  };
  const dismiss = () => {
    clearTimers();
    setOpen(false);
  };
  useEffect(() => {
    dismiss();
    return clearTimers;
  }, [text, summary, threadId, allowed]);
  useEffect(() => {
    if (!allowed) return;
    window.addEventListener("blur", dismiss);
    const hidden = () => {
      if (document.hidden) dismiss();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("blur", dismiss);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [allowed]);
  useLayoutEffect(() => {
    const anchor = trigger.current,
      node = popup.current;
    if (!allowed || !open || !anchor || !node) return;
    let active = true,
      revision = 0;
    const update = () => {
      const captured = ++revision;
      void computePosition(anchor, node, {
        placement: "top",
        strategy: "absolute",
        middleware: [
          offset(14),
          flip({ padding: 8 }),
          shift({ padding: 8 }),
          size({
            padding: 8,
            apply({ availableWidth, availableHeight, elements }) {
              if (!active || captured !== revision) return;
              elements.floating.style.maxWidth = `min(432px, calc(100vw - 32px), ${Math.max(0, availableWidth)}px)`;
              elements.floating.style.maxHeight = `min(calc(100dvh - 16px), ${Math.max(0, availableHeight)}px)`;
            },
          }),
        ],
      }).then(({ x, y, placement }) => {
        if (!active || captured !== revision) return;
        node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        node.style.visibility = "visible";
        node.dataset.side = placement.split("-")[0];
      });
    };
    const stop = autoUpdate(anchor, node, update);
    return () => {
      active = false;
      stop();
    };
  }, [allowed, open, text, summary]);
  useEffect(() => {
    const anchor = trigger.current,
      node = popup.current;
    if (!allowed || !open || !anchor || !node) return;
    const doc = anchor.ownerDocument;
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (!anchor.contains(target) && !node.contains(target)) dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (node.contains(doc.activeElement) && anchor.isConnected) {
        suppressFocus.current = true;
        anchor.focus({ preventScroll: true });
        suppressFocus.current = false;
      }
      dismiss();
    };
    doc.addEventListener("pointerdown", outside);
    doc.addEventListener("focusin", outside);
    doc.addEventListener("keydown", escape);
    return () => {
      doc.removeEventListener("pointerdown", outside);
      doc.removeEventListener("focusin", outside);
      doc.removeEventListener("keydown", escape);
    };
  }, [allowed, open]);
  const leave = () => {
    clearTimeout(timer.current);
    closeTimer.current = setTimeout(() => {
      if (!popup.current?.contains(document.activeElement)) setOpen(false);
    }, 100);
  };
  const focusAfterTrigger = () => {
    const anchor = trigger.current;
    if (!anchor) return false;
    const walker = anchor.ownerDocument.createTreeWalker(
      anchor.ownerDocument.body,
      NodeFilter.SHOW_ELEMENT,
    );
    walker.currentNode = anchor;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (
        node instanceof HTMLElement &&
        node.tabIndex >= 0 &&
        !popup.current?.contains(node) &&
        !node.matches(":disabled") &&
        !node.closest("[hidden], [inert]") &&
        node.getClientRects().length &&
        getComputedStyle(node).visibility !== "hidden"
      ) {
        node.focus({ preventScroll: true });
        return true;
      }
    }
    return false;
  };
  const label = queuePreviewLabel(summary);
  return (
    <>
      <div
        className={
          imagePath
            ? "session-queue-preview-with-image"
            : "session-queue-preview-without-image"
        }
      >
        <div
          className={
            imagePath
              ? "session-queue-preview-image-content"
              : "session-queue-preview-without-image"
          }
        >
          {imagePath && (
            <img
              className="session-queue-image-preview"
              src={fileSrc(imagePath)}
              alt="图像附件"
              draggable={false}
            />
          )}
          <div
            ref={trigger}
            role="group"
            tabIndex={0}
            aria-label={`预览排队消息 ${position}：${label}`}
            aria-haspopup="dialog"
            aria-expanded={allowed && open}
            aria-controls={allowed && open ? previewId : undefined}
            className="session-followup-text session-queue-preview session-queue-rich-preview"
            onPointerEnter={(event) => {
              if (event.pointerType === "touch" || event.buttons !== 0) return;
              clearTimers();
              timer.current = setTimeout(show, 700);
            }}
            onPointerLeave={leave}
            onPointerDown={() => clearTimeout(timer.current)}
            onDragStart={dismiss}
            onFocus={(event) => {
              if (event.target !== event.currentTarget) return;
              if (!suppressFocus.current) show();
            }}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a,button")) return;
              show();
            }}
            onBlur={(event) => {
              if (!popup.current?.contains(event.relatedTarget as Node | null))
                leave();
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                dismiss();
              } else if (
                event.key === "Tab" &&
                !event.shiftKey &&
                open &&
                body.current
              ) {
                event.preventDefault();
                body.current.focus();
              } else if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                show();
              }
            }}
          >
            <div
              ref={clamp}
              data-queue-preview-clamp
              className="session-queue-preview-clamp"
            >
              <CodexMarkdown
                value={summary}
                threadId={threadId}
                headingAsText
              />
            </div>
          </div>
        </div>
      </div>
      {allowed &&
        open &&
        createPortal(
          <div
            role="dialog"
            style={{ visibility: "hidden" }}
            ref={popup}
            id={previewId}
            aria-label="排队消息预览"
            data-tooltip-keyboard-navigation=""
            className="codex-presentation session-queue-prompt-preview"
            onPointerEnter={() => clearTimers()}
            onPointerLeave={leave}
            onBlur={(event) => {
              if (event.relatedTarget === trigger.current) return;
              if (!popup.current?.contains(event.relatedTarget as Node | null))
                dismiss();
            }}
          >
            <div
              ref={body}
              tabIndex={0}
              className="session-queue-prompt-body"
              onKeyDown={(event) => {
                if (event.key === "Tab" && event.shiftKey) {
                  event.preventDefault();
                  trigger.current?.focus({ preventScroll: true });
                } else if (event.key === "Tab") {
                  if (focusAfterTrigger()) event.preventDefault();
                  else trigger.current?.focus({ preventScroll: true });
                  dismiss();
                }
              }}
            >
              {text.trim() ? text : summary}
            </div>
          </div>,
          sessionPortalContainer(trigger.current?.ownerDocument) ??
            document.body,
        )}
    </>
  );
}
