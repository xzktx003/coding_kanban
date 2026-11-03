import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
} from "@floating-ui/dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  $setSelection,
  type RangeSelection,
} from "lexical";
import {
  sessionPortalContainer,
  useAgentInteractionVisible,
} from "@session/session-dom";
import { formatSelection, type FormatKind } from "./formatSelection";

export function FormatToolbar() {
  const [editor] = useLexicalComposerContext();
  const [open, setOpen] = useState(false);
  const [styles, setStyles] = useState(false);
  const [link, setLink] = useState(false);
  const [href, setHref] = useState("");
  const [error, setError] = useState("");
  const visible = useAgentInteractionVisible();
  const toolbar = useRef<HTMLDivElement>(null);
  const savedSelection = useRef<RangeSelection | null>(null);
  const savedRange = useRef<Range | null>(null);
  const updatePosition = useRef<(() => void) | null>(null);
  const suppressReopen = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;

  const dismiss = useCallback(() => {
    if (!openRef.current && !savedSelection.current && !savedRange.current)
      return;
    openRef.current = false;
    savedSelection.current = null;
    savedRange.current = null;
    setOpen(false);
    setStyles(false);
    setLink(false);
    setHref("");
    setError("");
  }, []);

  useEffect(() => {
    if (!visible) {
      dismiss();
      return;
    }
    const root = editor.getRootElement();
    if (!root) return;
    const doc = root.ownerDocument;
    const captureRange = () => {
      const selection = doc.getSelection();
      if (
        !selection ||
        selection.isCollapsed ||
        !selection.rangeCount ||
        !root.contains(selection.anchorNode) ||
        !root.contains(selection.focusNode)
      )
        return;
      savedRange.current = selection.getRangeAt(0).cloneRange();
      updatePosition.current?.();
    };
    const unregister = editor.registerUpdateListener(
      ({ editorState, dirtyElements, dirtyLeaves }) => {
        editorState.read(() => {
          const selection = $getSelection();
          if (toolbar.current?.contains(doc.activeElement)) {
            // A background draft replacement invalidates the captured selection.
            if (dirtyElements.size || dirtyLeaves.size) dismiss();
            return;
          }
          if (
            !suppressReopen.current &&
            !editor.isComposing() &&
            root.contains(doc.activeElement) &&
            $isRangeSelection(selection) &&
            !selection.isCollapsed()
          ) {
            savedSelection.current = selection.clone();
            captureRange();
            setOpen(true);
          } else dismiss();
        });
      },
    );
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (!root.contains(target) && !toolbar.current?.contains(target))
        dismiss();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (!openRef.current) return;
      if (
        event.key === "Tab" &&
        !event.shiftKey &&
        root.contains(event.target as Node)
      ) {
        const first = toolbar.current?.querySelector<HTMLButtonElement>(
          "button:not(:disabled)",
        );
        if (first) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key === "Tab" && event.shiftKey) {
        const first = toolbar.current?.querySelector<HTMLButtonElement>(
          "button:not(:disabled)",
        );
        if (event.target === first) {
          event.preventDefault();
          const selection = savedSelection.current?.clone();
          editor.update(() => {
            try {
              if (
                selection?.anchor.getNode().isAttached() &&
                selection.focus.getNode().isAttached()
              )
                $setSelection(selection);
            } catch {
              // The original draft may have been replaced before focus returns.
            }
          });
          editor.focus();
        }
        return;
      }
      if (event.key !== "Escape") return;
      if (
        !root.contains(event.target as Node) &&
        !toolbar.current?.contains(event.target as Node)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      const restoreFocus = toolbar.current?.contains(doc.activeElement);
      suppressReopen.current = true;
      dismiss();
      if (restoreFocus) editor.focus();
    };
    const resume = () => {
      suppressReopen.current = false;
    };
    const blur = () => {
      suppressReopen.current = true;
      dismiss();
    };
    doc.addEventListener("selectionchange", captureRange);
    doc.addEventListener("pointerdown", outside, true);
    doc.addEventListener("focusin", outside, true);
    doc.addEventListener("keydown", keyboard, true);
    root.addEventListener("pointerdown", resume, true);
    root.addEventListener("keydown", resume, true);
    root.addEventListener("compositionstart", dismiss);
    doc.defaultView?.addEventListener("blur", blur);
    return () => {
      unregister();
      doc.removeEventListener("selectionchange", captureRange);
      doc.removeEventListener("pointerdown", outside, true);
      doc.removeEventListener("focusin", outside, true);
      doc.removeEventListener("keydown", keyboard, true);
      root.removeEventListener("pointerdown", resume, true);
      root.removeEventListener("keydown", resume, true);
      root.removeEventListener("compositionstart", dismiss);
      doc.defaultView?.removeEventListener("blur", blur);
    };
  }, [editor, visible, dismiss]);

  useLayoutEffect(() => {
    const root = editor.getRootElement(),
      node = toolbar.current;
    if (!visible || !open || !root || !node) return;
    const anchor = {
      contextElement: root,
      getBoundingClientRect: () =>
        savedRange.current?.getBoundingClientRect() ??
        root.getBoundingClientRect(),
    };
    let active = true,
      revision = 0;
    const update = () => {
      const captured = ++revision;
      const range = savedRange.current;
      if (
        !range ||
        !root.contains(range.startContainer) ||
        !root.contains(range.endContainer)
      ) {
        node.style.visibility = "hidden";
        return;
      }
      void computePosition(anchor, node, {
        placement: "top",
        strategy: "fixed",
        middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        if (!active || captured !== revision) return;
        node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        node.style.visibility = "visible";
      });
    };
    updatePosition.current = update;
    const stop = autoUpdate(anchor, node, update);
    const viewport = root.ownerDocument.defaultView?.visualViewport;
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      active = false;
      if (updatePosition.current === update) updatePosition.current = null;
      stop();
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, [editor, open, visible]);

  function apply(kind: FormatKind, url = "") {
    editor.update(() => {
      const current = $getSelection();
      const selection =
        $isRangeSelection(current) && !current.isCollapsed()
          ? current
          : savedSelection.current?.clone();
      if (!selection || selection.isCollapsed()) return;
      try {
        if (
          !selection.anchor.getNode().isAttached() ||
          !selection.focus.getNode().isAttached()
        )
          return;
      } catch {
        return;
      }
      const result = formatSelection(selection.getTextContent(), kind, url);
      if (!result) return;
      if (typeof result !== "string") {
        setError(result.error);
        return;
      }
      if (selection !== current) $setSelection(selection);
      selection.insertText(result);
      dismiss();
    });
  }

  const container = sessionPortalContainer(
    editor.getRootElement()?.ownerDocument,
  );
  if (!visible || !open || !container) return null;
  return createPortal(
    <div
      ref={toolbar}
      className="session-format-toolbar"
      role="toolbar"
      aria-label="文本格式"
      style={{ visibility: "hidden" }}
      onMouseDown={(event) => {
        if ((event.target as Element).closest("button")) event.preventDefault();
      }}
    >
      <button type="button" onClick={() => apply("bold")}>
        粗体
      </button>
      <button type="button" onClick={() => apply("italic")}>
        斜体
      </button>
      <button
        type="button"
        aria-expanded={styles}
        onClick={() => setStyles((value) => !value)}
      >
        文本样式
      </button>
      {styles && (
        <div role="menu">
          <button type="button" onClick={() => apply("paragraph")}>
            正文
          </button>
          <button type="button" onClick={() => apply("h1")}>
            标题 1
          </button>
          <button type="button" onClick={() => apply("h2")}>
            标题 2
          </button>
          <button type="button" onClick={() => apply("h3")}>
            标题 3
          </button>
          <button type="button" onClick={() => apply("ul")}>
            项目符号列表
          </button>
          <button type="button" onClick={() => apply("ol")}>
            编号列表
          </button>
        </div>
      )}
      <button
        type="button"
        aria-expanded={link}
        onClick={() => setLink((value) => !value)}
      >
        链接
      </button>
      {link && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            apply("link", href);
          }}
        >
          <label>
            链接地址
            <input
              aria-label="链接地址"
              placeholder="输入或粘贴链接"
              value={href}
              onChange={(event) => setHref(event.target.value)}
            />
          </label>
          <button type="submit">应用</button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </div>,
    container,
  );
}
