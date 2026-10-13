import { useEffect, useRef, useState } from "react";
import { useCodexStore } from "@session/components/codex/stores";
import { CodexThread } from "@session/components/codex/thread/CodexThread";
import { ApprovalItem } from "@session/components/codex/items/ApprovalItem";
import { PermissionsItem } from "@session/components/codex/items/PermissionsItem";
import { ElicitationItem } from "@session/components/codex/items/ElicitationItem";
import { RequestUserInputItem } from "@session/components/codex/items/RequestUserInputItem";
import { codexService } from "@session/services/codexService";
import { closeSubagents } from "./service";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useAgentCenterStore, selectedAgentCard } from "@session/stores/useAgentCenterStore";
import { useSubagentFamily } from "./hooks";
import type { ChildState } from "./model";
import { subagentService } from "./service";
import { useSubagentStore } from "./store";
import { SubagentInput } from "./SubagentInput";
import "./subagents.css";

type Family = ReturnType<typeof useSubagentFamily>;
type Row = Family["rows"][number];

const DONE: ReadonlySet<ChildState> = new Set([
  "completed",
  "failed",
  "stopped",
]);

function statusLabel(state: ChildState) {
  switch (state) {
    case "running":
      return "处理中";
    case "pending":
      return "待处理";
    case "waiting":
      return "等待中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "stopped":
      return "已停止";
    case "unknown":
      return "待确认";
  }
}

function displayName(row: Row) {
  return (
    row.node.thread.agentNickname ??
    row.node.thread.name ??
    row.node.thread.id.slice(0, 8)
  );
}

