import { Component, lazy, memo, Suspense, type ReactNode } from "react";
import { useCodexStore } from "../stores/useCodexStore";
import { useTranscriptVisibility } from "../hooks/useTranscriptVisibility";
import { TranscriptDetailVisibility } from "../hooks/transcriptDetailVisibility";
import { TranscriptInspectionContext } from "./inspection";
import { CodexContentOwner } from "../presentation/ownerContext";
import { CodexTranscriptPreparing } from "./CodexTranscriptPreparing";

// Rich tools, Markdown and on-demand details belong to this local boundary.
// Their module graph must not suspend navigation or the sibling composer.
const CodexTranscript = lazy(() => import("./CodexTranscript"));

class TranscriptRendererBoundary extends Component<
  {
    threadId: string;
    children: ReactNode;
  },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <CodexTranscriptPreparing threadId={this.props.threadId} failed />
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
                key={activeThreadId ?? ""}
                threadId={activeThreadId ?? ""}
              >
                <Suspense
                  fallback={
                    <CodexTranscriptPreparing threadId={activeThreadId ?? ""} />
                  }
                >
                  <CodexTranscript
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
