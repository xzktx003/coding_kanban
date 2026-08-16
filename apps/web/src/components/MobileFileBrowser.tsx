import { useMemo, useRef, useState } from "react";

import type {
  AgentSessionRecord,
  FileEntry,
  FilePreviewResponse,
} from "@agent-orchestrator/shared";

import { previewFile } from "../lib/api";
import { copyTextToClipboard } from "../lib/clipboard";
import { isMarkdownFileName } from "../lib/file-types";
import {
  useFileBrowser,
  type UseFileBrowserHost,
} from "../lib/use-file-browser";
import { LazyMarkdownContent } from "./LazyMarkdownRenderedContent";

interface MobileFileBrowserProps {
  session: AgentSessionRecord;
  onBack: () => void;
  backLabel?: string;
}

interface MobileFilePreviewState {
  entry: FileEntry;
  loading: boolean;
  preview: FilePreviewResponse | null;
  error: string | null;
}

type MobileFilePreviewKind = "markdown" | "text" | "image" | "binary";

export function classifyMobileFilePreview(
  entry: FileEntry,
  preview: FilePreviewResponse,
): MobileFilePreviewKind {
  if (preview.encoding === "utf8") {
    return isMarkdownFileName(entry.name) ? "markdown" : "text";
  }
  return preview.mimeType?.startsWith("image/") ? "image" : "binary";
}

