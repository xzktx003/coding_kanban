import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Download,
  Pencil,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ImageGenerationItem } from "@session/bindings/ImageGenerationItem";
import type { TurnStatus } from "@session/bindings/v2/TurnStatus";
import type { ImageAttachment } from "@session/components/common/useImageAttachments";
import { useImageAttachments } from "@session/components/common/useImageAttachments";
import { sessionDraftKey } from "@session/stores/useSessionDraftStore";
import { DrawingEditor } from "../composer/v2/DrawingEditor";
import { CodexImage } from "../presentation/CodexImage";
import { nativeImageData } from "../presentation/nativeMedia";
import { readToolImage } from "../presentation/readToolImage";
import { parseFileReference } from "../presentation/fileReference";
import { useCodexContentOwner } from "../presentation/ownerContext";
import { NativeToolDisclosure } from "./NativeToolDisclosure";
import { nativeImageGalleryLayout } from "../presentation/nativeImageGalleryLayout";

type CapturedEditor = { owner: string; item: ImageAttachment };
function CapturedGeneratedImageEditor({
  value,
  onClose,
}: {
  value: CapturedEditor;
  onClose: () => void;
}) {
  const attachments = useImageAttachments(value.owner);
  return (
    <DrawingEditor
      owner={value.owner}
      item={value.item}
      attachments={attachments}
      onClose={onClose}
    />
  );
}
function embeddedImageFile(src: string, id: string) {
  const match = src.match(/^data:(image\/[\w.+-]+);base64,([\s\S]+)$/);
  if (!match) throw new Error("Image pixels are unavailable for editing");
  const bytes = Uint8Array.from(atob(match[2].replace(/\s/g, "")), (char) =>
    char.charCodeAt(0),
  );
  return new File(
    [bytes],
    `${id.replace(/[^\w.-]/g, "_")}.${match[1].split("/")[1]}`,
    { type: match[1] },
  );
}
function GeneratedImageTile({
  item,
  height,
  width,
  onRatio,
}: {
  item: ImageGenerationItem;
  height: number;
  width: number;
  onRatio: (ratio: number) => void;
}) {
  const { t, i18n } = useTranslation("thread"),
    chinese = (i18n?.language ?? "zh").startsWith("zh"),
    { threadId, cwd } = useCodexContentOwner();
  const identity = JSON.stringify([
      threadId,
      cwd,
      item.id,
      item.savedPath,
      item.result,
    ]),
    mounted = useRef(true);
  const [source, setSource] = useState<{
      identity: string;
      src: string;
    } | null>(null),
    [editor, setEditor] = useState<CapturedEditor | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const embedded = nativeImageData(item.result),
    resolved = item.savedPath
      ? parseFileReference(item.savedPath, cwd)?.path
      : null;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!embedded && resolved)
      void readToolImage(resolved, threadId).then(
        (data) => {
          const src = nativeImageData(data);
          if (!cancelled && src) setSource({ identity, src });
        },
        (error) => {
          if (!cancelled) setError(String(error));
        },
      );
    return () => {
      cancelled = true;
    };
  }, [identity, embedded, resolved, threadId]);
  const src = embedded ?? (source?.identity === identity ? source.src : null);
  async function edit() {
    if (!src || !threadId || busy) return;
    const owner = sessionDraftKey("codex", threadId, cwd),
      source = src,
      id = item.id;
    setBusy(true);
    setError(null);
    try {
      const file = source.startsWith("data:")
        ? embeddedImageFile(source, id)
        : await fetch(source, { credentials: "omit" }).then(
            async (response) => {
              if (!response.ok)
                throw new Error(`Image read failed (${response.status})`);
              const blob = await response.blob();
              if (!blob.type.startsWith("image/"))
                throw new Error("Image pixels are unavailable for editing");
              return new File([blob], `${id}.png`, { type: blob.type });
            },
          );
      if (mounted.current)
        setEditor({
          owner,
          item: {
            id: `generated:${id}`,
            name: file.name,
            preview: source,
            file,
            status: "ready",
          },
        });
    } catch (error) {
      if (mounted.current) setError(String(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  if (!src) return error ? <p role="alert">{error}</p> : null;
  return (
    <div
      className="codex-native-generated-tile"
      style={{ height, width }}
      onLoadCapture={(event) => {
        const image = event.target;
        if (
          image instanceof HTMLImageElement &&
          image.closest(".codex-image-preview") &&
          image.src === src &&
          image.naturalWidth > 0 &&
          image.naturalHeight > 0
        )
          onRatio(image.naturalWidth / image.naturalHeight);
      }}
    >
      <CodexImage src={src} alt={t("activity.generatedImage")} />
      <div className="codex-native-generated-actions">
        <a
          href={src}
          download={`${item.id}.png`}
          aria-label={chinese ? "下载图片" : "Download image"}
        >
          <Download size={16} />
        </a>
        {threadId && (
          <button
            type="button"
            aria-label={chinese ? "编辑图片" : "Edit image"}
            disabled={busy}
            onClick={() => void edit()}
          >
            {busy ? <Loader2 size={16} /> : <Pencil size={16} />}
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {editor && (
        <CapturedGeneratedImageEditor
          key={editor.owner + editor.item.id}
          value={editor}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
export function NativeGeneratedImages({
  items,
  running = false,
  termination,
}: {
  items: readonly ImageGenerationItem[];
  running?: boolean;
  termination?: TurnStatus;
}) {
  const { t } = useTranslation("thread"),
    usable = items.filter(
      (item) => nativeImageData(item.result) || item.savedPath,
    );
  const pending =
    running && !termination
      ? items.filter(
          (item) =>
            !nativeImageData(item.result) &&
            !item.savedPath &&
            (item.status === "in_progress" || item.status === "inProgress"),
        )
      : [];
  const frame = useRef<HTMLDivElement>(null),
    [frameWidth, setFrameWidth] = useState<number | null>(null),
    [ratios, setRatios] = useState<Record<string, number>>({}),
    [start, setStart] = useState(0);
  const singleRatio =
    usable.length === 1 && !pending.length ? (ratios[usable[0].id] ?? 1) : null;
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => {
      const width = Math.floor(element.getBoundingClientRect().width);
      if (width > 0) setFrameWidth(width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [usable.length, singleRatio]);
  const layout = nativeImageGalleryLayout(
      frameWidth,
      [...usable.map((item) => ratios[item.id] ?? 1), ...pending.map(() => 1)],
      pending.length ? 4 : 0,
    ),
    index = Math.min(start, layout.maxStartIndex);
  if (usable.length)
    return (
      <div
        ref={frame}
        className="codex-native-generated-gallery"
        style={{
          height: layout.height,
          maxWidth:
            singleRatio === null
              ? undefined
              : singleRatio >= 2
                ? "var(--thread-content-max-width, 100%)"
                : singleRatio >= 1
                  ? 480
                  : 400,
        }}
      >
        <div
          className="codex-native-generated-track"
          style={{
            transform: layout.square
              ? `translateX(-${index * (layout.height + 8)}px)`
              : undefined,
          }}
        >
          {usable.map((item) => (
            <GeneratedImageTile
              key={item.id}
              item={item}
              height={layout.height}
              width={
                layout.height * (layout.square ? 1 : (ratios[item.id] ?? 1))
              }
              onRatio={(ratio) =>
                setRatios((previous) =>
                  previous[item.id] === ratio
                    ? previous
                    : { ...previous, [item.id]: ratio },
                )
              }
            />
          ))}
          {pending.map((item) => (
            <div
              key={item.id}
              className="codex-generated-placeholder"
              role="status"
              style={{
                height: layout.height,
                width: layout.height,
                flexShrink: 0,
              }}
            >
              <Loader2 size={16} className="animate-spin" />
              {t("activity.generatingImage")}
            </div>
          ))}
        </div>
        {layout.overflowCount > 0 && (
          <div className="codex-native-generated-pagination">
            <button
              type="button"
              aria-label="上一组图片"
              disabled={index === 0}
              onClick={() => setStart(index - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              {index + 1}/{layout.maxStartIndex + 1}
            </span>
            <button
              type="button"
              aria-label="下一组图片"
              disabled={index === layout.maxStartIndex}
              onClick={() => setStart(index + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    );
  if (running && !termination)
    return (
      <div className="codex-generated-placeholder" role="status">
        <Loader2 size={16} className="animate-spin" />
        {t("activity.generatingImage")}
      </div>
    );
  return (
    <NativeToolDisclosure
      summary={t(
        items.some((item) => item.status === "failed") ||
          termination === "failed"
          ? "activity.imageFailed"
          : termination === "interrupted"
            ? "activity.interrupted"
            : "activity.imageUnavailable",
      )}
    />
  );
}
