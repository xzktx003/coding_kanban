import {
  Component,
  lazy,
  memo,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { useCodexStore } from "../stores/useCodexStore";
import { useTranscriptVisibility } from "../hooks/useTranscriptVisibility";
import { TranscriptDetailVisibility } from "../hooks/transcriptDetailVisibility";
import { TranscriptInspectionContext } from "./inspection";
import { CodexContentOwner } from "../presentation/ownerContext";
import { recordWorkbenchCrash } from "@session/services/workbenchCrashDiagnostic";
import { CodexTranscriptPreparing } from "./CodexTranscriptPreparing";

// The rich transcript has a deliberately large module graph. A slow or
// partially failed browser module request must still leave the cached
// conversation readable instead of keeping the user on an infinite Suspense
// spinner.
const TRANSCRIPT_RENDER_TIMEOUT_MS = 12_000;

function TranscriptLoadingFallback({
  threadId,
  onRetry,
  onRefresh,
}: {
  threadId: string;
  onRetry: () => void;
  onRefresh: () => void;
}) {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(
      () => setTimedOut(true),
      TRANSCRIPT_RENDER_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, []);
  return (
    <CodexTranscriptPreparing
      threadId={threadId}
      failed={timedOut}
      failure={
        timedOut
          ? "完整消息渲染模块在 12 秒内没有完成加载。已保留当前会话内容，可以重试或刷新页面。"
          : undefined
      }
      retryLabel="重试完整消息"
      onRetry={timedOut ? onRetry : undefined}
      onRefresh={timedOut ? onRefresh : undefined}
    />
  );
}

// Rich tools, Markdown and on-demand details belong to this local boundary.
// Their module graph must not suspend navigation or the sibling composer.
const transcriptModuleLoadFailures = new WeakSet<object>();

function createCodexTranscriptRenderer() {
  return lazy(() =>
    import("./CodexTranscript").catch((error: unknown) => {
      if (
        error !== null &&
        (typeof error === "object" || typeof error === "function")
      )
        transcriptModuleLoadFailures.add(error as object);
      throw error;
    }),
  );
}

function refreshPage() {
  window.location.reload();
}

class TranscriptRendererBoundary extends Component<
  {
    threadId: string;
    onRetry: (reloadPage: boolean) => void;
    onRefresh: () => void;
    children: ReactNode;
  },
  { failed: boolean; failure: string | null; moduleLoadFailed: boolean }
> {
  state = {
    failed: false,
    failure: null as string | null,
    moduleLoadFailed: false,
  };
  static getDerivedStateFromError(error: unknown) {
    const failure =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : typeof error === "string"
          ? error
          : "未知渲染错误";
    return {
      failed: true,
      failure: failure.slice(0, 500),
      moduleLoadFailed:
        error !== null &&
        (typeof error === "object" || typeof error === "function") &&
        transcriptModuleLoadFailures.has(error as object),
    };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    recordWorkbenchCrash("会话正文", error, info);
    console.error("[CodexThread] Transcript renderer failed.", {
      threadId: this.props.threadId,
      error,
      componentStack: info.componentStack,
    });
  }
  render() {
    return this.state.failed ? (
      <CodexTranscriptPreparing
        threadId={this.props.threadId}
        failed
        failure={this.state.failure}
        retryLabel={
          this.state.moduleLoadFailed
            ? "刷新并重试完整消息"
            : "重试完整消息"
        }
        onRetry={() => this.props.onRetry(this.state.moduleLoadFailed)}
        onRefresh={
          this.state.moduleLoadFailed ? undefined : this.props.onRefresh
        }
      />
    ) : (
      this.props.children
    );
  }
}

interface CodexThreadProps {
  threadId?: string;
  inspection?: boolean;
  /** Fixed-height cards resolve their height through flex rather than h-full. */
  fillHeight?: boolean;
}

export const CodexThread = memo(function CodexThread({
  threadId,
  fillHeight = true,
  inspection = false,
}: CodexThreadProps = {}) {
  const activeThreadId = useCodexStore((s) => threadId ?? s.currentThreadId);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const TranscriptRenderer = useMemo(createCodexTranscriptRenderer, [
    activeThreadId,
    loadAttempt,
  ]);
  const retryTranscript = (reloadPage = false) => {
    if (reloadPage) {
      refreshPage();
      return;
    }
    setLoadAttempt((attempt) => attempt + 1);
  };
  const { ref, renderTranscript, visible } = useTranscriptVisibility(
    activeThreadId ?? "",
  );
  return (
    <TranscriptInspectionContext.Provider value={inspection}>
      <div
        ref={ref}
        data-codex-transcript-shell={activeThreadId ?? ""}
        className={`flex flex-col flex-1 min-h-0 ${fillHeight ? "h-full" : ""}`}
      >
        <TranscriptDetailVisibility.Provider value={visible}>
          <CodexContentOwner.Provider value={activeThreadId ?? null}>
            {renderTranscript ? (
              <TranscriptRendererBoundary
                key={`${activeThreadId ?? ""}:${loadAttempt}`}
                threadId={activeThreadId ?? ""}
                onRetry={retryTranscript}
                onRefresh={refreshPage}
              >
                <Suspense
                  fallback={
                    <TranscriptLoadingFallback
                      threadId={activeThreadId ?? ""}
                      onRetry={() => retryTranscript(false)}
                      onRefresh={refreshPage}
                    />
                  }
                >
                  <TranscriptRenderer
                    activeThreadId={activeThreadId ?? ""}
                    fillHeight={fillHeight}
                    inspection={inspection}
                  />
                </Suspense>
              </TranscriptRendererBoundary>
            ) : (
              <div className="flex-1 min-h-0" data-transcript-sleeping />
            )}
          </CodexContentOwner.Provider>
        </TranscriptDetailVisibility.Provider>
      </div>
    </TranscriptInspectionContext.Provider>
  );
});
