import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { nativeMathMarkdown } from "../presentation/nativeMath";

/**
 * Small, dependency-isolated renderer used only while the rich transcript
 * module is unavailable.  It intentionally has no Codex item, tool, or
 * citation imports, so a failure in that module cannot take this recovery
 * view down with it.
 */
const components: Components = {
  p: ({ children, ...props }) => (
    <p {...props} className="my-2 first:mt-0 last:mb-0">
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    <ul {...props} className="my-2 list-disc space-y-1 pl-5">
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol {...props} className="my-2 list-decimal space-y-1 pl-5">
      {children}
    </ol>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      {...props}
      className="my-2 border-l-2 border-current/30 pl-3 opacity-90"
    >
      {children}
    </blockquote>
  ),
  h1: ({ children, ...props }) => (
    <h1 {...props} className="my-3 text-lg font-semibold">
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 {...props} className="my-3 text-base font-semibold">
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 {...props} className="my-2 font-semibold">
      {children}
    </h3>
  ),
  a: ({ href, children, ...props }) => (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline underline-offset-2 break-all"
    >
      {children}
    </a>
  ),
  pre: ({ children, ...props }) => (
    <pre
      {...props}
      className="my-2 max-w-full overflow-x-auto rounded-md bg-black/10 p-3 text-xs dark:bg-white/10"
    >
      {children}
    </pre>
  ),
  code: ({ className, children, ...props }) => (
    <code
      {...props}
      className={`${className ?? ""} rounded bg-black/10 px-1 py-0.5 text-[0.9em] dark:bg-white/10`}
    >
      {children}
    </code>
  ),
};

export function TranscriptFallbackMarkdown({ value }: { value: string }) {
  return (
    <div className="codex-transcript-fallback-markdown max-w-full min-w-0 break-words [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {nativeMathMarkdown(value)}
      </ReactMarkdown>
    </div>
  );
}
