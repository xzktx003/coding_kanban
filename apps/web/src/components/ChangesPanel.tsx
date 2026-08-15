import { useEffect, useMemo, useState } from "react";

import type {
  AgentSessionRecord,
  AgentTaskDiffResponse,
  CheckoutDiffResponse,
  DiffFileChange,
  DiffFileStatus,
} from "@agent-orchestrator/shared";

import { getAgentTaskDiff, getCheckoutDiff } from "../lib/api";
import { copyTextToClipboard } from "../lib/clipboard";

type DiffScope = "task" | "checkout";

interface ChangesPanelProps {
  session: AgentSessionRecord;
  compact?: boolean;
  onClose?: () => void;
  onReference?: (reference: string) => void;
}

interface RenderedDiffLine {
  content: string;
  kind: "context" | "added" | "deleted" | "hunk" | "meta";
  oldLine: number | null;
  newLine: number | null;
}

interface CompactChangesFilePickerProps {
  files: DiffFileChange[];
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
}

interface FullscreenDiffViewProps {
  file: DiffFileChange;
  onClose: () => void;
  onReference?: (reference: string) => void;
}

const statusMetadata: Record<DiffFileStatus, { label: string; short: string }> = {
  modified: { label: "已修改", short: "M" },
  added: { label: "新增", short: "A" },
  deleted: { label: "已删除", short: "D" },
  renamed: { label: "已重命名", short: "R" },
  untracked: { label: "未跟踪", short: "U" },
  conflicted: { label: "冲突", short: "C" },
  binary: { label: "二进制", short: "B" },
};

function splitFilePath(path: string): { directory: string; name: string } {
  const index = path.lastIndexOf("/");
  return index < 0
    ? { directory: "项目根目录", name: path }
    : { directory: path.slice(0, index), name: path.slice(index + 1) };
}

function renderDiffLines(patch: string): RenderedDiffLine[] {
  let oldLine = 0;
  let newLine = 0;
  return patch.split("\n").map((content) => {
    const hunk = content.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return { content, kind: "hunk", oldLine: null, newLine: null };
    }
    if (
      content.startsWith("diff ") ||
      content.startsWith("index ") ||
      content.startsWith("---") ||
      content.startsWith("+++") ||
      content.startsWith("*** ")
    ) {
      return { content, kind: "meta", oldLine: null, newLine: null };
    }
    if (content.startsWith("+")) {
      const line = { content, kind: "added" as const, oldLine: null, newLine };
      newLine += 1;
      return line;
    }
    if (content.startsWith("-")) {
      const line = { content, kind: "deleted" as const, oldLine, newLine: null };
      oldLine += 1;
      return line;
    }
    const line = { content, kind: "context" as const, oldLine, newLine };
    if (oldLine > 0) oldLine += 1;
    if (newLine > 0) newLine += 1;
    return line;
  });
}

export function CompactChangesFilePicker({
  files,
  selectedPath,
  onSelectPath,
}: CompactChangesFilePickerProps) {
  return (
    <label className="changes-compact-file-picker">
      <span>文件</span>
      <select
        aria-label="选择变更文件"
        onChange={(event) => onSelectPath(event.target.value)}
        value={selectedPath ?? ""}
      >
        {files.map((file) => (
          <option key={file.path} value={file.path}>
            {statusMetadata[file.status].short} · {file.path} (+{file.addedLines} / -{file.deletedLines})
          </option>
        ))}
      </select>
    </label>
  );
}

function DiffCode({ file }: { file: DiffFileChange }) {
  const diffLines = renderDiffLines(file.patch ?? "");

  if (file.binary) {
    return <div className="changes-empty">二进制文件不提供文本 Diff。</div>;
  }

  return (
    <div className="diff-code" role="table">
      {diffLines.map((line, index) => (
        <div
          className={`diff-row diff-row--${line.kind}`}
          key={`${index}-${line.content}`}
          role="row"
        >
          <span className="diff-line-number">{line.oldLine ?? ""}</span>
          <span className="diff-line-number">{line.newLine ?? ""}</span>
          <code>{line.content || " "}</code>
        </div>
      ))}
    </div>
  );
}