function clip(value: string | undefined, limit: number) {
  const text = value?.trim();
  if (!text) return null;
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function span(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  return `${Math.floor(hours / 24)} 天`;
}

function Avatar({ id, label }: { id: string; label: string }) {
  let hash = 0;
  for (const ch of id) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      className="session-subagent-avatar"
      style={{ background: `hsl(${hash % 360} 42% 38%)` }}
      aria-hidden
    >
      {(label.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

export function SubagentPanel() {
  const currentThread = useCodexStore((s) => s.currentThreadId),
    agent = useAgentSettingsStore((s) => s.selectedAgent);
  const card = useAgentCenterStore(selectedAgentCard);
  const root = card?.kind === "codex" ? card.id : currentThread;
  const isCodex = card ? card.kind === "codex" : agent === "codex";
  const timings = useCodexStore((s) => s.turnTimingMap);
  const data = useSubagentFamily(root),
    selected = root ? data.selection[root] : null;
  const [showAllActive, setShowAllActive] = useState(false);
  const [showAllDone, setShowAllDone] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [verifiedSelection, setVerifiedSelection] = useState("");
  const [clock, setClock] = useState(Date.now());
  const backRef = useRef<HTMLButtonElement>(null);
  const row = data.rows.find((r) => r.node.thread.id === selected);
  const select = (id: string | null) => {
    if (root)
      useSubagentStore.setState((s) => ({
        selection: { ...s.selection, [root]: id },
      }));
  };
  const returnList = () => {
    const id = selected;
    select(null);
    requestAnimationFrame(() => {
      const task = id
        ? document.querySelector<HTMLButtonElement>(
            `[data-subagent-id="${CSS.escape(id)}"]`,
          )
        : null;
      task?.focus();
    });
  };
  useEffect(() => {
    setShowAllActive(false);
    setShowAllDone(false);
    setError("");
  }, [root]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (selected) requestAnimationFrame(() => backRef.current?.focus());
  }, [root, selected]);
  useEffect(() => {
    if (!root || !selected) return;
    let active = true;
    setError("");
    setVerifiedSelection("");
    subagentService
      .verify(root, selected)
      .then(() => {
        if (!active) return;
        setVerifiedSelection(`${root}:${selected}`);
        return codexService.loadThreadHistory(selected, undefined, {
          background: true,
          recent: true,
        });
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [root, selected, retry, data.runtimeEpoch, data.scope]);
  if (!root || !isCodex)
    return (
      <div className="session-subagent-panel">
        <p>请选择一个 Codex 主会话查看子智能体。</p>
      </div>
    );
  const inspected =
    !!selected &&
    verifiedSelection === `${root}:${selected}` &&
    !row?.node.unavailable;
  const active = data.rows.filter((item) => !DONE.has(item.state));
  const done = data.rows.filter((item) => DONE.has(item.state));
  const waiting = active.filter(
    (item) => item.state === "waiting" || item.state === "pending",
  ).length;
  const uncertain = !data.family?.complete;
  const activeCount = uncertain ? "待确认" : String(active.length);
  const elapsed = (item: Row) => {
    const timing = timings[item.node.thread.id];
    if (!timing?.startedAtMs) return null;
    return span(
      timing.durationMs ?? Math.max(0, clock - timing.startedAtMs),
    );
  };
  const finishedAgo = (item: Row) => {
    const updated = item.node.thread.updatedAt;
    if (!updated) return null;
    return `${span(Math.max(0, clock - updated * 1000))} 前`;
  };
  const preview = (item: Row) => {
    const text = clip(
      item.node.objective ?? item.node.thread.preview,
      60,
    );
    if (text) return text;
    if (DONE.has(item.state)) return null;
    if (item.state === "unknown" || item.node.unavailable) return "待确认";
    return "处理中";
  };
  const trailing = (item: Row) => {
    if (item.state === "waiting" || item.state === "pending") return "等待中";
    if (item.state === "unknown" || item.node.unavailable) return "待确认";
    if (DONE.has(item.state))
      return finishedAgo(item) ?? statusLabel(item.state);
    return elapsed(item) ?? statusLabel(item.state);
  };
  const modelLine = row
    ? [row.node.thread.model, row.node.thread.reasoningEffort]
        .filter(Boolean)
        .join(" · ")
    : "";
  const section = (
    title: string,
    items: Row[],
    limit: number,
    expanded: boolean,
    expand: () => void,
    empty: string | null,
    extra?: string,
  ) => (
    <section className="session-subagent-section">
      <h2>
        <span>
          {title} · {title === "已开启" ? activeCount : items.length}
        </span>
        {extra ? <small>{extra}</small> : null}
      </h2>
      {!items.length && empty ? <p>{empty}</p> : null}
      <div className="session-subagent-rows">
      {(expanded ? items : items.slice(0, limit)).map((item) => {
        const label = displayName(item);
        return (
          <button
            type="button"
            className="session-subagent-task"
            data-subagent-id={item.node.thread.id}
            key={item.node.thread.id}
            onClick={() => select(item.node.thread.id)}
          >
            <Avatar id={item.node.thread.id} label={label} />
            <span className="session-subagent-task-copy">
              <span className="session-subagent-task-line">
                <strong>{label}</strong>
                <span>{trailing(item)}</span>
              </span>
              {preview(item) ? <small>{preview(item)}</small> : null}
            </span>
          </button>
        );
      })}
      </div>
      {!expanded && items.length > limit ? (
        <button type="button" className="session-subagent-more" onClick={expand}>
          显示全部{title}
        </button>
      ) : null}
    </section>
  );
  return (
    <section
      className="session-subagent-panel"
      aria-label="子智能体"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          if (selected) returnList();
          else {
            closeSubagents();
            useCodexStore.getState().triggerInputFocus();
          }
        }
      }}
    >
      {selected ? (
        <>
          <header className="session-subagent-detail-bar">
            <button
              type="button"
              ref={backRef}
              aria-label="返回子代理列表"
              onClick={returnList}
            >
              ←
            </button>
            <Avatar
              id={selected}
              label={row ? displayName(row) : selected.slice(0, 8)}
            />
            <h2>{row ? displayName(row) : selected.slice(0, 8)}</h2>
            {modelLine ? <small>{modelLine}</small> : null}
          </header>
          {error ? (
            <p role="alert" className="session-subagent-notice">
              {error}
              <button
                type="button"
                onClick={() => setRetry((value) => value + 1)}
              >
                重新确认所属关系
              </button>
            </p>
          ) : null}
          {(!data.family?.complete || data.family?.error) && (
            <p role="status" className="session-subagent-notice">
              {data.family?.loading
                ? "正在加载最终回复…"
                : "此子智能体在当前分支上已不可用。"}
            </p>
          )}
          <div className="session-subagent-transcript">
            {inspected ? (
              <CodexThread threadId={selected} inspection />
            ) : (
              <p role="status">正在确认所属关系</p>
            )}
          </div>
          {!inspected && !!row?.pending && (
            <div className="session-subagent-pending">
              <p>历史暂不可用，仍可处理该子线程的实时请求。</p>
              <ApprovalItem currentThreadId={selected} />
              <PermissionsItem currentThreadId={selected} />
              <ElicitationItem currentThreadId={selected} />
              <RequestUserInputItem currentThreadId={selected} />
            </div>
          )}
          {inspected && row?.node.thread.canAcceptDirectInput === true && (
            <footer>
              <SubagentInput
                key={selected}
                root={root}
                id={selected}
                name={displayName(row)}
              />
            </footer>
          )}
        </>
      ) : (
        <div className="session-subagent-list">
          <header className="session-subagent-detail-bar">
            <h2>子智能体</h2>
          </header>
          <div className="session-subagent-sheet">
          {(!data.family?.complete || data.family?.error) && (
            <p role="status" className="session-subagent-notice">
              {data.family?.loading
                ? "正在加载最终回复…"
                : "此子智能体在当前分支上已不可用。"}
              {data.family?.error ? <small>{data.family.error}</small> : null}
            </p>
          )}
          {section(
            "已开启",
            uncertain ? [] : active,
            4,
            showAllActive,
            () => setShowAllActive(true),
            uncertain ? null : "没有已开启的子代理",
            waiting ? `${waiting} 个等待中` : undefined,
          )}
          {done.length
            ? section(
                "完成",
                done,
                10,
                showAllDone,
                () => setShowAllDone(true),
                null,
              )
            : null}
          </div>
        </div>
      )}
    </section>
  );
}
