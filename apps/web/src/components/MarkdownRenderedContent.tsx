import { memo, useMemo, type Ref, type UIEventHandler } from "react";
import rehypeKatex from "rehype-katex";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { normalizeLatexMathDelimiters } from "./markdown-latex";
import { createMarkdownHeadingId } from "../lib/markdown-navigation";

if (typeof document !== "undefined") {
  void import("katex/dist/katex.min.css");
}

interface MarkdownRenderedContentProps {
  className?: string;
  content: string;
  contentRef?: Ref<HTMLElement>;
  onScroll?: UIEventHandler<HTMLElement>;
  testId?: string;
}

export const MarkdownRenderedContent = memo(function MarkdownRenderedContent({
  className,
  content,
  contentRef,
  onScroll,
  testId = "markdown-rendered",
}: MarkdownRenderedContentProps) {
  const normalizedContent = useMemo(
    () => normalizeLatexMathDelimiters(content),
    [content],
  );

  return (
    <article
      className={`markdown-rendered-content${className ? ` ${className}` : ""}`}
      data-testid={testId}
      onScroll={onScroll}
      ref={contentRef}
    >
      <ReactMarkdown
        components={{
          a: ({ children, node: _node, ...props }) => (
            <a {...props} rel="noopener noreferrer" target="_blank">
              {children}
            </a>
          ),
          h1: ({ node, ...props }) => (
            <h1
              {...props}
              id={createMarkdownHeadingId(node?.position?.start.line)}
            />
          ),
          h2: ({ node, ...props }) => (
            <h2
              {...props}
              id={createMarkdownHeadingId(node?.position?.start.line)}
            />
          ),
          h3: ({ node, ...props }) => (
            <h3
              {...props}
              id={createMarkdownHeadingId(node?.position?.start.line)}
            />
          ),
          h4: ({ node, ...props }) => (
            <h4
              {...props}
              id={createMarkdownHeadingId(node?.position?.start.line)}
            />
          ),
          h5: ({ node, ...props }) => (
            <h5
              {...props}
              id={createMarkdownHeadingId(node?.position?.start.line)}
            />
          ),
          h6: ({ node, ...props }) => (
            <h6
              {...props}
              id={createMarkdownHeadingId(node?.position?.start.line)}
            />
          ),
        }}
        rehypePlugins={[
          [rehypeKatex, { strict: "ignore", throwOnError: false }],
        ]}
        remarkPlugins={[remarkGfm, remarkMath]}
      >
        {normalizedContent}
      </ReactMarkdown>
    </article>
  );
});
