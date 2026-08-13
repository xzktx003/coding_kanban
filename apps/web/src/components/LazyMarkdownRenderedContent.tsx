import { lazy, memo, Suspense, useEffect, useRef, useState } from "react";

const LazyMarkdownRenderedContent = lazy(() =>
  import("./MarkdownRenderedContent").then((module) => ({
    default: module.MarkdownRenderedContent,
  })),
);

interface LazyMarkdownContentProps {
  className?: string;
  content: string;
  deferUntilVisible?: boolean;
  fallbackClassName: string;
  fallbackTestId?: string;
  fallbackText: string;
  testId?: string;
}

export const LazyMarkdownContent = memo(function LazyMarkdownContent({
  className,
  content,
  deferUntilVisible = false,
  fallbackClassName,
  fallbackTestId,
  fallbackText,
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
        testId={testId}
      />
    </Suspense>
  );
});
