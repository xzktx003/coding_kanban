import { NativeRichPreviewBody } from "./NativeRichPreviewBody";
import { useNativeRichPreviewSide } from "./useNativeRichPreviewSide";
import type { NativePreviewImage as PreviewImage } from "@agent-orchestrator/shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useTranslation } from "react-i18next";
import { useReducedMotion } from "framer-motion";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@session/components/ui/tooltip";
import { useSessionInteractionVisible } from "@session/session-dom";
import { createNativeSlackPreviewTransport } from "@session/features/native-slack/service";
import { NativeExternalOpenIcon, NativeSlackIcon } from "./NativeSlackIcons";
import {
  nativeSlackResult,
  nativeSlackTarget,
  nativeSlackUrl,
  type NativeSlackTarget,
} from "./nativeSlackPreview";

export type NativeRichPreviewData =
  | { status: "unavailable" }
  | {
      status: "ready";
      title: string | null;
      description: string | null;
      image?: PreviewImage | null;
    };
/** A host must provide an account/host/server/tool/target identity, never a URL fetcher. */
export type NativeRichPreviewTransport<T> = {
  /** Visible bodies keep their own lifetime; cache GC starts after closing. */
  setVisible?(visible: boolean): void;
  identity(target: T): string | null;
  prepare?(
    target: T,
    signal: AbortSignal,
    beforeRequest: () => void,
  ): Promise<string | null>;
  normalize?(value: unknown, target: T): NativeRichPreviewData;
  read(
    target: T,
    signal: AbortSignal,
    beforeRequest: () => void,
  ): Promise<unknown>;
  subscribe?(changed: (options?: { reload?: boolean }) => void): () => void;
};
export type NativeSlackPreviewTransport =
  NativeRichPreviewTransport<NativeSlackTarget>;
export const NativeSlackPreviewHost = createContext<
  NativeSlackPreviewTransport | null | undefined
>(undefined);

export function NativeSlackPreview({
  href,
  children,
}: {
  href: string;
  children: ReactElement;
}) {
  const injectedHost = useContext(NativeSlackPreviewHost);
  const productionHost = useMemo(
    () => createNativeSlackPreviewTransport(href),
    [href],
  );
  const target = useMemo(() => nativeSlackTarget(href), [href]);
  return (
    <NativeRichLinkPreview
      href={href}
      target={target}
      host={injectedHost === undefined ? productionHost : injectedHost}
      hostname={nativeSlackUrl(href)?.hostname ?? href}
      icon={<NativeSlackIcon />}
      normalize={nativeSlackResult}
    >
      {children}
    </NativeRichLinkPreview>
  );
}

