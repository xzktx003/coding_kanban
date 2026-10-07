import { Fragment, lazy, Suspense, useMemo, type ReactNode } from "react";
import { splitVisualizationContent } from "./visualize-markers";

const VisualizationPreview = lazy(() => import("./VisualizationPreview"));
export function VisualizationContent({
  text,
  projectRoot,
  renderMarkdown,
}: {
  text: string;
  projectRoot?: string;
  renderMarkdown: (text: string) => ReactNode;
}) {
  const parts = useMemo(() => splitVisualizationContent(text), [text]);
  return (
    <>
      {parts.map((part, index) =>
        part.kind === "markdown" ? (
          <Fragment key={index}>{renderMarkdown(part.text)}</Fragment>
        ) : part.kind === "pending" ? (
          <div
            role="status"
            className="text-sm text-muted-foreground"
            key={index}
          >
            正在接收可视化预览…
          </div>
        ) : (
          <Suspense
            key={`${index}:${part.reference.path}`}
            fallback={<div role="status">正在加载可视化预览…</div>}
          >
            <VisualizationPreview
              reference={part.reference}
              projectRoot={projectRoot}
            />
          </Suspense>
        ),
      )}
    </>
  );
}
