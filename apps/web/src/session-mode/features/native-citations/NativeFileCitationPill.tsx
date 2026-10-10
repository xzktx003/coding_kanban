import { useMemo, type KeyboardEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { resolveLiteralFilePath } from "@session/components/codex/presentation/fileReference";
import {
  NativeCitationFileIcon,
  nativeCitationFileKind,
} from "./NativeCitationFileIcon";
import {
  parseNativeFileCitationAttributes,
  type NativeFileCitation,
} from "./nativeFileCitations";
import "./native-citations.css";
import { nativeCitationLabels } from "./nativeCitationCopy";

export type NativeCitationOwner = Readonly<{
  threadId?: string | null;
  cwd?: string | null;
  hostId?: string | null;
}>;
export type NativeCitationFileReference = {
  path: string;
  line?: number;
  endLine?: number;
};

export function NativeFileCitationPill({
  citation,
  owner,
  onOpen,
}: {
  citation: NativeFileCitation;
  owner: NativeCitationOwner;
  onOpen: (
    reference: NativeCitationFileReference,
    owner: NativeCitationOwner,
  ) => void;
}) {
  const { i18n } = useTranslation();
  const snapshot = useMemo(
    () => Object.freeze({ ...owner }),
    [owner.threadId, owner.cwd, owner.hostId],
  );
  const validated = parseNativeFileCitationAttributes({
    ...citation,
    lineRangeStart: citation.lineStart,
    lineRangeEnd: citation.lineEnd,
  });
  if (!validated || validated.kind !== citation.kind)
    return <span>{citation.label ?? citation.path}</span>;
  if (validated.kind === "external")
    return (
      <a
        className="native-citation-external"
        href={validated.path}
        target="_blank"
        rel="noreferrer"
      >
        {validated.label ?? validated.path}
      </a>
    );
  const { path, lineStart, lineEnd } = validated;
  const resolvedPath = resolveLiteralFilePath(path, snapshot.cwd);
  const name = path.split(/[\\/]/).at(-1) || path;
  const isCode = new Set([
    "code",
    "cplusplus",
    "html",
    "java",
    "javascript",
    "json",
    "notebook",
    "php",
    "python",
    "react",
    "rust",
    "typescript",
    "css",
    "toml",
    "shell",
  ]).has(nativeCitationFileKind(path));
  const zh = i18n.language.startsWith("zh");
  const location =
    lineStart == null ||
    (lineStart === 1 && !isCode && (lineEnd == null || lineEnd === lineStart))
      ? ""
      : lineEnd != null && lineEnd !== lineStart
        ? zh
          ? `第 ${lineStart}-${lineEnd} 行`
          : `lines ${lineStart}-${lineEnd}`
        : zh
          ? `第 ${lineStart} 行`
          : `line ${lineStart}`;
  const label = location ? `${name} (${location})` : name;
  const ariaLabel = nativeCitationLabels(validated, i18n.language).ariaLabel;
  const copyText =
    path +
    (lineStart ? `:${lineStart}` : "") +
    (lineEnd && lineEnd !== lineStart ? `-${lineEnd}` : "");
  const open = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!resolvedPath) return;
    onOpen(
      {
        path: resolvedPath,
        ...(lineStart ? { line: lineStart } : {}),
        ...(lineEnd ? { endLine: lineEnd } : {}),
      },
      snapshot,
    );
  };
  return (
    <span
      className="native-file-citation"
      role="button"
      tabIndex={resolvedPath ? 0 : -1}
      aria-disabled={!resolvedPath || undefined}
      aria-label={ariaLabel}
      title={copyText}
      data-file-reference="true"
      data-markdown-copy-text={copyText}
      data-inline-mention-interactive={resolvedPath ? "" : undefined}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter") open(event);
        else if (event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " ") open(event);
        else if (event.key === "Enter") event.stopPropagation();
      }}
    >
      <span className="native-file-citation-content">
        <span
          className="native-file-citation-mention"
          data-appearance="inline-mention"
          data-layout="inline-flow"
          data-font-weight="medium"
          data-tone="accent"
          data-underline-on-hover=""
        >
          <span className="native-file-citation-icon">
            <NativeCitationFileIcon path={path} />
          </span>
          <span className="native-file-citation-label">{label}</span>
        </span>
      </span>
    </span>
  );
}