function isDirectory(entry: FileEntry): boolean {
  return (
    entry.type === "directory" ||
    (entry.type === "symlink" && entry.symlinkTargetType === "directory")
  );
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fileKindLabel(entry: FileEntry): string {
  if (isDirectory(entry)) return "目录";
  if (entry.type === "symlink") return "链接";
  const extension = entry.name.split(".").at(-1);
  return extension && extension !== entry.name
    ? extension.slice(0, 4).toUpperCase()
    : "文件";
}

export function MobileFileBrowser({
  session,
  onBack,
  backLabel = "返回项目",
}: MobileFileBrowserProps) {
  const defaultPath = session.repositoryRoot ?? session.workingDirectory ?? "~";
  const sshHost = session.sshTarget?.host;
  const sshPort = session.sshTarget?.port;
  const sshUsername = session.sshTarget?.username;
  const sshIdentityFile = session.sshTarget?.identityFile;
  const selectedHost = useMemo<UseFileBrowserHost>(
    () =>
      sshHost
        ? {
            type: "ssh",
            preset: {
              host: sshHost,
              port: sshPort ?? 22,
              username: sshUsername,
              identityFile: sshIdentityFile,
              defaultPath,
            },
          }
        : { type: "local" },
    [defaultPath, sshHost, sshIdentityFile, sshPort, sshUsername],
  );
  const {
    currentPath,
    entries,
    loading,
    error,
    showHidden,
    setShowHidden,
    filterQuery,
    setFilterQuery,
    sshTarget,
    navigate,
    refresh,
    goHome,
    goUp,
  } = useFileBrowser(selectedHost, true, {
    scopeKey: `mobile-files:${session.id}`,
    defaultPath,
  });
  const [filePreview, setFilePreview] = useState<MobileFilePreviewState | null>(
    null,
  );
  const previewRequestIdRef = useRef(0);

  const openFile = async (entry: FileEntry) => {
    const requestId = ++previewRequestIdRef.current;
    setFilePreview({ entry, loading: true, preview: null, error: null });
    try {
      const preview = await previewFile({ path: entry.path, sshTarget });
      if (requestId !== previewRequestIdRef.current) return;
      setFilePreview({ entry, loading: false, preview, error: null });
    } catch (caughtError) {
      if (requestId !== previewRequestIdRef.current) return;
      setFilePreview({
        entry,
        loading: false,
        preview: null,
        error:
          caughtError instanceof Error ? caughtError.message : "读取文件失败",
      });
    }
  };

  if (filePreview) {
    const { entry, preview, loading: previewLoading } = filePreview;
    const previewKind = preview
      ? classifyMobileFilePreview(entry, preview)
      : null;
    return (
      <section aria-label="手机文件预览" className="mobile-file-preview">
        <header className="mobile-file-preview-header">
          <button
            className="mobile-file-browser-control"
            onClick={() => {
              previewRequestIdRef.current += 1;
              setFilePreview(null);
            }}
            type="button"
          >
            返回文件
          </button>
          <div>
            <strong>{entry.name}</strong>
            <span>{formatFileSize(entry.size)}</span>
          </div>
          <button
            className="mobile-file-browser-control"
            onClick={() => void copyTextToClipboard(entry.path)}
            type="button"
          >
            复制路径
          </button>
        </header>
        <code className="mobile-file-preview-path">{entry.path}</code>
        <div className="mobile-file-preview-content">
          {previewLoading ? (
            <div className="mobile-file-browser-state">正在读取文件...</div>
          ) : filePreview.error ? (
            <div className="mobile-file-browser-state" role="alert">
              <strong>文件读取失败</strong>
              <span>{filePreview.error}</span>
              <button onClick={() => void openFile(entry)} type="button">
                重试
              </button>
            </div>
          ) : preview && previewKind === "markdown" ? (
            <LazyMarkdownContent
              className="mobile-file-preview-markdown"
              content={preview.content}
              fallbackClassName="mobile-file-preview-loading"
              fallbackTestId="mobile-markdown-loading"
              fallbackText="正在渲染 Markdown..."
              testId="mobile-markdown-preview"
            />
          ) : preview && previewKind === "text" ? (
            <pre>{preview.content}</pre>
          ) : preview && previewKind === "image" ? (
            <img
              alt={entry.name}
              src={`data:${preview.mimeType};base64,${preview.content}`}
            />
          ) : (
            <div className="mobile-file-browser-state">
              <strong>该文件不支持文本预览</strong>
              <span>
                {preview?.mimeType ?? "未知类型"} · {formatFileSize(entry.size)}
              </span>
            </div>
          )}
        </div>
        {preview?.truncated && (
          <div className="mobile-file-preview-truncated">
            文件较大，当前仅展示开头部分。
          </div>
        )}
      </section>
    );
  }

  return (
    <section aria-label="手机文件系统" className="mobile-file-browser">
      <header className="mobile-file-browser-header">
        <button
          className="mobile-file-browser-control"
          onClick={onBack}
          type="button"
        >
          {backLabel}
        </button>
        <div>
          <strong>{session.projectName ?? session.displayName}</strong>
          <span>{session.sshTarget ? session.sshTarget.host : "本机文件"}</span>
        </div>
      </header>

      <div className="mobile-file-browser-pathbar">
        <code title={currentPath}>{currentPath}</code>
        <div>
          <button
            className="mobile-file-browser-control"
            disabled={loading}
            onClick={() => void goHome()}
            type="button"
          >
            主目录
          </button>
          <button
            className="mobile-file-browser-control"
            disabled={loading}
            onClick={() => void goUp()}
            type="button"
          >
            上一级
          </button>
          <button
            className="mobile-file-browser-control"
            disabled={loading}
            onClick={() => void refresh()}
            type="button"
          >
            刷新
          </button>
        </div>
      </div>

      <div className="mobile-file-browser-filters">
        <input
          aria-label="筛选文件"
          onChange={(event) => setFilterQuery(event.target.value)}
          placeholder="搜索当前目录"
          type="search"
          value={filterQuery}
        />
        <label>
          <input
            checked={showHidden}
            onChange={(event) => setShowHidden(event.target.checked)}
            type="checkbox"
          />
          显示隐藏文件
        </label>
      </div>

      <div aria-busy={loading} className="mobile-file-list">
        {loading && entries.length === 0 ? (
          <div className="mobile-file-browser-state">正在读取目录...</div>
        ) : error ? (
          <div className="mobile-file-browser-state" role="alert">
            <strong>目录读取失败</strong>
            <span>{error}</span>
            <button onClick={() => void refresh()} type="button">
              重试
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="mobile-file-browser-state">当前目录没有文件。</div>
        ) : (
          entries.map((entry) => {
            const directory = isDirectory(entry);
            return (
              <button
                className="mobile-file-entry"
                key={entry.path}
                onClick={() =>
                  directory ? void navigate(entry.path) : void openFile(entry)
                }
                type="button"
              >
                <span className="mobile-file-entry-kind">
                  {fileKindLabel(entry)}
                </span>
                <span className="mobile-file-entry-identity">
                  <strong>{entry.name}</strong>
                  <small>
                    {directory
                      ? new Date(entry.modifiedAt).toLocaleString("zh-CN")
                      : `${formatFileSize(entry.size)} · ${new Date(entry.modifiedAt).toLocaleString("zh-CN")}`}
                  </small>
                </span>
                <span className="mobile-file-entry-action">
                  {directory ? "进入" : "预览"}
                </span>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