/** Shared native D3 rich tooltip controller; adapters own only target and bounded display data. */
export function NativeRichLinkPreview<T>({
  href,
  target,
  host,
  hostname,
  icon,
  normalize,
  fallback,
  format,
  staleTime,
  className = "",
  children,
}: {
  href: string;
  target: T | null;
  host: NativeRichPreviewTransport<T> | null;
  hostname: string;
  icon: ReactElement;
  normalize: (value: unknown, target: T) => NativeRichPreviewData;
  staleTime?: (data: NativeRichPreviewData) => number;
  fallback?: NativeRichPreviewData & { status: "ready" };
  format?: (
    data: NativeRichPreviewData & { status: "ready" },
  ) => NativeRichPreviewData & { status: "ready" };
  className?: string;
  children: ReactElement;
}) {
  const visible = useSessionInteractionVisible();
  const { i18n } = useTranslation(),
    zh = (i18n.language ?? "zh").startsWith("zh"),
    ja = (i18n.language ?? "").startsWith("ja");
  const reducedMotion = useReducedMotion();
  const [revision, setRevision] = useState(0);
  const dataRef = useRef<NativeRichPreviewData | null>({
    status: "unavailable",
  });
  const settleFrame = useRef<number | undefined>(undefined);
  const data = dataRef.current;
  const setData = (value: NativeRichPreviewData | null) => {
    const previous = dataRef.current;
    dataRef.current = value;
    setRevision((r) => r + 1);
    if (
      previous?.status === "ready" &&
      previous.image &&
      previous !== value &&
      typeof requestAnimationFrame === "function"
    ) {
      // Retire previous React effect/element props too, not only the visible cache ref.
      if (settleFrame.current !== undefined)
        cancelAnimationFrame(settleFrame.current);
      settleFrame.current = requestAnimationFrame(() => {
        settleFrame.current = undefined;
        setRevision((r) => r + 1);
      });
    }
  };
  const [open, setOpen] = useState(false),
    [side, setSide] = useState<"top" | "bottom">("bottom");
  useEffect(() => {
    host?.setVisible?.(open && visible);
    return () => host?.setVisible?.(false);
  }, [host, open, visible]);
  const suppressFocus = useRef(false);
  const triggerElement = useRef<HTMLElement | null>(null);
  const popup = useRef<HTMLDivElement>(null),
    timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [popupNode, setPopupNode] = useState<HTMLDivElement | null>(null);
  const attachPopup = useCallback((node: HTMLDivElement | null) => {
    popup.current = node;
    setPopupNode(node);
  }, []);
  const placedSide = useNativeRichPreviewSide(
    triggerElement,
    popupNode,
    open && visible,
    side,
  );
  const pending = useRef<AbortController | null>(null),
    generation = useRef(0);
  const cache = useRef<{
    identity: string;
    data: NativeRichPreviewData;
    stale: number;
  } | null>(null);
  const gcTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const stopPrefetchEscape = useRef<(() => void) | undefined>(undefined);
  const latest = useRef({ open: false, visible: false, prefetch: () => {} });
  const cancelPrefetch = () => {
    clearTimeout(timer.current);
    stopPrefetchEscape.current?.();
    stopPrefetchEscape.current = undefined;
  };
  const cancel = () => {
    cancelPrefetch();
    pending.current?.abort();
    pending.current = null;
    generation.current++;
  };
  useEffect(() => {
    cancel();
    cache.current = null;
    setData({ status: "unavailable" });
    setOpen(false);
    return () => {
      cancel();
      clearTimeout(gcTimer.current);
      clearTimeout(closeTimer.current);
      if (settleFrame.current !== undefined)
        cancelAnimationFrame(settleFrame.current);
    };
  }, [href, host, visible]);
  useEffect(
    () =>
      visible
        ? host?.subscribe?.((options) => {
            cancel();
            cache.current = null;
            setData({ status: "unavailable" });
            if (
              options?.reload !== false &&
              latest.current.open &&
              latest.current.visible
            )
              latest.current.prefetch();
          })
        : undefined,
    [host, visible],
  );
  useEffect(() => {
    clearTimeout(gcTimer.current);
    if (!open && cache.current)
      gcTimer.current = setTimeout(() => {
        cache.current = null;
        setData({ status: "unavailable" });
      }, 300_000);
    return () => clearTimeout(gcTimer.current);
  }, [open, revision]);
  useEffect(() => {
    if (!open || !visible) return;
    const dismiss = () => {
      cancel();
      setOpen(false);
    };
    window.addEventListener("blur", dismiss);
    return () => window.removeEventListener("blur", dismiss);
  }, [open, visible]);
  const prefetch = (delay = 200, ownerDocument = document) => {
    cancelPrefetch();
    let identity = target && host?.identity(target);
    if (!visible || !target || !host || (!identity && !host.prepare)) {
      setData({ status: "unavailable" });
      return;
    }
    if (pending.current) return;
    const stored = cache.current;
    if (stored && stored.identity === identity && Date.now() < stored.stale) {
      setData(stored.data);
      return;
    }
    if (stored?.identity !== identity) setData({ status: "unavailable" });
    const captured = generation.current;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelPrefetch();
    };
    ownerDocument.addEventListener("keydown", escape, true);
    stopPrefetchEscape.current = () =>
      ownerDocument.removeEventListener("keydown", escape, true);
    timer.current = setTimeout(async () => {
      cancelPrefetch();
      const abort = new AbortController();
      pending.current = abort;
      const guard = () => {
        if (abort.signal.aborted || captured !== generation.current)
          throw new Error("Rich preview connection changed");
      };
      const check = () => {
        guard();
        if (!identity || host.identity(target) !== identity)
          throw new Error("Rich preview connection changed");
      };
      try {
        guard();
        setData(null);
        if (host.prepare)
          identity = await host.prepare(target, abort.signal, guard);
        guard();
        if (!identity) {
          setData({ status: "unavailable" });
          return;
        }
        check();
        const value = await host.read(target, abort.signal, check);
        const result = (host.normalize ?? normalize)(value, target);
        check();
        cache.current = {
          identity,
          data: result,
          stale: Date.now() + (staleTime?.(result) ?? 60_000),
        };
        setData(result);
      } catch {
        if (!abort.signal.aborted && captured === generation.current) {
          if (identity && host.identity(target) === identity)
            cache.current = {
              identity,
              data: { status: "unavailable" },
              stale:
                Date.now() + (staleTime?.({ status: "unavailable" }) ?? 60_000),
            };
          setData({ status: "unavailable" });
        }
      } finally {
        // A consumed snapshot no longer owns browser fetch/stream abort followers.
        abort.abort();
        if (pending.current === abort) pending.current = null;
      }
    }, delay);
  };
  const currentIdentity = target && host?.identity(target);
  latest.current = { open, visible, prefetch: () => prefetch(0) };
  return (
    <TooltipProvider>
      <Tooltip
        open={open && visible}
        delayDuration={700}
        onOpenChange={(next) => {
          clearTimeout(closeTimer.current);
          if (!next && popup.current?.contains(document.activeElement)) return;
          if (next) setOpen(visible);
          else closeTimer.current = setTimeout(() => setOpen(false), 100);
        }}
      >
        <TooltipTrigger
          asChild
          onPointerEnter={(e) => {
            if (e.pointerType === "touch" || e.buttons !== 0) return;
            triggerElement.current = e.currentTarget;
            const r = e.currentTarget.getBoundingClientRect(),
              below = document.documentElement.clientHeight - r.bottom;
            setSide(below < 384 && r.top > below ? "top" : "bottom");
            prefetch(200, e.currentTarget.ownerDocument);
          }}
          onPointerLeave={cancelPrefetch}
          onPointerDown={cancelPrefetch}
          onClick={() => {
            cancelPrefetch();
            setOpen(false);
          }}
          onDragStart={cancelPrefetch}
          onFocus={(e) => {
            triggerElement.current = e.currentTarget;
            if (suppressFocus.current) return;
            clearTimeout(closeTimer.current);
            prefetch(0, e.currentTarget.ownerDocument);
            setOpen(true);
          }}
          onBlur={(e) => {
            if (
              e.relatedTarget instanceof Node &&
              popup.current?.contains(e.relatedTarget)
            )
              e.preventDefault();
          }}
          onKeyDown={(e) => {
            if (e.key === "Tab" && !e.shiftKey && open && popup.current) {
              e.preventDefault();
              popup.current.querySelector<HTMLElement>("a[href]")?.focus();
            }
          }}
        >
          {children}
        </TooltipTrigger>
        <TooltipContent
          data-tooltip-keyboard-navigation=""
          ref={attachPopup}
          interactive
          hideArrow
          className={`codex-presentation codex-native-slack-preview ${className}`}
          align="start"
          side={placedSide}
          sideOffset={4}
          collisionPadding={8}
          onPointerEnter={() => {
            clearTimeout(closeTimer.current);
            setOpen(true);
          }}
          onPointerLeave={() => {
            closeTimer.current = setTimeout(() => setOpen(false), 100);
          }}
          onBlur={(e) => {
            if (
              !(e.relatedTarget instanceof Node) ||
              !popup.current?.contains(e.relatedTarget)
            )
              setOpen(false);
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            cancelPrefetch();
            clearTimeout(closeTimer.current);
            // Native keyboardNavigation returns focus without reopening or issuing a read.
            const trigger = triggerElement.current;
            if (
              popup.current?.contains(document.activeElement) &&
              trigger?.isConnected
            ) {
              suppressFocus.current = true;
              trigger.focus({ preventScroll: true });
              suppressFocus.current = false;
            }
            setOpen(false);
          }}
        >
          <div className="codex-native-slack-toolbar">
            {icon}
            <span className="codex-native-slack-domain">{hostname}</span>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={
                zh ? "打开网站" : ja ? "ウェブサイトを開く" : "Open website"
              }
            >
              {zh ? "打开" : ja ? "ウェブサイトを開く" : "Open"}
              <NativeExternalOpenIcon />
            </a>
          </div>
          {data === null && (
            <span className="sr-only" role="status">
              {zh
                ? "正在加载预览…"
                : ja
                  ? "プレビューを読み込み中…"
                  : "Loading preview…"}
            </span>
          )}
          <NativeRichPreviewBody
            data={data}
            currentIdentity={currentIdentity || null}
            cacheIdentity={cache.current?.identity}
            fallback={fallback}
            format={format}
            reducedMotion={reducedMotion}
          />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
