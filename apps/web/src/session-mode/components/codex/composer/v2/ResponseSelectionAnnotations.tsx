import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Check, Mic, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { composeContextText } from "@agent-orchestrator/shared";
import {
  isAgentInteractionVisible,
  useAgentInteractionVisible,
  useSessionPortalContainer,
} from "@session/session-dom";
import { newSessionEditId } from "@session/services/sessionEditIdentity";
import { createSideChat } from "@session/services/conversationActions";
import { sessionDraftKey } from "@session/stores/useSessionDraftStore";
import { composerDrafts, useComposerDraft } from "./drafts";
import { sendResponseAnnotation } from "./directResponseAnnotation";
import {
  captureResponseSelection,
  findResponseSelection,
  type AnnotatedContext,
  type ResponseSelection,
} from "./selectionAnnotations";
import "./response-selection.css";

type Point = { x: number; y: number };
type Selected = ResponseSelection & { itemId: string; point: Point };
type Marker = {
  id: string;
  number: number;
  point: Point;
  rects: Array<{ left: number; top: number; width: number; height: number }>;
};

/** One delegated selection observer per visible transcript, rather than per message. */
export function ResponseSelectionAnnotations({
  threadId,
  contentRef,
  getViewport,
  disabled = false,
}: {
  threadId: string;
  contentRef: RefObject<HTMLDivElement | null>;
  getViewport: () => HTMLElement | null;
  disabled?: boolean;
}) {
  const owner = sessionDraftKey("codex", threadId);
  const { contexts } = useComposerDraft(owner);
  const portal = useSessionPortalContainer();
  const visible = useAgentInteractionVisible();
  const [selection, setSelection] = useState<Selected | null>(null);
  const [editing, setEditing] = useState<{ id: string; point: Point } | null>(
    null,
  );
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [sendingIds, setSendingIds] = useState<Set<string>>(() => new Set());
  const sendingRef = useRef(new Set<string>());
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const annotations = contexts as AnnotatedContext[];
  const editable =
    editing && annotations.find((entry) => entry.id === editing.id);

  useEffect(() => {
    setSelection(null);
    setEditing(null);
  }, [threadId, disabled, visible]);

  useEffect(() => {
    if (disabled || !visible) return;
    const update = () => {
      const container = contentRef.current;
      const selected = container?.ownerDocument.getSelection();
      if (
        !container ||
        !selected ||
        selected.isCollapsed ||
        !selected.rangeCount ||
        !isAgentInteractionVisible()
      ) {
        setSelection(null);
        return;
      }
      const range = selected.getRangeAt(0);
      const startElement =
        range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement;
      const body = startElement?.closest<HTMLElement>(
        ".codex-assistant-content",
      );
      const message = body?.closest<HTMLElement>(
        ".codex-assistant[data-owner-item]",
      );
      if (
        !body ||
        !message ||
        !container.contains(body) ||
        message.dataset.ownerThread !== threadId ||
        !message.dataset.ownerItem ||
        startElement?.closest("button, input, textarea, [contenteditable=true]")
      ) {
        setSelection(null);
        return;
      }
      const captured = captureResponseSelection(body, range);
      if (!captured) {
        setSelection(null);
        return;
      }
      const viewportRect = getViewport()?.getBoundingClientRect();
      const clientRects = range.getClientRects();
      let rect: DOMRect | undefined;
      for (let index = clientRects.length - 1; index >= 0; index--) {
        const candidate = clientRects[index];
        if (
          !viewportRect ||
          (candidate.bottom > viewportRect.top &&
            candidate.top < viewportRect.bottom &&
            candidate.right > viewportRect.left &&
            candidate.left < viewportRect.right)
        ) {
          rect = candidate;
          break;
        }
      }
      if (viewportRect && !rect) {
        setSelection(null);
        return;
      }
      rect ??= range.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        setSelection(null);
        return;
      }
      setSelection({
        ...captured,
        itemId: message.dataset.ownerItem,
        point: { x: rect.left + rect.width / 2, y: rect.top },
      });
    };
    const doc = contentRef.current?.ownerDocument;
    const viewport = getViewport();
    doc?.addEventListener("selectionchange", update);
    doc?.addEventListener("mouseup", update);
    viewport?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      doc?.removeEventListener("selectionchange", update);
      doc?.removeEventListener("mouseup", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [contentRef, disabled, getViewport, threadId, visible]);

  const annotationCount = annotations.filter(
    (entry) =>
      entry.responseSelection &&
      entry.sourceThreadId === threadId &&
      entry.sourceItemId,
  ).length;
  useEffect(() => {
    const container = contentRef.current;
    const viewport = getViewport();
    if (disabled || !visible || !container || !viewport || !annotationCount) {
      setMarkers([]);
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const viewportRect = viewport.getBoundingClientRect();
      const messages = Array.from(
        container.querySelectorAll<HTMLElement>(
          ".codex-assistant[data-owner-item]",
        ),
      );
      const next: Marker[] = [];
      let number = 0;
      for (const entry of annotations) {
        if (
          !entry.responseSelection ||
          entry.sourceThreadId !== threadId ||
          !entry.sourceItemId
        )
          continue;
        number++;
        const message = messages.find(
          (item) =>
            item.dataset.ownerThread === threadId &&
            item.dataset.ownerItem === entry.sourceItemId,
        );
        const body = message?.querySelector<HTMLElement>(
          ".codex-assistant-content",
        );
        if (!body) continue;
        const range = findResponseSelection(body, {
          ...entry.responseSelection,
          text: entry.text,
        });
        if (!range) continue;
        const rects: Marker["rects"] = [];
        const rangeRects = range.getClientRects();
        for (
          let index = 0;
          index < rangeRects.length && rects.length < 200;
          index++
        ) {
          const rect = rangeRects[index];
          const left = Math.max(rect.left, viewportRect.left),
            right = Math.min(rect.right, viewportRect.right);
          const top = Math.max(rect.top, viewportRect.top),
            bottom = Math.min(rect.bottom, viewportRect.bottom);
          if (right > left && bottom > top)
            rects.push({
              left,
              top,
              width: right - left,
              height: bottom - top,
            });
        }
        const last = rects.at(-1);
        if (last)
          next.push({
            id: entry.id,
            number,
            rects,
            point: { x: last.left + last.width, y: last.top + last.height / 2 },
          });
      }
      setMarkers(next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const onScroll = () => {
      schedule();
    };
    const observer = new MutationObserver(schedule);
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    resize?.observe(viewport);
    viewport.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      observer.disconnect();
      resize?.disconnect();
      viewport.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [
    annotationCount,
    annotations,
    contentRef,
    disabled,
    getViewport,
    threadId,
    visible,
  ]);

  useEffect(() => {
    if (editing) editorRef.current?.focus();
  }, [editing?.id]);
  useEffect(() => {
    if (!editing) return;
    const outside = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest("[data-response-selection-ui]")
      )
        setEditing(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [editing]);

  const addSelection = useCallback(() => {
    if (
      !selection ||
      !isAgentInteractionVisible() ||
      !contentRef.current?.isConnected
    )
      return;
    const id = newSessionEditId();
    composerDrafts.add(owner, {
      id,
      kind: "quote",
      name: "选中的文本",
      text: selection.text,
      sourceThreadId: threadId,
      sourceItemId: selection.itemId,
      responseSelection: { start: selection.start, end: selection.end },
    } as AnnotatedContext);
    setEditing({ id, point: selection.point });
    setSelection(null);
    contentRef.current.ownerDocument.getSelection()?.removeAllRanges();
  }, [contentRef, owner, selection, threadId]);

  const sendAnnotation = useCallback(
    async (id: string) => {
      if (
        sendingRef.current.has(id) ||
        !isAgentInteractionVisible() ||
        !contentRef.current?.isConnected
      )
        return;
      sendingRef.current.add(id);
      setSendingIds(new Set(sendingRef.current));
      try {
        const result = await sendResponseAnnotation(owner, threadId, id);
        if (result.removed)
          setEditing((current) => (current?.id === id ? null : current));
        toast.success("批注已提交");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "批注发送失败，内容已保留",
        );
      } finally {
        sendingRef.current.delete(id);
        setSendingIds(new Set(sendingRef.current));
      }
    },
    [contentRef, owner, threadId],
  );

  const editorPoint =
    editing &&
    (markers.find((marker) => marker.id === editing.id)?.point ??
      editing.point);
  if (!portal || disabled || !visible) return null;
  return createPortal(
    <div className="session-response-annotations" data-response-selection-ui>
      {markers.map((marker) => (
        <div key={marker.id}>
          {marker.rects.map((rect, index) => (
            <span
              key={index}
              className="session-response-annotation-highlight"
              style={rect}
            />
          ))}
          <button
            type="button"
            className="session-response-annotation-marker"
            style={{ left: marker.point.x, top: marker.point.y }}
            aria-label={`编辑批注 ${marker.number}`}
            onClick={() => setEditing({ id: marker.id, point: marker.point })}
          >
            {marker.number}
          </button>
        </div>
      ))}
      {selection && !editing && (
        <div
          className="session-response-selection-toolbar"
          style={{
            left: Math.min(
              Math.max(selection.point.x, 120),
              window.innerWidth - 120,
            ),
            top: selection.point.y,
          }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button type="button" onClick={addSelection}>
            添加到对话
          </button>
          <button
            type="button"
            onClick={() => {
              const text = selection.text;
              setSelection(null);
              contentRef.current?.ownerDocument
                .getSelection()
                ?.removeAllRanges();
              void createSideChat(
                threadId,
                composeContextText("", [
                  {
                    id: newSessionEditId(),
                    kind: "quote",
                    name: "选中的文本",
                    text,
                    sourceThreadId: threadId,
                    sourceItemId: selection.itemId,
                  },
                ]),
              ).catch((error) => toast.error(String(error)));
            }}
          >
            侧边追问
          </button>
        </div>
      )}
      {editing && editable && editorPoint && (
        <div
          className="session-response-annotation-editor"
          role="dialog"
          aria-label="选区批注"
          style={{
            left: Math.max(
              8,
              Math.min(editorPoint.x + 10, window.innerWidth - 302),
            ),
            top: Math.max(8, Math.min(editorPoint.y, window.innerHeight - 165)),
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setEditing(null);
            }
            if (
              event.key === "Enter" &&
              (event.ctrlKey || event.metaKey) &&
              !event.altKey &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              !event.repeat
            ) {
              event.preventDefault();
              event.stopPropagation();
              void sendAnnotation(editing.id);
            }
          }}
        >
          <textarea
            ref={editorRef}
            aria-label="选区评论"
            placeholder="添加可选评论…"
            maxLength={10000}
            rows={2}
            value={editable.annotation ?? ""}
            onChange={(event) =>
              composerDrafts.replace(owner, editable.id, {
                ...editable,
                annotation: event.target.value,
              } as AnnotatedContext)
            }
          />
          <div>
            <button
              type="button"
              className="session-response-annotation-remove"
              onClick={() => {
                composerDrafts.remove(owner, editable.id);
                setEditing(null);
              }}
            >
              <Trash2 aria-hidden="true" />
              <span>移除</span>
            </button>
            <button
              type="button"
              className="session-response-annotation-mic"
              aria-label="语音输入"
              title="语音输入"
              disabled
            >
              <Mic aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              完成
            </button>
            <button
              type="button"
              className="session-response-annotation-send"
              aria-label="发送"
              disabled={sendingIds.has(editing.id)}
              onClick={() => void sendAnnotation(editing.id)}
            >
              {sendingIds.has(editing.id) ? (
                "正在提交…"
              ) : (
                <>
                  <span className="session-response-annotation-send-label">
                    发送
                  </span>
                  <Check aria-hidden="true" />
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>,
    portal,
  );
}
