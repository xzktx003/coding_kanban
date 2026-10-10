import { createContext, useContext, useMemo } from "react";
import {
  Streamdown,
  defaultRemarkPlugins,
  defaultUrlTransform,
  type Components,
} from "streamdown";
import { codexCode as code } from "./codexCode";
import { createMathPlugin } from "@streamdown/math";
import { nativeMermaid as mermaid } from "./nativeMermaidLayout";
import { VisualizationContent } from "@session/features/visualizations/VisualizationContent";
import { useEditorStore } from "@session/stores/useEditorStore";
import { useLayoutStore } from "@session/stores";
import { parseFileReference, resolveLiteralFilePath } from "./fileReference";
import {
  decodeNativeFileCitation,
  remarkNativeFileCitations,
} from "@session/features/native-citations/nativeFileCitations";
import { NativeFileCitationPill } from "@session/features/native-citations/NativeFileCitationPill";
import { toast } from "sonner";
import { useCodexContentOwner } from "./ownerContext";
import { nativeMathMarkdown } from "./nativeMath";
import { NativeCodeFence } from "./NativeCodeFence";
import { useThemeContext } from "@session/contexts/ThemeContext";
import { nativeMermaidConfig } from "./nativeMermaidTheme";
import {
  NativeMarkdownSource,
  NativeMarkdownTable,
} from "./NativeMarkdownTable";
import "./native-markdown.css";
const math = createMathPlugin({ singleDollarTextMath: true });
const referencePrefix = "#codex-file=";
const MarkdownStreaming = createContext(false);
const nativeCitationTags = {
  span: ["className", "data-native-file-citation", "dataNativeFileCitation"],
};
function NativeMermaidFence({ source }: { source: string }) {
  const streaming = useContext(MarkdownStreaming);
  const { resolvedTheme } = useThemeContext();
  const config = useMemo(
    () => nativeMermaidConfig(resolvedTheme, source),
    [resolvedTheme, source],
  );
  return (
    <Streamdown
      plugins={{ code, math, mermaid }}
      mermaid={{ config }}
      controls={{
        mermaid: {
          copy: true,
          download: true,
          fullscreen: false,
          panZoom: true,
        },
      }}
      mode={streaming ? "streaming" : "static"}
      isAnimating={streaming}
    >{`\`\`\`mermaid\n${source}\n\`\`\``}</Streamdown>
  );
}
function containsImage(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const tree = node as { tagName?: string; children?: unknown[] };
  return tree.tagName === "img" || !!tree.children?.some(containsImage);
}

