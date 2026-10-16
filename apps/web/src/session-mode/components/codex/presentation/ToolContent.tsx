import { openWorkspaceFileReference } from "@session/services/openWorkspaceFileReference";
import { useLayoutEffect, useRef, useState } from "react";
import { CodexImage } from "./CodexImage";
import { useCodexContentOwner } from "./ownerContext";
import { parseFileReference } from "./fileReference";
import { nativeMediaUrl } from "./nativeMedia";
import { nativeToolJson } from "./nativeToolSemantics";
import { writeNativeMarkdownClipboard } from "./nativeMarkdownClipboard";
import { notifyNativeClipboardError } from "@session/features/native-notifications/nativeClipboardError";
import "../items/tool-native.css";
import { useTranslation } from "react-i18next";
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export function RawToolValue({
  value,
  label = "原始输出",
}: {
  value: unknown;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="codex-tool-raw"
    >
      <summary>{label}</summary>
      {open && <pre>{nativeToolJson(value)}</pre>}
    </details>
  );
}
function openResourceFile(
  file: NonNullable<ReturnType<typeof parseFileReference>>,
  cwd: string | null | undefined,
) {
  void openWorkspaceFileReference(file, cwd);
}

type ResourceCopyScope = { current: object | null };
function observeResourceCopy(write: Promise<void>, scope: ResourceCopyScope, owner: object, language: string) {
  void write.then(undefined, () => {
    if (scope.current === owner) notifyNativeClipboardError(language);
  });
}
function copyResourceUri(uri: string, scope: ResourceCopyScope, language: string) {
  if (scope.current)
    observeResourceCopy(writeNativeMarkdownClipboard(uri), scope, scope.current, language);
}

function ResourceOpenMenu({
  uri,
  file,
  cwd,
}: {
  uri: string;
  file: ReturnType<typeof parseFileReference>;
  cwd: string | null | undefined;
}) {
  const { threadId } = useCodexContentOwner();
  const { i18n } = useTranslation("thread");
  const copyScope = useRef<object | null>(null);
  useLayoutEffect(() => {
    copyScope.current = {};
    return () => { copyScope.current = null; };
  }, [threadId, uri, cwd]);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const external = /^https?:\/\//i.test(uri);
  const close = () => setOpen(false);
  return (
    <span className="codex-resource-open">
      <button
        type="button"
        className="codex-resource-open-button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setPlace({ top: box.bottom + 4, left: box.left });
          setOpen((value) => !value);
        }}
      >
        打开方式
      </button>
      {open && place && (
        <div
          role="menu"
          aria-label="选择打开位置"
          style={{ top: place.top, left: place.left }}
        >
          {file && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                openResourceFile(file, cwd);
                close();
              }}
            >
              在文件管理器中显示
            </button>
          )}
          {external && (
            <a
              role="menuitem"
              href={uri}
              target="_blank"
              rel="noopener noreferrer"
              onClick={close}
            >
              在默认浏览器中打开
            </a>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              copyResourceUri(uri, copyScope, i18n?.language ?? "zh");
              close();
            }}
          >
            复制链接
          </button>
        </div>
      )}
    </span>
  );
}

function ResourceLink({ uri, name }: { uri: string; name: string }) {
  const { cwd } = useCodexContentOwner();
  const file = parseFileReference(uri, cwd),
    external = /^https?:\/\//i.test(uri);
  if (!file && !external)
    return (
      <span>
        {name} <small>（{uri}）</small>
      </span>
    );
  return (
    <span className="codex-resource-link-row">
      <a
        href={external ? uri : "#file"}
        className="codex-resource-link"
        target={external ? "_blank" : undefined}
        rel="noopener noreferrer"
        onClick={(event) => {
          if (!file) return;
          event.preventDefault();
          openResourceFile(file, cwd);
        }}
      >
        {name}
      </a>
      <ResourceOpenMenu uri={uri} file={file} cwd={cwd} />
    </span>
  );
}
function ToolBlock({
  block,
  index,
}: {
  block: Record<string, unknown>;
  index: number;
}) {
  const { i18n } = useTranslation("thread"),
    chinese = (i18n?.language ?? "zh").startsWith("zh");
  const text = typeof block.text === "string" ? block.text : null;
  const data = typeof block.data === "string" ? block.data : null;
  const mime = typeof block.mimeType === "string" ? block.mimeType : "";
  const imageUrl =
    typeof block.imageUrl === "string"
      ? nativeMediaUrl(block.imageUrl, "image")
      : null;
  const audioUrl =
    typeof block.audioUrl === "string"
      ? nativeMediaUrl(block.audioUrl, "audio")
      : null;
  if (block.type === "text" && text !== null)
    return (
      <div className="codex-native-tool-text">
        <div className="codex-native-tool-text-title">
          {chinese ? "纯文本" : "plaintext"}
        </div>
        <pre>{text}</pre>
      </div>
    );
  if (block.type === "image" && data && /^image\/[\w.+-]+$/.test(mime))
    return (
      <CodexImage
        src={`data:${mime};base64,${data}`}
        alt={`工具图片 ${index + 1}`}
      />
    );
  if (block.type === "image" && imageUrl)
    return <CodexImage src={imageUrl} alt={`工具图片 ${index + 1}`} />;
  if (block.type === "audio" && data && /^audio\/[\w.+-]+$/.test(mime))
    return (
      <audio
        controls
        src={`data:${mime};base64,${data}`}
        aria-label={`工具音频 ${index + 1}`}
      />
    );
  if (block.type === "audio" && audioUrl)
    return (
      <audio controls src={audioUrl} aria-label={`工具音频 ${index + 1}`} />
    );
  if (block.type === "resource_link" && typeof block.uri === "string")
    return (
      <ResourceLink
        uri={block.uri}
        name={typeof block.name === "string" ? block.name : block.uri}
      />
    );
  if (block.type === "resource") {
    const resource = object(block.resource),
      uri = typeof resource.uri === "string" ? resource.uri : "";
    return (
      <div className="codex-tool-resource">
        <ResourceLink uri={uri} name={uri || "资源"} />
        {typeof resource.text === "string" && <pre>{resource.text}</pre>}
        {typeof resource.blob === "string" && (
          <RawToolValue value={resource} label="查看二进制资源信息" />
        )}
      </div>
    );
  }
  return (
    <RawToolValue
      value={block}
      label={`内容：${typeof block.type === "string" ? block.type : "未知类型"}`}
    />
  );
}
export function ToolContent({ content }: { content: unknown }) {
  const blocks = Array.isArray(content) ? content : [];
  return (
    <div className="codex-tool-content">
      {blocks.map((value, index) => (
        <ToolBlock key={index} block={object(value)} index={index} />
      ))}
    </div>
  );
}
