import { useMemo, useState } from "react";
import { FileText, Globe, Plug } from "lucide-react";
import type { ServerNotification } from "@session/bindings";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@session/components/ui/sheet";
import { useCodexContentOwner } from "@session/components/codex/presentation/ownerContext";
import { resolveLiteralFilePath } from "@session/components/codex/presentation/fileReference";
import { openWorkspaceFileReference } from "@session/services/openWorkspaceFileReference";
import { buildSourceCatalogue, type SourceUse } from "./sourceCatalogue";
import { SourceMcpPreview } from "./SourceMcpPreview";
import "./sources.css";
const roles: Record<SourceUse, string> = {
  provided: "已提供",
  read: "已读取",
  created: "已创建",
  updated: "已修改",
};
export default function ThreadSourcesPanel({
  threadId,
  events,
  onClose,
}: {
  threadId: string;
  events: readonly ServerNotification[];
  onClose(): void;
}) {
  const owner = useCodexContentOwner(threadId);
  const catalogue = useMemo(
    () => buildSourceCatalogue(events, threadId, owner.cwd),
    [events, threadId, owner.cwd],
  );
  const [expandedCall, expandCall] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        className="codex-sources-panel overflow-y-auto"
        aria-label="会话来源"
      >
        <SheetTitle>来源</SheetTitle>
        <SheetDescription>
          当前会话已加载记录中的网页、文件和工具来源。
        </SheetDescription>
        {catalogue.truncated && (
          <p role="status">
            来源较多，已限制显示数量；更早来源可从对应历史消息查看。
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <section aria-label="网页来源">
          <h3>
            <Globe size={16} />
            网页
          </h3>
          {!catalogue.web.length && (
            <p className="codex-sources-empty">暂无网页来源</p>
          )}
          {catalogue.web.map((source) => (
            <details key={source.host}>
              <summary>
                {source.host}
                <span>{source.urls.length}</span>
              </summary>
              <ul>
                {source.urls.map((url) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </section>
        <section aria-label="文件来源">
          <h3>
            <FileText size={16} />
            文件
          </h3>
          {!catalogue.files.length && (
            <p className="codex-sources-empty">暂无文件来源</p>
          )}
          {catalogue.files.map((source) => (
            <div className="codex-source-file" key={source.path}>
              <button
                type="button"
                disabled={!owner.cwd}
                title={source.path}
                onClick={() => {
                  const path = resolveLiteralFilePath(source.path, owner.cwd);
                  if (!path || !owner.cwd) {
                    setError("无法确定该来源的原会话工作区。");
                    return;
                  }
                  setError(null);
                  void openWorkspaceFileReference(
                    { path, line: source.line, column: source.column },
                    owner.cwd,
                  ).then((opened) => {
                    if (!opened) setError("无法打开该来源文件。");
                  });
                }}
              >
                {source.path}
                {source.line ? `:${source.line}` : ""}
              </button>
              <small>
                {source.roles.map((role) => roles[role]).join(" · ")}
              </small>
            </div>
          ))}
        </section>
        <section aria-label="MCP来源">
          <h3>
            <Plug size={16} />
            工具来源
          </h3>
          {!catalogue.mcp.length && (
            <p className="codex-sources-empty">暂无工具来源</p>
          )}
          {catalogue.mcp.map((source) => (
            <div key={source.server} className="codex-source-mcp">
              <h4>
                {source.name}
                <span>{source.count} 次调用</span>
              </h4>
              {source.calls.map((call) => {
                const key = JSON.stringify([
                  call.threadId,
                  call.turnId,
                  call.itemId,
                ]);
                return (
                  <div key={key}>
                    <button
                      type="button"
                      aria-expanded={expandedCall === key}
                      onClick={() =>
                        expandCall(expandedCall === key ? null : key)
                      }
                    >
                      {call.tool}
                    </button>
                    {expandedCall === key && <SourceMcpPreview call={call} />}
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      </SheetContent>
    </Sheet>
  );
}