export function FullscreenDiffView({
  file,
  onClose,
  onReference,
}: FullscreenDiffViewProps) {
  const parts = splitFilePath(file.path);
  const reference = `@${file.path}`;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      aria-label="全屏文件变更"
      className="fullscreen-diff-overlay"
      role="dialog"
    >
      <header className="fullscreen-diff-header">
        <div className="diff-file-title">
          <span
            className={`changes-file-status changes-file-status--${file.status}`}
          >
            {statusMetadata[file.status].short}
          </span>
          <div>
            <strong>{parts.name}</strong>
            <small>{parts.directory}</small>
          </div>
        </div>
        <div className="diff-file-actions">
          <button
            onClick={() => void copyTextToClipboard(file.path)}
            type="button"
          >
            复制路径
          </button>
          <button
            onClick={() =>
              onReference
                ? onReference(reference)
                : void copyTextToClipboard(reference)
            }
            type="button"
          >
            引用文件
          </button>
          <button onClick={onClose} type="button">
            退出全屏
          </button>
        </div>
      </header>
      <div className="fullscreen-diff-content">
        <DiffCode file={file} />
      </div>
    </div>
  );
}

export function ChangesPanel({
  session,
  compact = false,
  onClose,
  onReference,
}: ChangesPanelProps) {
  const [scope, setScope] = useState<DiffScope>("checkout");
  const [taskDiff, setTaskDiff] = useState<AgentTaskDiffResponse | null>(null);
  const [checkoutDiff, setCheckoutDiff] =
    useState<CheckoutDiffResponse | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [fullscreenFile, setFullscreenFile] =
    useState<DiffFileChange | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      if (scope === "task") setTaskDiff(await getAgentTaskDiff(session.id));
      else setCheckoutDiff(await getCheckoutDiff(session.id));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [session.id, scope]);

  const response = scope === "task" ? taskDiff : checkoutDiff;
  const files = useMemo(
    () =>
      (response?.files ?? []).filter((file) =>
        file.path.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [query, response],
  );
  const groups = useMemo(() => {
    const grouped = new Map<DiffFileStatus, DiffFileChange[]>();
    for (const file of files) {
      const group = grouped.get(file.status) ?? [];
      group.push(file);
      grouped.set(file.status, group);
    }
    return [...grouped.entries()];
  }, [files]);
  const selectedFile =
    files.find((file) => file.path === selectedPath) ?? files[0] ?? null;
  useEffect(() => {
    if (files.length && !files.some((file) => file.path === selectedPath)) {
      setSelectedPath(files[0]!.path);
    }
  }, [files, selectedPath]);

  const reference = selectedFile ? `@${selectedFile.path}` : "";
  const selectedParts = selectedFile ? splitFilePath(selectedFile.path) : null;

  return (
    <section
      className={`changes-panel${compact ? " changes-panel--compact" : ""}`}
      data-testid="changes-panel"
    >
      <header className="changes-panel-header">
        <div className="changes-panel-heading">
          <span className="changes-panel-eyebrow">CODE REVIEW</span>
          <strong>文件变更</strong>
          <span className="changes-panel-session">{session.displayName}</span>
        </div>
        <div className="changes-panel-header-actions">
          <button onClick={() => void load()} type="button">↻ 刷新</button>
          {onClose && <button aria-label="关闭变更面板" onClick={onClose} type="button">×</button>}
        </div>
      </header>

      <div className="changes-scope-tabs" role="tablist">
        <button aria-selected={scope === "task"} className={scope === "task" ? "active" : ""} onClick={() => setScope("task")} role="tab" type="button">
          本次任务 {taskDiff?.available && <span>{taskDiff.changedFiles}</span>}
        </button>
        <button aria-selected={scope === "checkout"} className={scope === "checkout" ? "active" : ""} onClick={() => setScope("checkout")} role="tab" type="button">
          当前工作区 {checkoutDiff?.available && <span>{checkoutDiff.changedFiles}</span>}
        </button>
      </div>

      {loading && !response ? (
        <div className="changes-empty">正在读取文件变更…</div>
      ) : response && !response.available ? (
        <div className="changes-empty">
          <strong>{scope === "task" ? "本次任务变更不可归因" : "当前工作区 Diff 不可用"}</strong>
          <p>{response.unavailableReason}</p>
          {scope === "task" && <button onClick={() => setScope("checkout")} type="button">查看当前工作区</button>}
        </div>
      ) : response ? (
        <>
          <div className="changes-summary">
            <div className="changes-summary-source">
              <strong>{scope === "task" ? "Codex 本次任务" : checkoutDiff?.branch ?? "Detached HEAD"}</strong>
              <span>{scope === "task" ? "基于 Codex 文件操作记录" : `HEAD ${checkoutDiff?.head ?? ""} → 工作区`}</span>
            </div>
            <div className="changes-summary-stats">
              <span>{response.changedFiles} 个文件</span><em>+{response.addedLines}</em><i>-{response.deletedLines}</i>
            </div>
            {scope === "task" && taskDiff?.warning && <small className="changes-warning">{taskDiff.warning}</small>}
          </div>

          <div className="changes-body">
            <aside className="changes-files">
              <div className="changes-search"><span aria-hidden="true">⌕</span><input aria-label="筛选变更文件" onChange={(event) => setQuery(event.target.value)} placeholder="按文件名筛选" value={query} /></div>
              {compact ? (
                <CompactChangesFilePicker
                  files={files}
                  selectedPath={selectedFile?.path ?? null}
                  onSelectPath={setSelectedPath}
                />
              ) : (
                <div className="changes-file-list">
                  {groups.map(([status, groupFiles]) => (
                    <section className="changes-file-group" key={status}>
                      <header><span>{statusMetadata[status].label}</span><b>{groupFiles.length}</b></header>
                      {groupFiles.map((file) => {
                        const parts = splitFilePath(file.path);
                        return (
                          <button className={selectedFile?.path === file.path ? "active" : ""} key={file.path} onClick={() => setSelectedPath(file.path)} type="button">
                            <span className={`changes-file-status changes-file-status--${file.status}`}>{statusMetadata[file.status].short}</span>
                            <span className="changes-file-identity"><strong title={file.path}>{parts.name}</strong><small title={parts.directory}>{parts.directory}</small></span>
                            <span className="changes-file-stats"><em>+{file.addedLines}</em><i>-{file.deletedLines}</i></span>
                          </button>
                        );
                      })}
                    </section>
                  ))}
                </div>
              )}
            </aside>

            <article className="diff-viewer">
              {selectedFile && selectedParts ? (
                <>
                  <div className="diff-file-header">
                    <div className="diff-file-title"><span className={`changes-file-status changes-file-status--${selectedFile.status}`}>{statusMetadata[selectedFile.status].short}</span><div><strong>{selectedParts.name}</strong><small>{selectedParts.directory}</small></div></div>
                    <div className="diff-file-actions"><button onClick={() => setFullscreenFile(selectedFile)} type="button">全屏查看</button><button onClick={() => void copyTextToClipboard(selectedFile.path)} type="button">复制路径</button><button onClick={() => onReference ? onReference(reference) : void copyTextToClipboard(reference)} type="button">引用文件</button></div>
                  </div>
                  <DiffCode file={selectedFile} />
                </>
              ) : <div className="changes-empty">没有匹配的文件变更。</div>}
            </article>
          </div>
          {fullscreenFile && (
            <FullscreenDiffView
              file={fullscreenFile}
              onClose={() => setFullscreenFile(null)}
              onReference={onReference}
            />
          )}
        </>
      ) : null}
    </section>
  );
}
