import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ThreadItem,
  TurnStatus,
  WebSearchAction,
} from "@session/bindings/v2";
import type { WebSearchItem } from "@session/bindings";
import { CodexImage } from "../presentation/CodexImage";
import { nativeImageData } from "../presentation/nativeMedia";
import { readToolImage } from "../presentation/readToolImage";
import { useCodexContentOwner } from "../presentation/ownerContext";
import { parseFileReference } from "../presentation/fileReference";
import { NativeToolDisclosure } from "./NativeToolDisclosure";
import { NativeGeneratedImages } from "./NativeGeneratedImages";
import { NativeWebIcon } from "../presentation/NativeActivityIcons";
import { nativeDynamicToolLabel } from "../presentation/nativeDynamicToolSemantics";
import { nativeToolActivityMetadata } from "../presentation/nativeToolSemantics";
import { NativeCadencedShimmer } from "../presentation/NativeCadencedShimmer";
import { NativeToolIcon } from "../presentation/NativeToolIcons";
import { NativeCompactionItem } from "./NativeCompactionItem";
import { NativeDynamicToolItem } from "./NativeDynamicToolItem";
import { isTranscriptMetadataOnly } from "../presentation/transcriptMetadata";
import { TranscriptDetailsNotice } from "./TranscriptDetailsNotice";

function queryDetail(query: string) {
  const sites: string[] = [];
  const cleaned = query.replace(/\bsite:([^\s]+)/giu, (original, site) => {
    try {
      const host = new URL(`https://${site}`).hostname.replace(/^www\./u, "");
      if (!sites.includes(host)) sites.push(host);
      return "";
    } catch {
      return original;
    }
  });
  if (!sites.length) return query;
  const remaining = cleaned
    .replace(/\bOR\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return remaining ? `${remaining} | ${sites.join(" · ")}` : query;
}
export function webSearchDetail(item: WebSearchItem) {
  const action: WebSearchAction | null = item.action;
  let detail = "";
  if (action?.type === "search") {
    const query =
      action.query?.trim() ||
      action.queries?.map((query) => query.trim()).find(Boolean) ||
      "";
    detail =
      queryDetail(query) +
      (!action.query?.trim() && (action.queries?.length ?? 0) > 1 && query
        ? " ..."
        : "");
  } else if (action?.type === "openPage") detail = action.url ?? "";
  else if (action?.type === "findInPage")
    detail =
      action.pattern && action.url
        ? `'${action.pattern}' in ${action.url}`
        : action.pattern
          ? `'${action.pattern}'`
          : (action.url ?? "");
  return detail.trim() || item.query;
}

function LocalImage({ path, alt }: { path: string; alt: string }) {
  const { t } = useTranslation("thread");
  const { threadId, cwd } = useCodexContentOwner();
  const resolved = parseFileReference(path, cwd)?.path ?? null;
  const identity = JSON.stringify([threadId, resolved, path]);
  const [data, setData] = useState<{
    identity: string;
    src: string | null;
    error?: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (!resolved) return;
    void readToolImage(resolved, threadId).then(
      (result) => {
        const src = nativeImageData(result);
        if (!cancelled)
          setData({
            identity,
            src,
            ...(src ? {} : { error: "invalid-image" }),
          });
      },
      (error) => {
        if (!cancelled) setData({ identity, src: null, error: String(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [identity, resolved, threadId, attempt]);
  const current = data?.identity === identity ? data : null;
  if (!resolved)
    return <div role="alert">{t("activity.imageUnavailable")}</div>;
  if (current?.src) return <CodexImage src={current.src} alt={alt} />;
  if (current?.error)
    return (
      <div className="codex-activity-image-error" role="alert">
        {current.error === "invalid-image"
          ? t("activity.imageUnavailable")
          : current.error}
        <button
          type="button"
          onClick={() => {
            setData(null);
            setAttempt((value) => value + 1);
          }}
        >
          {t("historyRetry")}
        </button>
      </div>
    );
  return (
    <div className="codex-generated-placeholder" role="status">
      <Loader2 size={16} className="animate-spin" />
      {t("activity.loadingImage")}
    </div>
  );
}

export function NativeActivityItem({
  item,
  running = false,
  termination,
  startedAtMs,
}: {
  item: ThreadItem;
  running?: boolean;
  termination?: TurnStatus;
  startedAtMs?: number | null;
}) {
  const { t, i18n } = useTranslation("thread");
  const active = running && !termination;
  switch (item.type) {
    case "webSearch": {
      const detail = webSearchDetail(item);
      return (
        <NativeToolDisclosure
          className="codex-native-web-search"
          icon={<NativeWebIcon />}
          running={active}
          summary={
            <>
              <span>
                {t(active ? "activity.searchingWeb" : "activity.searchedWeb")}
              </span>
              {detail && (
                <>
                  {" "}
                  <span className="codex-native-tool-detail">
                    {(i18n?.language ?? "zh").startsWith("zh")
                      ? `：${detail}`
                      : `for ${detail}`}
                  </span>
                </>
              )}
            </>
          }
        />
      );
    }
    case "imageView": {
      const paths = (item as typeof item & { imagePaths?: string[] })
        .imagePaths ?? [item.path];
      const count =
        (item as typeof item & { imageCount?: number }).imageCount ??
        paths.length;
      if (isTranscriptMetadataOnly(item))
        return (
          <div className="codex-native-image-metadata">
            <NativeToolDisclosure
              icon={<NativeToolIcon name="image" />}
              running={active}
              summary={
                count === 1
                  ? t("activity.viewedImage")
                  : `Viewed ${count} images`
              }
            />
            <TranscriptDetailsNotice />
          </div>
        );
      return (
        <NativeToolDisclosure
          icon={<NativeToolIcon name="image" />}
          summary={
            count === 1
              ? t("activity.viewedImage")
              : (i18n?.language ?? "zh").startsWith("zh")
                ? `已查看 ${count} 张图像`
                : `Viewed ${count} images`
          }
        >
          <div className="codex-native-image-gallery">
            {paths.map((path, index) => (
              <LocalImage
                key={`${path}:${index}`}
                path={path}
                alt={t("activity.inspectedImage")}
              />
            ))}
          </div>
        </NativeToolDisclosure>
      );
    }
    case "imageGeneration": {
      const images = (item as typeof item & { images?: (typeof item)[] })
        .images ?? [item];
      return (
        <NativeGeneratedImages
          items={images}
          running={active}
          termination={termination}
        />
      );
    }
    case "contextCompaction": {
      const source = (item as typeof item & { source?: unknown }).source;
      return (
        <NativeCompactionItem
          running={active}
          startedAtMs={startedAtMs}
          source={source}
          termination={termination}
        />
      );
    }
    case "dynamicToolCall":
      if (nativeToolActivityMetadata(item).grouping === "hidden") return null;
      if (item.namespace === "codex_app")
        return <NativeDynamicToolItem item={item} running={active} />;
      return (
        <div className="codex-native-dynamic-tool">
          <span className="codex-native-dynamic-label">
            {active ? (
              <NativeCadencedShimmer>
                {nativeDynamicToolLabel(item, i18n?.language ?? "zh")}
              </NativeCadencedShimmer>
            ) : (
              <span>
                {nativeDynamicToolLabel(item, i18n?.language ?? "zh")}
              </span>
            )}
          </span>
        </div>
      );
    // The original plugin deliberately hides these protocol records.
    case "sleep":
    case "enteredReviewMode":
    case "exitedReviewMode":
      return null;
    default:
      return null;
  }
}
