import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAgentInteractionVisible } from "@session/session-dom";
import {
  captureHistorySourceScope,
  isHistorySourceScopeCurrent,
  watchHistorySourceScope,
} from "./historySourceScope";
import { OptionalSessionPanel } from "@session/components/layout/OptionalSessionPanel";
import { SessionApiError } from "@session/services/apiAdapt/shared";
import {
  readProviderHistoryConfirmation,
  useProviderHistoryConfirmationStore,
} from "@session/services/providerHistorySourceConfirmation";

const Reader = lazy(() => import("./ProviderHistoryDetailReader"));
const Images = lazy(() => import("./ProviderHistoryImageReader"));
export type HistoryImageReference = {
  index: number;
  mimeType: string;
  label?: string;
};
export type ProviderHistoryDetailProps = {
  provider: "cc" | "acp";
  sessionId: string;
  itemId: string;
  /** ACP connections can reuse a session ID; the exact visible owner is separate. */
  ownerKey?: string;
  active?: boolean;
  images?: readonly HistoryImageReference[];
  /** A readonly preview can outlive the source-list account or device scope. */
  originScope?: ReturnType<typeof captureHistorySourceScope>;
  /** Canonical rows require a producer-confirmed readonly source, also after HMR. */
  sourceRow?: object;
  sourceOwner?: string;
  onConfirmSource?(
    scope: ReturnType<typeof captureHistorySourceScope>,
    signal: AbortSignal,
    readCursor?: string,
  ): Promise<void>;
};

export type ProviderHistoryReaderProps = ProviderHistoryDetailProps & {
  sourceScope: ReturnType<typeof captureHistorySourceScope>;
  onClose(): void;
};