export function CodexMarkdown({
  value,
  threadId,
  streaming = false,
  className = "",
  inline = false,
}: {
  value: string;
  threadId?: string;
  streaming?: boolean;
  className?: string;
  inline?: boolean;
}) {
  const owner = useCodexContentOwner(threadId);
  const { cwd } = owner;
  // Streamdown remounts parsed blocks when streaming switches to static mode.
  // Keep reader choices with this message/thread, outside those parsed blocks.
  const wrapChoices = useMemo(() => new Map<string, boolean>(), [threadId]);
  const fileReferences = useMemo(
    () =>
      () =>
      (tree: { type: string; url?: string; children?: unknown[] }) => {
        const visit = (node: typeof tree) => {
          if (
            node.type === "link" &&
            node.url &&
            parseFileReference(node.url, cwd)
          )
            node.url = referencePrefix + encodeURIComponent(node.url);
          for (const child of node.children ?? []) visit(child as typeof tree);
        };
        visit(tree);
      },
    [cwd],
  );
  const components = useMemo<Components>(
    () => ({
      span: ({ children, node, ...props }) => {
        const citation = decodeNativeFileCitation(
          (props as Record<string, unknown>)["data-native-file-citation"],
        );
        if (!citation) return <span {...props}>{children}</span>;
        return (
          <NativeFileCitationPill
            citation={citation}
            owner={owner}
            onOpen={(reference, captured) => {
              const root = captured.cwd
                ? resolveLiteralFilePath(captured.cwd)
                : null;
              const path = reference.path.replace(/\\/g, "/");
              const boundary = root?.replace(/\\/g, "/").replace(/\/+$/, "");
              if (
                !root ||
                (path !== boundary &&
                  !path.startsWith(boundary === "" ? "/" : boundary + "/"))
              ) {
                toast.error("引用文件不属于原会话项目，未打开其他项目文件");
                return;
              }
              useEditorStore
                .getState()
                .revealFile(
                  reference.path,
                  root,
                  reference.line,
                  1,
                  reference.endLine,
                );
              const layout = useLayoutStore.getState();
              layout.setActiveRightPanelTab("files");
              layout.setRightPanelOpen(true);
            }}
          />
        );
      },
      code: ({ children, className, node, ...props }) => {
        const block = "data-block" in props;
        if (!block)
          return (
            <code
              {...props}
              data-streamdown="inline-code"
              className={className}
            >
              {children}
            </code>
          );
        const language =
          /language-([^\s]+)/.exec(className ?? "")?.[1] ?? "text";
        const source = String(children).replace(/\n$/, "");
        // Mermaid retains Streamdown's existing pan/zoom, copy and download
        // renderer. Only ordinary code fences use the measured native surface.
        if (language === "mermaid")
          return <NativeMermaidFence source={source} />;
        const key = `${node?.position?.start.offset ?? 0}:${language}`;
        return (
          <NativeCodeFence
            code={source}
            language={language}
            initialWrap={wrapChoices.get(key)}
            onWrapChange={(wrap) => wrapChoices.set(key, wrap)}
          />
        );
      },
      table: ({ children, node, ...props }) => (
        <NativeMarkdownTable
          {...props}
          sourceStart={node?.position?.start.offset}
          sourceEnd={node?.position?.end.offset}
        >
          {children}
        </NativeMarkdownTable>
      ),
      thead: ({ children, node: _node, ...props }) => (
        <thead {...props}>{children}</thead>
      ),
      tbody: ({ children, node: _node, ...props }) => (
        <tbody {...props}>{children}</tbody>
      ),
      tr: ({ children, node: _node, ...props }) => (
        <tr {...props}>{children}</tr>
      ),
      th: ({ children, node: _node, ...props }) => (
        <th {...props}>{children}</th>
      ),
      td: ({ children, node: _node, ...props }) => (
        <td {...props}>{children}</td>
      ),
      a: ({ href, children, node: _node, ...props }) => {
        let reference = href;
        if (reference?.startsWith(referencePrefix)) {
          try {
            reference = decodeURIComponent(
              reference.slice(referencePrefix.length),
            );
          } catch {
            reference = undefined;
          }
        }
        const file = reference ? parseFileReference(reference, cwd) : null;
        return (
          <a
            {...props}
            href={href}
            title={file?.path ?? href}
            onClick={(event) => {
              if (!file) return;
              event.preventDefault();
              event.stopPropagation();
              useEditorStore
                .getState()
                .revealFile(
                  file.path,
                  cwd ?? undefined,
                  file.line,
                  file.column,
                );
              const layout = useLayoutStore.getState();
              layout.setActiveRightPanelTab("files");
              layout.setRightPanelOpen(true);
            }}
          >
            {children}
          </a>
        );
      },
      p: ({ children, node, ...props }) => {
        // Streamdown images include block controls. Keep ordinary text semantic
        // paragraphs while giving an image gallery a valid flow container.
        const Container = containsImage(node) ? "div" : "p";
        return (
          <Container
            {...props}
            className="codex-paragraph"
            data-markdown-han-text={
              /[\u3400-\u9fff]/.test(String(children)) ? "" : undefined
            }
          >
            {children}
          </Container>
        );
      },
    }),
    [cwd, owner.threadId, wrapChoices],
  );
  return (
    <div className={`codex-markdown ${inline ? "is-inline" : ""} ${className}`}>
      <VisualizationContent
        text={value}
        projectRoot={cwd ?? undefined}
        renderMarkdown={(text) => (
          <MarkdownStreaming.Provider value={streaming}>
            <NativeMarkdownSource.Provider value={nativeMathMarkdown(text)}>
              <Streamdown
                components={components}
                allowedTags={nativeCitationTags}
                plugins={{ code, math, mermaid }}
                remarkPlugins={[
                  ...Object.values(defaultRemarkPlugins),
                  remarkNativeFileCitations(nativeMathMarkdown(text)),
                  fileReferences,
                ]}
                controls={{
                  code: true,
                  table: true,
                  mermaid: {
                    copy: true,
                    download: true,
                    fullscreen: false,
                    panZoom: true,
                  },
                }}
                shikiTheme={code.getThemes()}
                mode={streaming ? "streaming" : "static"}
                isAnimating={streaming}
                className="codex-markdown-blocks"
                urlTransform={(url, key, node) =>
                  parseFileReference(url, cwd)
                    ? url
                    : defaultUrlTransform(url, key, node)
                }
              >
                {nativeMathMarkdown(text)}
              </Streamdown>
            </NativeMarkdownSource.Provider>
          </MarkdownStreaming.Provider>
        )}
      />
    </div>
  );
}
