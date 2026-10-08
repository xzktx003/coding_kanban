import { useEffect, useRef, useState } from "react";
import { useCodexStore } from "@session/components/codex/stores";
import { CodexThread } from "@session/components/codex/thread/CodexThread";
import { ApprovalItem } from "@session/components/codex/items/ApprovalItem";
import { PermissionsItem } from "@session/components/codex/items/PermissionsItem";
import { ElicitationItem } from "@session/components/codex/items/ElicitationItem";
import { RequestUserInputItem } from "@session/components/codex/items/RequestUserInputItem";
import { codexService } from "@session/services/codexService";
import {
  appendDraft,
  sessionDraftKey,
} from "@session/stores/useSessionDraftStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useAgentCenterStore, selectedAgentCard } from "@session/stores/useAgentCenterStore";
import { useSubagentFamily } from "./hooks";
import { CHILD_LABELS, selectStopTargets } from "./model";
import { subagentService } from "./service";
import { useSubagentStore } from "./store";
import { SubagentInput } from "./SubagentInput";
import { mentionDrafts } from "./mentions";
import type { SubagentStopTarget } from "@agent-orchestrator/shared";
import "./subagents.css";
export function SubagentPanel() {
  const currentThread = useCodexStore((s) => s.currentThreadId),
    agent = useAgentSettingsStore((s) => s.selectedAgent);
  const card = useAgentCenterStore(selectedAgentCard);
  const root = card?.kind === "codex" ? card.id : currentThread;
  const isCodex = card ? card.kind === "codex" : agent === "codex";
  const rootRef = useRef(root);
  rootRef.current = root;
  const timings = useCodexStore((s) => s.turnTimingMap);
  const data = useSubagentFamily(root),
    selected = root ? data.selection[root] : null;
  const [history, setHistory] = useState(false),
    [search, setSearch] = useState(""),
    [limit, setLimit] = useState(30),
    [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [verifiedSelection, setVerifiedSelection] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [clock, setClock] = useState(Date.now());
  const [targets, setTargets] = useState<SubagentStopTarget[] | null>(null),
    [stopping, setStopping] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null),
    backRef = useRef<HTMLButtonElement>(null);
  const row = data.rows.find((r) => r.node.thread.id === selected);
  const select = (id: string | null) => {
    if (root)
      useSubagentStore.setState((s) => ({
        selection: { ...s.selection, [root]: id },
      }));
  };
  const returnList = () => {
    const id = selected;
    if (row && !row.current) setHistory(true);
    setCollapsed(new Set());
    select(null);
    requestAnimationFrame(() => {
      const task = id
        ? document.querySelector<HTMLButtonElement>(
            `[data-subagent-id="${CSS.escape(id)}"]`,
          )
        : null;
      (
        task ??
        document.querySelector<HTMLInputElement>(".session-subagent-list input")
      )?.focus();
    });
  };
  useEffect(() => {
    setHistory(false);
    setSearch("");
    setLimit(30);
    setTargets(null);
    setStopping(false);
    setError("");
    setCollapsed(new Set());
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
  useEffect(() => {
    if (targets) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [targets]);
  if (!root || !isCodex)
    return (
      <div className="session-subagent-panel">
        <p>请选择一个 Codex 主会话查看子任务。</p>
      </div>
    );
  const inspected =
    !!selected &&
    verifiedSelection === `${root}:${selected}` &&
    !row?.node.unavailable;
  const belowCollapsed = (id: string) => {
    const seen = new Set<string>();
    let p = data.nodes[id]?.parentId;
    while (p && p !== root && !seen.has(p)) {
      if (collapsed.has(p)) return true;
      seen.add(p);
      p = data.nodes[p]?.parentId;
    }
    return false;
  };
  const elapsed = (id: string) => {
    const timing = timings[id];
    return timing
      ? `${Math.floor((timing.durationMs ?? Math.max(0, clock - timing.startedAtMs)) / 1000)} 秒`
      : "耗时未记录";
  };
  const rows = data.rows.filter(
    (r) =>
      (history ||
        r.current ||
        r.state === "running" ||
        r.state === "pending") &&
      !belowCollapsed(r.node.thread.id) &&
      `${r.node.thread.agentNickname ?? ""} ${r.node.objective ?? ""} ${r.node.thread.preview ?? ""} ${r.node.thread.agentRole ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const name = (r: NonNullable<typeof row>) =>
    r.node.thread.agentNickname ??
    r.node.thread.name ??
    r.node.thread.id.slice(0, 8);
  const stopScope = (id?: string, subtree = true) => {
    const pending = selectStopTargets(data.rows, history, id, subtree);
    if (pending.length) setTargets(pending);
    else setError("当前执行轮次尚未确认，请刷新后重试；未发送停止请求");
  };
  const confirmStop = async () => {
    if (!targets || stopping) return;
    const captured = targets,
      capturedRoot = root;
    setStopping(true);
    try {
      await subagentService.stop(capturedRoot, captured);
      if (rootRef.current === capturedRoot) setTargets(null);
    } catch (e) {
      if (rootRef.current === capturedRoot) {
        setError(String(e));
        setTargets(null);
      }
    } finally {
      if (rootRef.current === capturedRoot) setStopping(false);
    }
  };
  const path = row
    ? (() => {
        const names = [name(row)],
          seen = new Set<string>();
        let p = row.node.parentId;
        while (p !== root && data.nodes[p] && !seen.has(p)) {
          seen.add(p);
          names.unshift(data.nodes[p].thread.agentNickname ?? p.slice(0, 8));
          p = data.nodes[p].parentId;
        }
        return names.join(" / ");
      })()
    : "";
  return (
    <section
      className="session-subagent-panel"
      aria-label="子任务工作台"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !targets) {
          e.stopPropagation();
          if (selected) returnList();
          else {
            useLayoutStore.getState().setRightPanelOpen(false);
            useCodexStore.getState().triggerInputFocus();
          }
        }
      }}
    >
      <header>
        {selected ? (
          <button type="button" ref={backRef} onClick={returnList}>
            ← 返回子任务列表
          </button>
        ) : (
          <h2>子任务 · {data.rows.length}</h2>
        )}
        {selected && (
          <button
            type="button"
            onClick={() => {
              void subagentService.refresh(root);
              setRetry((r) => r + 1);
            }}
          >
            重新核对子任务
          </button>
        )}
        {row && (
          <>
            <h2>
              {name(row)}{" "}
              <span data-child-state={row.state}>
                {CHILD_LABELS[row.state]}
              </span>
            </h2>
            <small>
              {row.node.thread.agentRole ?? "角色未知"} ·{" "}
              {row.node.thread.model ?? "模型信息未记录"}{" "}
              {row.node.thread.reasoningEffort ?? ""}
            </small>
          </>
        )}
        {!selected && (
          <div className="session-subagent-filters">
            <button
              type="button"
              aria-pressed={!history}
              onClick={() => setHistory(false)}
            >
              本轮
            </button>
            <button
              type="button"
              aria-pressed={history}
              onClick={() => setHistory(true)}
            >
              全部历史
            </button>
            <button
              type="button"
              onClick={() => void subagentService.refresh(root)}
            >
              刷新
            </button>
          </div>
        )}
        {(!data.family?.complete || data.family?.error) && (
          <p role="status" className="session-subagent-notice">
            {data.family?.loading
              ? "正在确认子任务…"
              : "子任务信息未完整确认，保留已知记录"}
            {data.family?.error && <small>{data.family.error}</small>}
          </p>
        )}
        {data.family?.checkedAt ? (
          <small>
            最近确认：{new Date(data.family.checkedAt).toLocaleTimeString()}
          </small>
        ) : null}
        {error && <p role="alert">{error}</p>}
      </header>
      {selected ? (
        <>
          {row && (
            <div className="session-subagent-detail-meta">
              <small>{path}</small>
              <p>
                {row.node.objective ??
                  row.node.thread.preview ??
                  "任务摘要未记录"}
              </p>
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard.writeText(row.node.thread.id)
                }
              >
                复制线程 ID
              </button>
              {row.node.thread.canAcceptDirectInput !== true && (
                <p className="session-subagent-notice">
                  由主 Agent 调度 ·{" "}
                  {row.node.thread.canAcceptDirectInput === false
                    ? "子线程只读"
                    : "输入权限待确认"}
                </p>
              )}
              <small>
                显示原生子线程历史；无法确认继承上下文边界时保留完整记录。
              </small>
              {inspected && row.turnId && (
                <>
                  <button
                    type="button"
                    onClick={() => stopScope(selected, false)}
                  >
                    停止此任务…
                  </button>
                  <button type="button" onClick={() => stopScope(selected)}>
                    停止此任务及后代…
                  </button>
                </>
              )}
            </div>
          )}
          <div className="session-subagent-transcript">
            {inspected ? (
              <CodexThread threadId={selected} inspection />
            ) : (
              <p role="status">
                正在验证子任务所属关系；验证成功后显示历史和操作。
              </p>
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
          <footer>
            {inspected &&
              (row?.node.thread.canAcceptDirectInput === true ? (
                <SubagentInput
                  key={selected}
                  root={root}
                  id={selected}
                  name={name(row)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const label = row ? name(row) : selected;
                    const owner = sessionDraftKey("codex", root);
                    // This is an instruction to the parent, never a direct-send receipt to the child.
                    mentionDrafts.add(owner, {
                      name: label,
                      path: `agent://${selected}`,
                    });
                    appendDraft(owner, `请让 @${label} 跟进：`);
                    useLayoutStore.getState().setRightPanelOpen(false);
                    useCodexStore.getState().triggerInputFocus();
                  }}
                >
                  在主会话中跟进{row ? ` ${name(row)}` : ""}
                </button>
              ))}
          </footer>
        </>
      ) : (
        <>
          <div className="session-subagent-list">
            <input
              aria-label="搜索子任务"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setLimit(30);
              }}
              placeholder="搜索名称、角色或任务…"
            />
            {!rows.length && (
              <p>
                {data.family?.complete
                  ? "当前范围内没有子任务"
                  : "等待确认子任务；也可切换全部历史"}
              </p>
            )}
            {(
              [
                "running",
                "pending",
                "waiting",
                "completed",
                "failed",
                "stopped",
                "unknown",
              ] as const
            ).map((state) => {
              const group = rows
                .slice(0, limit)
                .filter((r) => r.state === state);
              if (!group.length) return null;
              return (
                <div key={state}>
                  <h3>
                    {CHILD_LABELS[state]} ·{" "}
                    {rows.filter((r) => r.state === state).length}
                  </h3>
                  {group.map((r) => (
                    <div key={r.node.thread.id}>
                      <button
                        type="button"
                        className="session-subagent-task"
                        data-subagent-id={r.node.thread.id}
                        key={r.node.thread.id}
                        onClick={() => select(r.node.thread.id)}
                      >
                        <strong>
                          {r.node.parentId !== root ? "↳ " : ""}
                          {name(r)}
                        </strong>
                        <span>
                          {CHILD_LABELS[r.state]}
                          {r.pending ? ` · ${r.pending}` : ""}
                        </span>
                        <small>
                          {r.node.thread.agentRole ?? "角色未知"}
                          {!r.current && " · 其他或未记录轮次"}
                        </small>
                        <p>
                          {r.node.objective ??
                            r.node.thread.preview ??
                            "任务摘要未记录"}
                        </p>
                        <small>
                          {elapsed(r.node.thread.id)} ·{" "}
                          {r.node.thread.model ?? "模型未记录"}
                        </small>
                        <small>
                          {r.node.thread.updatedAt
                            ? new Date(
                                r.node.thread.updatedAt * 1000,
                              ).toLocaleString()
                            : "更新时间未知"}
                        </small>
                      </button>
                      {data.rows.some(
                        (child) => child.node.parentId === r.node.thread.id,
                      ) && (
                        <button
                          type="button"
                          aria-expanded={!collapsed.has(r.node.thread.id)}
                          aria-label={`${collapsed.has(r.node.thread.id) ? "展开" : "收起"} ${name(r)} 的后代`}
                          onClick={() =>
                            setCollapsed((previous) => {
                              const next = new Set(previous);
                              if (next.has(r.node.thread.id))
                                next.delete(r.node.thread.id);
                              else next.add(r.node.thread.id);
                              return next;
                            })
                          }
                        >
                          {collapsed.has(r.node.thread.id)
                            ? "展开后代"
                            : "收起后代"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
            {rows.length > limit && (
              <button type="button" onClick={() => setLimit(limit + 30)}>
                显示更多
              </button>
            )}
          </div>
          <footer>
            <button
              type="button"
              disabled={!selectStopTargets(data.rows, history).length}
              onClick={() => stopScope()}
            >
              {history ? "停止全部历史中的运行子任务…" : "停止本轮运行子任务…"}
            </button>
          </footer>
        </>
      )}
      <div className="session-subagent-results">
        {(data.stopResults[root] ?? []).map((result) => {
          const target = data.rows.find(
            (r) => r.node.thread.id === result.threadId,
          );
          const confirmed =
            result.phase === "requested" &&
            ((timings[result.threadId]?.turnId === result.turnId &&
              timings[result.threadId]?.status === "interrupted") ||
              target?.node.thread.turns?.some(
                (t) => t.id === result.turnId && t.status === "interrupted",
              ));
          const outcome = {
            requested: "停止已请求，等待原轮终态确认",
            confirmed: "已确认停止",
            superseded: "原轮已结束或已换轮，未发送停止",
            failed: "停止请求失败",
            uncertain: "停止回执待确认",
          }[result.phase];
          return (
            <p
              key={result.threadId}
              role="status"
              className="session-subagent-stop-result"
            >
              {target ? name(target) : result.threadId.slice(0, 8)} ·{" "}
              {confirmed ? "已确认停止" : outcome}
              {result.message && ` · ${result.message}`}
            </p>
          );
        })}
      </div>
      <dialog
        ref={dialogRef}
        className="session-subagent-confirm"
        onCancel={(e) => {
          if (stopping) e.preventDefault();
          else setTargets(null);
        }}
      >
        <h3>停止这些子任务的当前执行？</h3>
        <ul>
          {targets?.map((t) => (
            <li key={t.threadId}>
              {data.rows.find((r) => r.node.thread.id === t.threadId)?.node
                .thread.agentNickname ?? t.threadId}{" "}
              · {t.turnId.slice(0, 8)}
            </li>
          ))}
        </ul>
        <p>仅包含列出的任务；主 Agent 和其他会话继续运行。</p>
        <button
          type="button"
          disabled={stopping}
          onClick={() => setTargets(null)}
        >
          取消
        </button>
        <button
          type="button"
          disabled={stopping}
          onClick={() => void confirmStop()}
        >
          {stopping ? "正在请求停止…" : "确认停止"}
        </button>
      </dialog>
    </section>
  );
}