/** The visible preview does not fetch or retain the full source item. */
export function ProviderHistoryDetail(props: ProviderHistoryDetailProps) {
  const visible = useAgentInteractionVisible() && props.active !== false;
  const images = Array.isArray(props.images)
    ? props.images
        .filter(
          (image) =>
            image &&
            Number.isSafeInteger(image.index) &&
            image.index >= 0 &&
            image.index <= 31 &&
            ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
              image.mimeType,
            ),
        )
        .slice(0, 32)
    : [];
  const identity = JSON.stringify([
    props.provider,
    props.sessionId,
    props.itemId,
    props.ownerKey ?? "",
    images.map((image) => [image.index, image.mimeType]),
  ]);
  // Capture when this source preview appears, before its first gesture or any
  // optional reader import. Old rows cannot adopt a replacement account merely
  // because their source IDs happen to be identical there.
  const previewScope = useMemo(
    () =>
      captureHistorySourceScope(
        props.provider === "cc"
          ? "/api/cc/session-message-detail"
          : "/api/acp/session-detail",
      ),
    [identity],
  );
  useProviderHistoryConfirmationStore((state) => state.revision);
  const confirmation =
    props.sourceRow && props.sourceOwner
      ? readProviderHistoryConfirmation(props.sourceRow, {
          provider: props.provider,
          sourceId: props.sessionId,
          itemId: props.itemId,
          owner: props.sourceOwner,
        })
      : null;
  const requiresConfirmation = !!props.sourceRow && !!props.sourceOwner;
  const originScope =
    props.originScope ??
    confirmation?.scope ??
    (requiresConfirmation ? null : previewScope);
  const [sourceInvalid, setSourceInvalid] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const current = useRef({ identity, visible });
  current.current = { identity, visible };
  const confirmationPending = useRef<{
    controller: AbortController;
    stop(): void;
  } | null>(null);
  const [captured, setCaptured] = useState<{
    identity: string;
    mode: "text" | "image";
    sourceScope: ReturnType<typeof captureHistorySourceScope>;
  } | null>(null);
  const close = useCallback(() => setCaptured(null), []);
  const open = (mode: "text" | "image") => {
    if (!visible || !originScope || !isHistorySourceScopeCurrent(originScope)) {
      setCaptured(null);
      setSourceInvalid(true);
      return;
    }
    const path =
      mode === "image"
        ? props.provider === "cc"
          ? "/api/cc/session-message-image"
          : "/api/acp/session-image"
        : props.provider === "cc"
          ? "/api/cc/session-message-detail"
          : "/api/acp/session-detail";
    setCaptured({
      identity,
      mode,
      sourceScope: captureHistorySourceScope(path),
    });
  };
  useEffect(() => {
    if (!visible || captured?.identity !== identity) setCaptured(null);
  }, [visible, captured, identity]);
  useEffect(() => {
    setSourceInvalid(false);
    setCaptured(null);
  }, [identity, originScope, confirmation?.confirmationKey]);
  useEffect(() => {
    const cancel = () => {
      const pending = confirmationPending.current;
      confirmationPending.current = null;
      pending?.controller.abort();
      pending?.stop();
    };
    cancel();
    setConfirming(false);
    setConfirmError(null);
    return cancel;
  }, [identity, visible]);
  const confirmSource = async () => {
    if (!visible || !props.onConfirmSource || confirmationPending.current)
      return;
    const capturedIdentity = identity;
    const sourceScope = captureHistorySourceScope(
      props.provider === "cc" ? "/api/cc/session-messages" : "/api/acp/session",
    );
    const controller = new AbortController();
    const stop = watchHistorySourceScope(sourceScope, () => controller.abort());
    let stopped = false;
    const operation = {
      controller,
      stop() {
        if (!stopped) {
          stopped = true;
          stop();
        }
      },
    };
    confirmationPending.current = operation;
    setConfirming(true);
    setConfirmError(null);
    try {
      await props.onConfirmSource(
        sourceScope,
        controller.signal,
        confirmation?.readCursor,
      );
    } catch (error) {
      if (
        confirmationPending.current === operation &&
        current.current.identity === capturedIdentity &&
        current.current.visible
      )
        setConfirmError(
          controller.signal.aborted
            ? "连接已变化，请重新核对消息来源。"
            : confirmation?.readCursor &&
                error instanceof SessionApiError &&
                [403, 409].includes(error.status)
              ? "此历史页的来源已变化，请重新选择历史会话或历史页后查看。"
              : error instanceof Error
                ? error.message
                : "暂时无法核对消息来源，请重试。",
        );
    } finally {
      operation.stop();
      if (confirmationPending.current === operation) {
        confirmationPending.current = null;
        if (current.current.identity === capturedIdentity) setConfirming(false);
      }
    }
  };
  const expanded = visible && captured?.identity === identity;
  return (
    <div
      className="my-1 rounded-md border border-border/70 px-2 py-1 text-xs text-muted-foreground"
      data-provider-history-detail={props.itemId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>此消息仅显示预览。</span>
        <div className="flex flex-wrap gap-1">
          {images.length > 0 && (
            <button
              type="button"
              className="min-h-11 rounded px-2 underline underline-offset-2 focus-visible:outline-2"
              disabled={!visible || confirming}
              aria-expanded={expanded && captured?.mode === "image"}
              onClick={() =>
                expanded && captured?.mode === "image" ? close() : open("image")
              }
            >
              {expanded && captured?.mode === "image" ? "关闭图片" : "查看图片"}
            </button>
          )}
          <button
            type="button"
            className="min-h-11 rounded px-2 underline underline-offset-2 focus-visible:outline-2"
            disabled={!visible || confirming}
            aria-expanded={expanded && captured?.mode === "text"}
            onClick={() =>
              expanded && captured?.mode === "text" ? close() : open("text")
            }
          >
            {expanded && captured?.mode === "text"
              ? "关闭完整内容"
              : "查看完整内容"}
          </button>
        </div>
      </div>
      {sourceInvalid && (
        <p role="status" className="py-1">
          此预览的来源已变化，请重新加载会话后查看完整内容。
        </p>
      )}
      {(sourceInvalid || !originScope) && props.onConfirmSource && (
        <div className="flex flex-wrap items-center gap-2 py-1">
          <button
            type="button"
            className="min-h-11 rounded px-2 underline underline-offset-2"
            disabled={!visible || confirming}
            onClick={() => void confirmSource()}
          >
            {confirming ? "正在核对来源…" : "重新核对来源"}
          </button>
          {confirmError && <p role="alert">{confirmError}</p>}
        </div>
      )}
      {expanded && (
        <OptionalSessionPanel label="完整内容" onClose={close}>
          <Suspense
            fallback={
              <p role="status" className="py-2">
                正在准备只读内容…
              </p>
            }
          >
            {captured?.mode === "image" ? (
              <Images
                key={identity}
                {...props}
                images={images}
                sourceScope={captured.sourceScope}
                onClose={close}
              />
            ) : (
              <Reader
                key={identity}
                {...props}
                sourceScope={captured!.sourceScope}
                onClose={close}
              />
            )}
          </Suspense>
        </OptionalSessionPanel>
      )}
    </div>
  );
}
