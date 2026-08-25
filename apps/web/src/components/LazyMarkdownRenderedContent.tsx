import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useRef,
  useState,
  type Ref,
  type UIEventHandler,
} from "react";

const LazyMarkdownRenderedContent = lazy(() =>
  import("./MarkdownRenderedContent").then((module) => ({
    default: module.MarkdownRenderedContent,
  })),
);

interface LazyMarkdownContentProps {
  className?: string;
  content: string;
  contentRef?: Ref<HTMLElement>;
  deferUntilVisible?: boolean;
  fallbackClassName: string;
  fallbackTestId?: string;
  fallbackText: string;
  onScroll?: UIEventHandler<HTMLElement>;
  testId?: string;
}

export const LazyMarkdownContent = memo(function LazyMarkdownContent({
  className,
  content,
  contentRef,
  deferUntilVisible = false,
  fallbackClassName,
  fallbackTestId,
  fallbackText,
  onScroll,
  testId,
}: LazyMarkdownContentProps) {
  const canDefer =
    deferUntilVisible && typeof IntersectionObserver !== "undefined";
  const [shouldRender, setShouldRender] = useState(!canDefer);
  const placeholderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canDefer || shouldRender) {
      return;
    }

    const placeholder = placeholderRef.current;
    if (!placeholder) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }
        setShouldRender(true);
        observer.disconnect();
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(placeholder);
    return () => observer.disconnect();
  }, [canDefer, shouldRender]);

  const fallback = (
    <div
      className={fallbackClassName}
      data-testid={fallbackTestId}
      ref={placeholderRef}
    >
      {fallbackText}
    </div>
  );

  if (!shouldRender) {
    return fallback;
  }

  return (
    <Suspense fallback={fallback}>
      <LazyMarkdownRenderedContent
        className={className}
        content={content}
        contentRef={contentRef}
        onScroll={onScroll}
        testId={testId}
      />
    </Suspense>
  );
});
