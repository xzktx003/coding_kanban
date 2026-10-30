import {
  Component,
  lazy,
  Suspense,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { CodexMarkdown } from "./CodexMarkdown";

const Markdown = lazy(() =>
  import("./CodexMarkdown").then((module) => ({
    default: module.CodexMarkdown,
  })),
);

class MarkdownBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** A queue preview must never suspend its parent composer on the rich parser. */
export function DeferredCodexMarkdown(
  props: ComponentProps<typeof CodexMarkdown>,
) {
  const fallback = (
    <span className="whitespace-pre-wrap break-words">{props.value}</span>
  );
  return (
    <MarkdownBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <Markdown {...props} />
      </Suspense>
    </MarkdownBoundary>
  );
}
