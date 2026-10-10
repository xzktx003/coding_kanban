import { useState } from "react";
import { CodexImage } from "./CodexImage";
import { useCodexContentOwner } from "./ownerContext";
import { parseFileReference } from "./fileReference";
import { useEditorStore } from "@session/stores/useEditorStore";
import { useLayoutStore } from "@session/stores";
import { nativeMediaUrl } from "./nativeMedia";
import { nativeToolJson } from "./nativeToolSemantics";
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
    <a
      href={external ? uri : "#file"}
      className="codex-resource-link"
      target={external ? "_blank" : undefined}
      rel="noopener noreferrer"
      onClick={(event) => {
        if (!file) return;
        event.preventDefault();
        useEditorStore
          .getState()
          .revealFile(file.path, cwd ?? undefined, file.line, file.column);
        const layout = useLayoutStore.getState();
        layout.setActiveRightPanelTab("files");
        layout.setRightPanelOpen(true);
      }}
    >
      {name}
    </a>
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
