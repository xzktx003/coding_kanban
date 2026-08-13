import { memo, useMemo } from "react";
import rehypeKatex from "rehype-katex";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { normalizeLatexMathDelimiters } from "./markdown-latex";

if (typeof document !== "undefined") {
  void import("katex/dist/katex.min.css");
}

interface MarkdownRenderedContentProps {
  className?: string;
  content: string;
  testId?: string;
}

export const MarkdownRenderedContent = memo(function MarkdownRenderedContent({
  className,
  content,
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
    >
      <ReactMarkdown
        components={{
          a: ({ children, ...props }) => (
            <a {...props} rel="noopener noreferrer" target="_blank">
              {children}
            </a>
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
