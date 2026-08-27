import { memo, useMemo, type Ref, type UIEventHandler } from "react";
import rehypeKatex from "rehype-katex";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { normalizeLatexMathDelimiters } from "./markdown-latex";
import { createMarkdownHeadingId } from "../lib/markdown-navigation";
import { MarkdownImage, type MarkdownResourceContext } from "./MarkdownImage";

if (typeof document !== "undefined") {
  void import("katex/dist/katex.min.css");
}

export interface MarkdownRenderedContentProps {
  className?: string;
  content: string;
  contentRef?: Ref<HTMLElement>;
  onScroll?: UIEventHandler<HTMLElement>;
  resourceContext?: MarkdownResourceContext;
  testId?: string;
}

function areMarkdownResourceContextsEqual(
  previous: MarkdownResourceContext | undefined,
  next: MarkdownResourceContext | undefined,
): boolean {
  return (
    previous?.documentPath === next?.documentPath &&
    previous?.rootPath === next?.rootPath &&
    previous?.sshTarget?.host === next?.sshTarget?.host &&
    previous?.sshTarget?.identityFile === next?.sshTarget?.identityFile &&
    previous?.sshTarget?.port === next?.sshTarget?.port &&
    previous?.sshTarget?.username === next?.sshTarget?.username
  );
}

export function areMarkdownRenderedContentPropsEqual(
  previous: MarkdownRenderedContentProps,
  next: MarkdownRenderedContentProps,
): boolean {
  return (
    previous.className === next.className &&
    previous.content === next.content &&
    previous.contentRef === next.contentRef &&
    previous.onScroll === next.onScroll &&
    areMarkdownResourceContextsEqual(
      previous.resourceContext,
      next.resourceContext,
    ) &&
    previous.testId === next.testId
  );
}

export const MarkdownRenderedContent = memo(function MarkdownRenderedContent({
  className,
  content,
  contentRef,
  onScroll,
  resourceContext,
  testId = "markdown-rendered",
}: MarkdownRenderedContentProps) {
  const normalizedContent = useMemo(
    () => normalizeLatexMathDelimiters(content),
    [content],
  );
  const components = useMemo<Components>(
    () => ({
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
      img: ({ alt, node: _node, src, title }) => (
        <MarkdownImage
          alt={alt}
          resourceContext={resourceContext}
          source={src}
          title={title}
        />
      ),
    }),
    [
      resourceContext?.documentPath,
      resourceContext?.rootPath,
      resourceContext?.sshTarget?.host,
      resourceContext?.sshTarget?.identityFile,
      resourceContext?.sshTarget?.port,
      resourceContext?.sshTarget?.username,
    ],
  );

  return (
    <article
      className={`markdown-rendered-content${className ? ` ${className}` : ""}`}
      data-testid={testId}
      onScroll={onScroll}
      ref={contentRef}
    >
      <ReactMarkdown
        components={components}
        rehypePlugins={[
          [rehypeKatex, { strict: "ignore", throwOnError: false }],
        ]}
        remarkPlugins={[remarkGfm, remarkMath]}
      >
        {normalizedContent}
      </ReactMarkdown>
    </article>
  );
}, areMarkdownRenderedContentPropsEqual);
