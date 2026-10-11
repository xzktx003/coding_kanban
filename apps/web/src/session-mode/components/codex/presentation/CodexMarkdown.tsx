import { NativeWebsitePreview } from "./NativeWebsitePreview";
import { NativeGithubPreview } from "./NativeGithubPreview";
import { nativeGithubPullRequest } from "@agent-orchestrator/shared";
import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import {
  Streamdown,
  defaultRemarkPlugins,
  defaultRehypePlugins,
  defaultUrlTransform,
  type Components,
} from "streamdown";
import { codexCode as code } from "./codexCode";
import { createMathPlugin } from "@streamdown/math";
import { nativeMermaid as mermaid } from "./nativeMermaidLayout";
import { VisualizationContent } from "@session/features/visualizations/VisualizationContent";
import { useEditorStore } from "@session/stores/useEditorStore";
import { openVsCodePanel } from "@session/stores/useVsCodePanelStore";
import { editorHostFor } from "@session/features/codex-host/bridge";
import { sessionDraftKey } from "@session/stores/useSessionDraftStore";
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
import { NativeExternalLinkLabel } from "./NativeExternalLinkLabel";
import { NativeMarkdownTooltip } from "./NativeMarkdownTooltip";
import { nativeHotlineLink } from "./nativeHotlineLink";
import { nativeSlackUrl } from "./nativeSlackPreview";
import { NativeSlackPreview } from "./NativeSlackPreview";
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
  a: [
    "href",
    "title",
    "target",
    "rel",
    "data-native-link-href",
    "dataNativeLinkHref",
  ],
};
// Preserve Streamdown's sanitizer/hardening and the existing citation tags;
// only add the SMS protocol that the native Cni/wni link renderer supports.
const sanitize = defaultRehypePlugins.sanitize;
function nativeSanitizer(plugin: typeof sanitize): typeof sanitize {
  if (!Array.isArray(plugin)) return plugin;
  const schema = plugin[1];
  return [
    plugin[0],
    {
      ...schema,
      tagNames: [
        ...(schema.tagNames ?? []),
        ...Object.keys(nativeCitationTags),
      ],
      attributes: { ...schema.attributes, ...nativeCitationTags },
      protocols: {
        ...schema.protocols,
        href: [...(schema.protocols?.href ?? []), "sms"],
      },
    },
  ];
}
const nativeRehypePlugins = Object.values({
  ...defaultRehypePlugins,
  sanitize: nativeSanitizer(sanitize),
});
// Rehype hardening still decides whether a link is safe. Keep only an original
// spelling that resolves to exactly the same approved URL (e.g. no added '/').
function originalApprovedHref(raw: unknown, approved: string | undefined) {
  if (typeof raw !== "string" || !approved) return approved;
  try {
    const safe = new URL(approved, window.location.href);
    if (!["http:", "https:", "mailto:", "tel:", "sms:"].includes(safe.protocol))
      return approved;
    return new URL(raw, window.location.href).href === safe.href
      ? raw
      : approved;
  } catch {
    return approved;
  }
}
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

// Native Markdown HU/ZBn tests rendered descendant text, including links and
// emphasis, against Script=Han rather than only the basic CJK Unicode block.
function hasHanText(children: ReactNode): boolean {
  return Children.toArray(children).some((child) => {
    if (typeof child === "string" || typeof child === "number")
      return /\p{Script=Han}/u.test(String(child));
    return isValidElement<{ children?: ReactNode }>(child)
      ? hasHanText(child.props.children)
      : false;
  });
}

export function CodexMarkdown({
  value,
  threadId,
  streaming = false,
  className = "",
  inline = false,
  imagesAsLinks = false,
}: {
  value: string;
  threadId?: string;
  streaming?: boolean;
  className?: string;
  inline?: boolean;
  /** Native user text presents image syntax as links; attachments stay separate. */
  imagesAsLinks?: boolean;
}) {
  const owner = useCodexContentOwner(threadId);
  const { cwd } = owner;
  const fileReferences = useMemo(
    () =>
      () =>
      (tree: {
        type: string;
        url?: string;
        alt?: string;
        title?: string | null;
        children?: unknown[];
        data?: { hProperties?: Record<string, unknown> };
      }) => {
        const visit = (node: typeof tree) => {
          if (imagesAsLinks && node.children)
            node.children = node.children.flatMap((child) => {
              const image = child as typeof tree;
              return image.type === "image" && image.url
                ? [
                    // Native Markdown keeps the image marker as its own text
                    // token, including in the cleaned rich clipboard payload.
                    {
                      type: "text",
                      value: "!",
                      data: {
                        hName: "span",
                        hProperties: { className: "codex-native-image-marker" },
                      },
                    },
                    {
                      type: "link",
                      url: image.url,
                      title: image.title,
                      children: [{ type: "text", value: image.alt ?? "" }],
                    },
                  ]
                : [child];
            });
          if (node.type === "link" && node.url) {
            node.data ??= {};
            node.data.hProperties ??= {};
            node.data.hProperties["data-native-link-href"] = node.url;
          }
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
    [cwd, imagesAsLinks],
  );
  const components = useMemo<Components>(
    () => ({
      strong: ({ children, node: _node, ...props }) => (
        <strong {...props} data-streamdown="strong">
          {children}
        </strong>
      ),
      span: ({ children, node, ...props }) => {
        if (props.className === "codex-native-image-marker")
          return (
            <span {...props} data-markdown-copy="contents">
              {children}
            </span>
          );
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
              const host = editorHostFor({
                cwd: root,
                threadId: captured.threadId ?? null,
                draftOwner: sessionDraftKey(
                  "codex",
                  captured.threadId ?? null,
                  root,
                ),
              });
              if (host) {
                openVsCodePanel();
                void host.command({
                  type: "openLocation",
                  path: reference.path,
                  line: reference.line,
                  column: 1,
                });
              }
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
              dir="ltr"
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
        return <NativeCodeFence code={source} language={language} />;
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
        const originalHref = (props as Record<string, unknown>)[
          "data-native-link-href"
        ];
        const approvedHref = originalApprovedHref(originalHref, href);
        const displayHref = approvedHref
          ? (nativeHotlineLink(approvedHref) ?? approvedHref)
          : approvedHref;
        let reference = displayHref;
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
        const anchor = (
          <a
            {...props}
            href={file ? href : displayHref}
            className={file ? props.className : "codex-native-external-link"}
            title={file?.path ?? props.title}
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
            {file ? (
              children
            ) : (
              <NativeExternalLinkLabel key={displayHref} href={displayHref}>
                {children}
              </NativeExternalLinkLabel>
            )}
          </a>
        );
        return !file && displayHref && nativeSlackUrl(displayHref) ? (
          <NativeSlackPreview href={displayHref}>{anchor}</NativeSlackPreview>
        ) : !file && displayHref && nativeGithubPullRequest(displayHref) ? (
          <NativeGithubPreview href={displayHref}>{anchor}</NativeGithubPreview>
        ) : file || !displayHref ? (
          anchor
        ) : (
          <NativeWebsitePreview href={displayHref}>
            {anchor}
          </NativeWebsitePreview>
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
            data-markdown-han-text={hasHanText(children) ? "true" : undefined}
          >
            {children}
          </Container>
        );
      },
    }),
    [cwd, owner.threadId],
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
                rehypePlugins={nativeRehypePlugins}
                urlTransform={(url, key, node) =>
                  parseFileReference(url, cwd) || /^sms:/i.test(url)
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
