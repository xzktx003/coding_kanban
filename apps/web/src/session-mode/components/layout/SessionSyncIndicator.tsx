import { useEffect, useRef, useState } from "react";
import { CloudOff, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAgentCenterStore } from "../../stores/useAgentCenterStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { useSessionSyncStore } from "../../stores/useSessionSyncStore";
import { retryEventStream } from "../../lib/eventStream";
import {
  connectionFailureText,
  downloadSessionConnectionDiagnostic,
  useSessionConnectionDiagnostics,
} from "../../services/sessionConnectionDiagnostics";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { DropdownMenuItem } from "../ui/dropdown-menu";
import {
  dismissSessionManagementOperation,
  pendingSessionManagementOperations,
  retrySessionManagementSync,
  useSessionManagementSyncStatus,
} from "../../services/sessionManagementClient";

/** Shared-list failures describe metadata synchronization, never Agent delivery. */
export function SessionSyncIndicator({
  healthOffline = false,
  menu = false,
}: {
  healthOffline?: boolean;
  menu?: boolean;
}) {
  const tabs = useAgentCenterStore(
    useShallow((s) => ({
      error: s.tabSyncError,
      pending: s.pendingTabOperations.length,
    })),
  );
  const projects = useWorkspaceStore(
    useShallow((s) => ({
      error: s.projectSyncError,
      pending: s.pendingProjectOperations.length,
    })),
  );
  const stream = useSessionSyncStore(
    useShallow((s) => ({ state: s.connection, error: s.connectionError })),
  );
  const diagnostics = useSessionConnectionDiagnostics(
    useShallow((s) => ({ tabs: s.tabs.failure, projects: s.projects.failure })),
  );
  const management = useSessionManagementSyncStatus(
    useShallow((s) => ({
      pending: s.pending,
      blocked: s.blocked,
      error: s.error,
    })),
  );
  const [open, setOpen] = useState(false);
  const urgentSeen = useRef("");
  const rows = [
    { channel: "tabs", label: "关注列表", ...tabs, failure: diagnostics.tabs },
    {
      channel: "projects",
      label: "项目列表",
      ...projects,
      failure: diagnostics.projects,
    },
    {
      channel: "management",
      label: "置顶与已读",
      pending: management.pending,
      error: management.pending
        ? (management.error ?? "管理更改正在同步")
        : undefined,
      failure: null,
    },
  ]
    .filter((row) => row.error)
    .map((row) => ({
      ...row,
      // Direct store errors (including old clients) must not borrow an unrelated diagnostic.
      failure:
        connectionFailureText(row.failure) === row.error ? row.failure : null,
    }));
  const streamFailed =
    stream.state === "paused" ||
    (stream.state === "reconnecting" && !healthOffline);
  const failed = rows.length > 0 || streamFailed;
  const urgent = rows.filter(
    (row) =>
      row.failure?.kind === "storage" ||
      [401, 403].includes(row.failure?.status ?? 0),
  );
  const urgentKey =
    urgent
      .map(
        (row) =>
          `${row.channel}:${row.failure?.kind}:${row.failure?.status}:${row.failure?.firstAt}`,
      )
      .join(",") + (stream.state === "paused" ? ":stream-paused" : "");
  useEffect(() => {
    if (!failed) setOpen(false);
    else if (urgentKey && urgentKey !== urgentSeen.current) setOpen(true);
    if (urgentKey) urgentSeen.current = urgentKey;
  }, [failed, urgentKey]);
  if (!failed) return null;
  const pending = rows.reduce((sum, row) => sum + row.pending, 0);
  const label = rows.length
    ? "同步待重试"
    : stream.state === "paused"
      ? "实时接收已暂停"
      : "实时连接恢复中";
  const summary = rows.length
    ? urgent.length
      ? "本机保存或访问权限需要处理"
      : pending
        ? `${pending} 项修改等待同步确认`
        : rows.map((row) => `${row.label}读取重试中`).join("、")
    : stream.state === "paused"
      ? "消息接收已暂停，任务状态待核对"
      : "正在恢复消息接收，任务状态待核对";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {menu ? (
          <DropdownMenuItem
            className="session-sync-menu-item"
            onSelect={(event) => event.preventDefault()}
            aria-label={`${label}：${summary}`}
          >
            <CloudOff size={15} aria-hidden="true" />
            <span>{label}</span>
            {pending > 0 && <span>{pending}</span>}
          </DropdownMenuItem>
        ) : (
          <button
            className="session-sync-indicator"
            type="button"
            data-urgent={Boolean(urgent.length || stream.state === "paused")}
            aria-label={`${label}：${summary}`}
            title={`${label}：${summary}`}
          >
            <CloudOff size={15} aria-hidden="true" />
            <span className="session-sync-label">{label}</span>
            {pending > 0 && <span>{pending}</span>}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="session-sync-details"
        aria-label="会话同步详情"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="session-sync-heading">
          <strong>{label}</strong>
          <button
            type="button"
            aria-label="收起同步详情"
            onClick={() => setOpen(false)}
          >
            <X size={16} />
          </button>
        </div>
        {rows.map((row) => (
          <div
            key={row.channel}
            className="session-sync-row"
            role={row.failure?.kind === "storage" ? "alert" : "status"}
          >
            <span>
              {row.label}
              {row.pending
                ? `有 ${row.pending} 项修改等待确认`
                : "读取暂不可用"}
            </span>
            {row.pending > 0 &&
              row.failure?.kind !== "storage" &&
              !(row.channel === "management" && management.blocked) && (
                <span>修改已保存在本机，连接恢复后自动同步。</span>
              )}
            <small>{connectionFailureText(row.failure) ?? row.error}</small>
          </div>
        ))}
        {management.blocked > 0 &&
          pendingSessionManagementOperations()
            .filter((op) => op.state !== "pending")
            .slice(0, 10)
            .map((op) => (
              <div className="session-sync-row" key={op.operationId}>
                <span>
                  {op.action.type === "pin" ? "置顶更改" : "已读状态更改"} ·{" "}
                  {op.target.id.slice(0, 32)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        "确认已查看共享状态，并忽略这条旧同步记录？这只清理本机管理记录。",
                      )
                    )
                      dismissSessionManagementOperation(op.operationId);
                  }}
                >
                  已核对，忽略旧记录
                </button>
              </div>
            ))}
        {streamFailed && (
          <div
            className="session-sync-row"
            role={stream.state === "paused" ? "alert" : "status"}
          >
            <span>
              {stream.state === "paused"
                ? "实时消息接收已暂停"
                : "实时消息正在重新连接"}
            </span>
            <small>{stream.error ?? "恢复后将核对任务状态与最新消息。"}</small>
          </div>
        )}
        <button
          className="session-sync-retry"
          type="button"
          onClick={() => {
            for (const row of rows)
              if (row.channel === "management") retrySessionManagementSync();
              else
                window.dispatchEvent(
                  new CustomEvent("session-sync-retry", {
                    detail: { channel: row.channel },
                  }),
                );
            if (streamFailed) retryEventStream();
          }}
        >
          {management.blocked
            ? "核对共享状态"
            : rows.length
              ? "立即同步"
              : "重试接收消息"}
        </button>
        <button
          type="button"
          className="session-sync-retry"
          onClick={downloadSessionConnectionDiagnostic}
        >
          导出连接诊断
        </button>
      </PopoverContent>
    </Popover>
  );
}
