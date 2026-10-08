import { useEffect, useRef, useState, type PointerEvent, type CSSProperties } from "react";
import {
  Hand,
  Pencil,
  ArrowUpRight,
  Square,
  Type,
  MessageSquare,
  Undo2,
  Redo2,
  Trash2,
  Minus,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import type {
  ImageAttachment,
  useImageAttachments,
} from "@session/components/common/useImageAttachments";
import { fileSrc } from "@session/hooks/runtime";
import { ComposerSheet } from "./ComposerSheet";
import { composerDrafts } from "./drafts";
import {
  arrowHead,
  blankDrawing,
  drawingToFile,
  drawingTextLayout,
  loadDrawingImage,
  toDrawingPoint,
  type DrawingDocument,
  type DrawingMark,
  type Point,
} from "./drawing";

function DrawingText({
  mark,
  document,
  number,
}: {
  mark: DrawingMark;
  document: DrawingDocument;
  number: number;
}) {
  const layout = drawingTextLayout(mark, document);
  return (
    <g>
      {layout.pin && (
        <>
          <circle
            cx={layout.pin.x}
            cy={layout.pin.y}
            r={12}
            fill={mark.color}
          />
          <text
            x={layout.pin.x}
            y={layout.pin.y + 5}
            textAnchor="middle"
            fontFamily="sans-serif"
            fill="white"
            fontSize={14}
          >
            {number}
          </text>
        </>
      )}
      {layout.lines.map((line, i) => (
        <text
          key={i}
          x={line.x}
          y={line.y}
          fill={mark.color}
          fontFamily="sans-serif"
          fontSize={layout.fontSize}
        >
          {line.text}
        </text>
      ))}
    </g>
  );
}

export function DrawingEditor({
  owner,
  item,
  attachments,
  onClose,
}: {
  owner: string;
  item?: ImageAttachment;
  attachments: ReturnType<typeof useImageAttachments>;
  onClose: () => void;
}) {
  const key = item?.id ?? "sketch";
  const [doc, setDoc] = useState<DrawingDocument>(
    () =>
      composerDrafts.read(owner).drawings[key] ??
      item?.drawing?.document ??
      blankDrawing(),
  );
  const [source, setSource] = useState<string>(),
    [ready, setReady] = useState(!item),
    [error, setError] = useState<string | null>(null),
    [saving, setSaving] = useState(false);
  const [tool, setTool] = useState<DrawingMark["kind"] | "hand">("pen"),
    [color, setColor] = useState("#d76b26"),
    [width, setWidth] = useState(4);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 }),
    [active, setActive] = useState<DrawingMark | null>(null),
    [redo, setRedo] = useState<DrawingMark[]>([]),
    [pending, setPending] = useState<Point | null>(null),
    [label, setLabel] = useState("");
  const svg = useRef<SVGSVGElement>(null),
    docRef = useRef(doc),
    viewRef = useRef(view),
    activeRef = useRef(active),
    mounted = useRef(true);
  docRef.current = doc;
  viewRef.current = view;
  activeRef.current = active;
  const pointers = useRef(new Map<number, Point>()),
    gesture = useRef<{
      distance: number;
      center: Point;
      view: typeof view;
    } | null>(null);
  const undoRef = useRef<DrawingMark[]>([]);
  const commit = (next: DrawingDocument) => {
    docRef.current = next;
    setDoc(next);
    composerDrafts.drawing(owner, key, next);
  };
  useEffect(() => {
    mounted.current = true;
    let stopped = false,
      objectUrl: string | undefined;
    const originalFile =
      item?.drawing?.originalFile ?? (!item?.drawing ? item?.file : undefined);
    const originalPath =
      item?.drawing?.originalPath ?? (!item?.drawing ? item?.path : undefined);
    const url = originalFile
      ? (objectUrl = URL.createObjectURL(originalFile))
      : originalPath
        ? fileSrc(originalPath)
        : undefined;
    if (url) {
      setSource(url);
      void loadDrawingImage(url)
        .then((image) => {
          if (stopped) return;
          if (!composerDrafts.read(owner).drawings[key] && !item?.drawing) {
            const scale = Math.min(
              1,
              2048 / Math.max(image.width, image.height),
            );
            commit({
              version: 1,
              width: Math.max(1, Math.round(image.width * scale)),
              height: Math.max(1, Math.round(image.height * scale)),
              marks: [],
            });
          }
          setReady(true);
        })
        .catch((e) => {
          if (!stopped) setError(String(e));
        });
    } else setReady(true);
    return () => {
      stopped = true;
      mounted.current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [owner, key]);
  const point = (e: { clientX: number; clientY: number }) =>
    toDrawingPoint(
      { x: e.clientX, y: e.clientY },
      svg.current!.getBoundingClientRect(),
      docRef.current,
      viewRef.current,
    );
  const screenPoint = (p: Point) => {
    const rect = svg.current!.getBoundingClientRect();
    return {
      x: ((p.x - rect.left) * docRef.current.width) / rect.width,
      y: ((p.y - rect.top) * docRef.current.height) / rect.height,
    };
  };
  const finish = () => {
    const mark = activeRef.current;
    if (mark) {
      commit({ ...docRef.current, marks: [...docRef.current.marks, mark] });
      setRedo([]);
    }
    activeRef.current = null;
    setActive(null);
  };
  function down(e: PointerEvent<SVGSVGElement>) {
    if (!ready || saving || e.button !== 0 || pending) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      activeRef.current = null;
      setActive(null);
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        center: screenPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
        view: { ...viewRef.current },
      };
      return;
    }
    if (pointers.current.size > 1 || tool === "hand") return;
    if (tool === "text" || tool === "comment") {
      setPending(point(e));
      setLabel("");
      return;
    }
    const mark: DrawingMark = {
      id: crypto.randomUUID(),
      kind: tool,
      points: [point(e)],
      color,
      width,
    };
    activeRef.current = mark;
    setActive(mark);
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    const old = pointers.current.get(e.pointerId);
    if (!old) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, next);
    if (pointers.current.size >= 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()],
        g = gesture.current;
      const zoom = Math.max(
        0.25,
        Math.min(
          5,
          (g.view.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / g.distance,
        ),
      );
      const center = screenPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const v = {
        zoom,
        x: center.x - ((g.center.x - g.view.x) * zoom) / g.view.zoom,
        y: center.y - ((g.center.y - g.view.y) * zoom) / g.view.zoom,
      };
      viewRef.current = v;
      setView(v);
      return;
    }
    if (tool === "hand") {
      const rect = svg.current!.getBoundingClientRect(),
        v = {
          ...viewRef.current,
          x: viewRef.current.x + ((next.x - old.x) * doc.width) / rect.width,
          y: viewRef.current.y + ((next.y - old.y) * doc.height) / rect.height,
        };
      viewRef.current = v;
      setView(v);
      return;
    }
    const mark = activeRef.current;
    if (mark && mark.points.length < 8000) {
      const updated = {
        ...mark,
        points:
          mark.kind === "pen"
            ? [...mark.points, point(e)]
            : [mark.points[0], point(e)],
      };
      activeRef.current = updated;
      setActive(updated);
    }
  }
  function up(e: PointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId);
    if (gesture.current) {
      if (!pointers.current.size) gesture.current = null;
      return;
    }
    finish();
  }
  const addLabel = () => {
    if (!pending || !label.trim()) return;
    if (
      !drawingTextLayout(
        {
          id: "preview",
          kind: tool === "comment" ? "comment" : "text",
          points: [pending],
          color,
          width,
          text: label,
        },
        docRef.current,
      ).fits
    ) {
      toast.error("文字超出画布，请减小线宽或分条标注");
      return;
    }
    commit({
      ...docRef.current,
      marks: [
        ...docRef.current.marks,
        {
          id: crypto.randomUUID(),
          kind: tool === "comment" ? "comment" : "text",
          points: [pending],
          color,
          width,
          text: label,
        },
      ],
    });
    setRedo([]);
    setPending(null);
  };
  const undo = () => {
    const mark = docRef.current.marks.at(-1);
    if (!mark) return;
    setRedo((r) => [...r, mark]);
    commit({ ...docRef.current, marks: docRef.current.marks.slice(0, -1) });
  };
  async function save() {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const snapshot = structuredClone(docRef.current);
      const file = await drawingToFile(snapshot, source);
      if (file.size > 10 * 1024 * 1024)
        throw new Error("标注图超过 10 MB，请减少内容后重试");
      attachments.addFiles(
        [file],
        {
          document: snapshot,
          originalFile:
            item?.drawing?.originalFile ??
            (!item?.drawing ? item?.file : undefined),
          originalPath:
            item?.drawing?.originalPath ??
            (!item?.drawing ? item?.path : undefined),
        },
        item?.id,
      );
      composerDrafts.clearDrawing(owner, key);
      if (mounted.current) {
        toast.success("已附加到草稿，尚未发送");
        onClose();
      }
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  const marks = [...doc.marks, ...(active ? [active] : [])];
  return (
    <ComposerSheet
      full
      title={item ? "标注图片" : "画草图"}
      description="返回保留编辑；完成后加入草稿，不直接发送。"
      onClose={() => {
        if (!saving) onClose();
      }}
      footer={
        <>
          <span>
            {ready
              ? `${doc.width} × ${doc.height} · 原图保留`
              : "正在读取原图…"}
          </span>
          <button
            type="button"
            className="session-v2-primary"
            disabled={!ready || saving || !!pending}
            onClick={() => void save()}
          >
            {saving ? "正在附加…" : "完成并附加"}
          </button>
        </>
      }
    >
      {error && <p role="alert">{error}</p>}
      <div
        className="session-drawing-tools"
        role="toolbar"
        aria-label="绘图工具"
      >
        {(
          [
            { id: "hand", name: "移动", Icon: Hand },
            { id: "pen", name: "画笔", Icon: Pencil },
            { id: "arrow", name: "箭头", Icon: ArrowUpRight },
            { id: "rect", name: "矩形", Icon: Square },
            { id: "text", name: "文字", Icon: Type },
            { id: "comment", name: "批注", Icon: MessageSquare },
          ] as const
        ).map(({ id, name, Icon }) => (
          <button
            type="button"
            key={id}
            aria-label={name}
            title={name}
            aria-pressed={tool === id}
            onClick={() => {
              finish();
              setTool(id);
              setPending(null);
            }}
          >
            <Icon />
          </button>
        ))}
        <button
          type="button"
          aria-label="撤销上一笔"
          disabled={!doc.marks.length}
          onClick={undo}
        >
          <Undo2 />
        </button>
        <button
          type="button"
          aria-label="重做上一笔"
          disabled={!redo.length}
          onClick={() => {
            const mark = redo.at(-1)!;
            commit({
              ...docRef.current,
              marks: [...docRef.current.marks, mark],
            });
            setRedo((r) => r.slice(0, -1));
          }}
        >
          <Redo2 />
        </button>
        <label>
          颜色
          <input
            type="color"
            aria-label="画笔颜色"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <label>
          线宽
          <select
            aria-label="线宽"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          >
            {[2, 4, 8, 12].map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="session-drawing-zoom">
        <button
          type="button"
          aria-label="缩小画布"
          onClick={() =>
            setView((v) => ({ ...v, zoom: Math.max(0.25, v.zoom / 1.25) }))
          }
        >
          <Minus />
        </button>
        <button type="button" onClick={() => setView({ x: 0, y: 0, zoom: 1 })}>
          {Math.round(view.zoom * 100)}% · 复位视图
        </button>
        <button
          type="button"
          aria-label="放大画布"
          onClick={() =>
            setView((v) => ({ ...v, zoom: Math.min(5, v.zoom * 1.25) }))
          }
        >
          <Plus />
        </button>
      </div>
      <svg
        ref={svg}
        className="session-drawing-canvas"
        viewBox={`0 0 ${doc.width} ${doc.height}`}
        preserveAspectRatio="none"
        style={{ aspectRatio: `${doc.width}/${doc.height}`, "--drawing-ratio":doc.width/doc.height } as CSSProperties}
        aria-label="绘图画布"
        role="img"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          activeRef.current = null;
          setActive(null);
          gesture.current = null;
        }}
      >
        <defs>
          <clipPath id={`drawing-${key}`}>
            <rect width={doc.width} height={doc.height} />
          </clipPath>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          <rect width={doc.width} height={doc.height} fill="white" />
          {source && (
            <image
              href={source}
              width={doc.width}
              height={doc.height}
              preserveAspectRatio="none"
            />
          )}
          <g clipPath={`url(#drawing-${key})`}>
            {marks.map((m, markIndex) => {
              const a = m.points[0],
                b = m.points.at(-1)!;
              const common = {
                stroke: m.color,
                strokeWidth: m.width,
                fill: "none",
                strokeLinecap: "round" as const,
                strokeLinejoin: "round" as const,
              };
              return (
                <g key={m.id}>
                  {m.kind === "rect" ? (
                    <rect
                      x={Math.min(a.x, b.x)}
                      y={Math.min(a.y, b.y)}
                      width={Math.abs(b.x - a.x)}
                      height={Math.abs(b.y - a.y)}
                      {...common}
                    />
                  ) : m.kind === "text" || m.kind === "comment" ? (
                    <DrawingText
                      mark={m}
                      document={doc}
                      number={
                        marks
                          .slice(0, markIndex + 1)
                          .filter((mark) => mark.kind === "comment").length
                      }
                    />
                  ) : (
                    <>
                      <polyline
                        points={m.points.map((p) => `${p.x},${p.y}`).join(" ")}
                        {...common}
                      />
                      {m.kind === "arrow" && (
                        <polyline
                          points={[
                            arrowHead(a, b, m.width)[0],
                            b,
                            arrowHead(a, b, m.width)[1],
                          ]
                            .map((p) => `${p.x},${p.y}`)
                            .join(" ")}
                          {...common}
                        />
                      )}
                    </>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      {pending && (
        <div className="session-drawing-comment">
          <label>
            说明文字
            <textarea
              autoFocus
              maxLength={500}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <button type="button" onClick={() => setPending(null)}>
            取消
          </button>
          <button type="button" disabled={!label.trim()} onClick={addLabel}>
            添加文字
          </button>
        </div>
      )}
      <p className="session-v2-help">
        画笔模式单指绘图、双指缩放；移动模式可单指平移。选择文字或批注后点击画布落点。
      </p>
      {!!doc.marks.length && (
        <details>
          <summary>标注记录 · {doc.marks.length}</summary>
          {doc.marks.map((m, i) => (
            <div className="session-drawing-mark" key={m.id}>
              <span>
                {i + 1}.{" "}
                {m.text ??
                  {
                    pen: "笔画",
                    arrow: "箭头",
                    rect: "矩形",
                    text: "文字",
                    comment: "批注",
                  }[m.kind]}
              </span>
              <button
                type="button"
                aria-label={`删除标注 ${i + 1}`}
                onClick={() => {
                  commit({
                    ...docRef.current,
                    marks: docRef.current.marks.filter((x) => x.id !== m.id),
                  });
                  setRedo([]);
                }}
              >
                <Trash2 />
              </button>
            </div>
          ))}
        </details>
      )}
    </ComposerSheet>
  );
}
