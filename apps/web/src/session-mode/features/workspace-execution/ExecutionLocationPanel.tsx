import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@session/components/ui/dialog";
import { Button } from "@session/components/ui/button";
import { useConfigStore } from "@session/components/codex/stores/useConfigStore";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { gitListBranches } from "@session/services/apiAdapt/git";
import { listThreads, threadMetadata } from "@session/services/apiAdapt/codex";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import {
  captureCodexOperationScope,
  isCodexOperationScopeCurrent,
} from "@session/services/codexOperationScope";
import {
  listLocalEnvironments,
  saveLocalEnvironments,
  type LocalEnvironments,
  type LocalEnvironment,
} from "./api";
import {
  defaultExecutionSelection,
  executionSelection,
  listExecutions,
  saveExecutionSelection,
  updateExecution,
  readExecutionContext,
  verifyExecutionContext,
  type ExecutionRecord,
} from "./state";
import { inspectPreparedExecution, settlePreparedExecution } from "./recovery";
import { subscribeGoalCompletionScopeReset } from "@session/services/goalCompletionAutoClear";
import { authHeaders, buildUrl } from "@session/hooks/runtime";
import { usePairingStore } from "@session/stores/usePairingStore";
import { newSessionEditId } from "@session/services/sessionEditIdentity";
export function ExecutionLocationPanel({
  root,
  owner,
  onClose,
}: {
  root: string;
  owner: string;
  onClose: () => void;
}) {
  const [initial] = useState(() => {
      try {
        return {
          selection: executionSelection(root),
          error: null as string | null,
        };
      } catch (reason) {
        return {
          selection: defaultExecutionSelection(),
          error: reason instanceof Error ? reason.message : String(reason),
        };
      }
    }),
    [selection, setSelection] = useState(initial.selection),
    [corrupt, setCorrupt] = useState(!!initial.error),
    [mode, setMode] = useState(() => useConfigStore.getState().threadCwdMode);
  const [data, setData] = useState<LocalEnvironments | null>(null),
    [branches, setBranches] = useState<string[]>([]),
    [error, setError] = useState<string | null>(initial.error),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState(false),
    [configuration, setConfiguration] = useState<LocalEnvironment[]>([]),
    [records, setRecords] = useState<ExecutionRecord[]>([]),
    [matches, setMatches] = useState<
      Record<string, Array<{ id: string; cwd: string; preview: string }>>
    >({}),
    [prepared, setPrepared] = useState<Record<string, string>>({});
  const domain = useRef<string | null>(null);
  const current = useRef({ root, owner });
  current.current = { root, owner };
  const close = useRef(onClose);
  close.current = onClose;
  const connection = () =>
    JSON.stringify([
      buildUrl("/workspace-files/environment-list"),
      authHeaders(),
    ]);
  const abort = useRef(new AbortController());
  useEffect(() => () => abort.current.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    domain.current = null;
    const stamp = connection();
    let revoked = false;
    const invalidate = () => {
      if (revoked) return;
      revoked = true;
      controller.abort();
      close.current();
    };
    const account = subscribeGoalCompletionScopeReset(invalidate);
    const pairing = usePairingStore.subscribe(() => {
      if (stamp !== connection()) invalidate();
    });
    window.addEventListener("session-runtime-restarted", invalidate);
    void listLocalEnvironments(root, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setData(value);
          setConfiguration(value.environments);
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(String(reason.message ?? reason));
      });
    void gitListBranches(root)
      .then((value) => {
        if (!controller.signal.aborted) setBranches(value.branches);
      })
      .catch(() => {});
    const refresh = () => {
      if (controller.signal.aborted || !domain.current) return;
      try {
        setRecords(listExecutions(domain.current, root));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    void readExecutionContext()
      .then((value) => {
        if (!controller.signal.aborted) {
          domain.current = value.domain;
          refresh();
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
    window.addEventListener("session-execution-changed", refresh);
    return () => {
      controller.abort();
      account();
      pairing();
      window.removeEventListener("session-runtime-restarted", invalidate);
      window.removeEventListener("session-execution-changed", refresh);
    };
  }, [root, owner]);
  async function saveConfig() {
    const controller = abort.current;
    if (!data || busy || controller.signal.aborted) return;
    setError(null);
    setBusy(true);
    try {
      const value = await saveLocalEnvironments(
        root,
        data.version,
        configuration,
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        current.current.root !== root ||
        current.current.owner !== owner
      )
        return;
      setData(value);
      setEdit(false);
      setSelection((value) => ({ ...value, runSetup: false }));
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function reconcile(record: ExecutionRecord) {
    const controller = abort.current;
    if (controller.signal.aborted) return;
    setBusy(true);
    setError(null);
    const scope = captureCodexOperationScope();
    try {
      const native = await readExecutionContext();
      controller.signal.throwIfAborted();
      if (native.domain !== record.scope)
        throw new Error("原创建记录属于另一账号或服务，请切回原连接核对。");
      const response = await listThreads({
        cwd: record.cwd ?? record.root,
        limit: 50,
        sortKey: "created_at",
        sortDirection: "desc",
      });
      await verifyExecutionContext(native);
      controller.signal.throwIfAborted();
      if (
        !isCodexOperationScopeCurrent(scope) ||
        current.current.root !== root ||
        current.current.owner !== owner
      )
        return;
      setMatches((value) => ({
        ...value,
        [record.id]: response.data
          .filter(
            (thread) =>
              thread.cwd === (record.cwd ?? record.root) &&
              thread.createdAt * 1000 >= record.createdAt - 5000,
          )
          .map((thread) => ({
            id: thread.id,
            cwd: thread.cwd,
            preview: thread.preview,
          })),
      }));
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function selectResult(record: ExecutionRecord, id: string) {
    const controller = abort.current;
    if (controller.signal.aborted) return;
    setBusy(true);
    const scope = captureCodexOperationScope();
    try {
      const native = await readExecutionContext();
      controller.signal.throwIfAborted();
      if (native.domain !== record.scope)
        throw new Error("原创建记录属于另一账号或服务。");
      const response = await threadMetadata(id);
      await verifyExecutionContext(native);
      controller.signal.throwIfAborted();
      if (
        !isCodexOperationScopeCurrent(scope) ||
        current.current.root !== root ||
        current.current.owner !== owner
      )
        throw new Error("连接或输入目标已变化，请重新核对。");
      if (response.thread.cwd !== (record.cwd ?? record.root))
        throw new Error("原生目录与待核对目录不一致。");
      const fresh = listExecutions(record.scope, record.root).find(
        (value) => value.id === record.id,
      );
      if (
        !fresh ||
        fresh.phase !== record.phase ||
        fresh.stage !== record.stage ||
        fresh.cwd !== record.cwd ||
        fresh.threadId !== record.threadId
      )
        throw new Error("创建记录已在另一个页面变化，请重新核对。");
      updateExecution(record.id, {
        phase: "completed",
        threadId: id,
        cwd: response.thread.cwd,
      });
      useAgentCenterStore.getState().addAgentCard(
        {
          kind: "codex",
          id,
          cwd: response.thread.cwd,
          preview: response.thread.preview || "已核对会话",
        },
        { activate: false },
      );
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function inspectPreparation(record: ExecutionRecord, finish = false) {
    const controller = abort.current;
    if (controller.signal.aborted) return;
    setBusy(true);
    setError(null);
    const scope = captureCodexOperationScope();
    const valid = () => {
      controller.signal.throwIfAborted();
      if (
        !isCodexOperationScopeCurrent(scope) ||
        current.current.root !== root ||
        current.current.owner !== owner
      )
        throw new Error("连接或输入目标已变化，请重新核对。");
    };
    try {
      if (finish) {
        await settlePreparedExecution(record, controller.signal, valid);
        setPrepared((values) => {
          const next = { ...values };
          delete next[record.id];
          return next;
        });
      } else {
        const proof = await inspectPreparedExecution(record, controller.signal);
        valid();
        setPrepared((values) => ({
          ...values,
          [record.id]: proof.description,
        }));
      }
    } catch (reason) {
      if (!controller.signal.aborted && isCodexOperationScopeCurrent(scope))
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const selected = data?.environments.find(
      (value) => value.id === selection.environmentId,
    ),
    existing = !!useCodexStore((state) => state.currentThreadId);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>本地工作环境</DialogTitle>
          <DialogDescription>
            这些设置用于新会话。已有会话继续使用原工作目录和权限；准备命令只在你确认后执行。
          </DialogDescription>
        </DialogHeader>
        <p className="break-all text-xs text-muted-foreground">{root}</p>
        <label className="grid gap-1 text-sm">
          执行位置
          <select
            aria-label="新会话执行位置"
            value={mode}
            onChange={(event) =>
              setMode(event.target.value as "local" | "worktree")
            }
            className="rounded-md border bg-background p-2"
          >
            <option value="local">当前项目目录</option>
            <option value="worktree">独立工作树</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          基础分支
          <select
            aria-label="工作树基础分支"
            disabled={mode !== "worktree"}
            value={selection.baseBranch}
            onChange={(event) =>
              setSelection((value) => ({
                ...value,
                baseBranch: event.target.value,
              }))
            }
            className="rounded-md border bg-background p-2"
          >
            <option value="">当前 HEAD</option>
            {branches.map((branch) => (
              <option key={branch}>{branch}</option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          分支选择只决定新工作树的起点，不检出或改变原项目分支。
        </p>
        <label className="grid gap-1 text-sm">
          设置环境
          <select
            aria-label="本地设置环境"
            value={selection.environmentId}
            onChange={(event) =>
              setSelection((value) => ({
                ...value,
                environmentId: event.target.value,
                environmentVersion: data?.version ?? "",
                runSetup: false,
              }))
            }
            className="rounded-md border bg-background p-2"
          >
            <option value="">不执行设置命令</option>
            {data?.environments.map((value) => (
              <option key={value.id} value={value.id}>
                {value.name}
              </option>
            ))}
          </select>
        </label>
        {selection.environmentId && !selected && (
          <p role="alert" className="text-sm text-destructive">
            已选择的环境不可用；不会自动替换。
          </p>
        )}
        {selected && (
          <div className="space-y-2 rounded-md border p-3 text-sm">
            <p>新会话将在所选目录执行：</p>
            <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
              {[selected.command.program, ...selected.command.args]
                .map((arg) => JSON.stringify(arg))
                .join(" ")}
            </pre>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={
                  selection.runSetup &&
                  selection.environmentVersion === data?.version
                }
                onChange={(event) =>
                  setSelection((value) => ({
                    ...value,
                    runSetup: event.target.checked,
                    environmentVersion: data?.version ?? "",
                  }))
                }
              />
              我确认创建新会话时执行以上命令
            </label>
          </div>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => setEdit((value) => !value)}
        >
          配置项目设置命令
        </Button>
        {edit && (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-xs text-muted-foreground">
              每个项目可保存多个设置环境。程序和参数分别传入；保存不会执行命令。
            </p>
            {configuration.map((environment, index) => (
              <div key={index} className="space-y-2 rounded-md bg-muted/40 p-2">
                <label className="grid gap-1 text-xs">
                  环境名称
                  <input
                    aria-label={`环境 ${index + 1} 名称`}
                    value={environment.name}
                    onChange={(event) =>
                      setConfiguration((values) =>
                        values.map((value, i) =>
                          i === index
                            ? { ...value, name: event.target.value }
                            : value,
                        ),
                      )
                    }
                    className="rounded border bg-background p-2"
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  程序或脚本解释器
                  <input
                    aria-label={`环境 ${index + 1} 程序`}
                    value={environment.command.program}
                    placeholder="例如 node 或 /usr/bin/python3"
                    onChange={(event) =>
                      setConfiguration((values) =>
                        values.map((value, i) =>
                          i === index
                            ? {
                                ...value,
                                command: {
                                  ...value.command,
                                  program: event.target.value,
                                },
                              }
                            : value,
                        ),
                      )
                    }
                    className="rounded border bg-background p-2 font-mono"
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  参数（每行一个）
                  <textarea
                    aria-label={`环境 ${index + 1} 参数`}
                    value={environment.command.args.join("\n")}
                    onChange={(event) =>
                      setConfiguration((values) =>
                        values.map((value, i) =>
                          i === index
                            ? {
                                ...value,
                                command: {
                                  ...value.command,
                                  args: event.target.value
                                    ? event.target.value.split("\n")
                                    : [],
                                },
                              }
                            : value,
                        ),
                      )
                    }
                    className="h-20 rounded border bg-background p-2 font-mono"
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setConfiguration((values) =>
                      values.filter((_, i) => i !== index),
                    )
                  }
                >
                  移除此环境
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={configuration.length >= 20}
                onClick={() =>
                  setConfiguration((values) => [
                    ...values,
                    {
                      id: `env-${newSessionEditId()}`,
                      name: "新设置环境",
                      command: { program: "", args: [] },
                    },
                  ])
                }
              >
                添加设置环境
              </Button>
              <Button
                type="button"
                disabled={!data || busy}
                onClick={() => void saveConfig()}
              >
                保存环境配置
              </Button>
            </div>
          </div>
        )}
        {records
          .filter((record) => !["completed", "failed"].includes(record.phase))
          .map((record) => (
            <div
              key={record.id}
              className="space-y-2 rounded-md border border-amber-500/40 p-3 text-sm"
            >
              <p>创建结果待核对</p>
              <p className="break-all text-xs">{record.cwd ?? record.root}</p>
              <p className="text-xs text-muted-foreground">
                {record.error ??
                  "操作仍在进行或回执未确认；不会重复创建工作树或会话。"}
              </p>
              <p className="text-xs text-muted-foreground">
                最后阶段：{record.stage ?? "旧记录，阶段待核对"}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void reconcile(record)}
              >
                核对创建结果
              </Button>
              {record.phase === "unknown" &&
                record.stage &&
                record.stage !== "native" &&
                record.preparation && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void inspectPreparation(record)}
                  >
                    只读核对准备结果
                  </Button>
                )}
              {prepared[record.id] && (
                <div className="space-y-2">
                  <p>{prepared[record.id]} 本次尚未调用原生创建会话。</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void inspectPreparation(record, true)}
                  >
                    结束本次创建记录，保留目录与设置结果
                  </Button>
                </div>
              )}
              {matches[record.id]?.map((thread) => (
                <Button
                  type="button"
                  key={thread.id}
                  variant="outline"
                  className="block h-auto max-w-full whitespace-normal break-all text-left text-xs"
                  disabled={busy}
                  onClick={() => void selectResult(record, thread.id)}
                >
                  确认这是创建结果：{thread.preview || thread.id}
                </Button>
              ))}
              {matches[record.id]?.length === 0 && (
                <p>
                  未找到匹配会话。请先核对原运行服务和工作树，不能据此自动重建。
                </p>
              )}
            </div>
          ))}
        {corrupt && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (abort.current.signal.aborted) return;
              saveExecutionSelection(root, defaultExecutionSelection());
              setSelection(defaultExecutionSelection());
              setCorrupt(false);
              setError(null);
            }}
          >
            重设损坏的新会话设置
          </Button>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          type="button"
          disabled={
            busy ||
            corrupt ||
            (!data && !!selection.environmentId) ||
            (!!selection.environmentId && (!selected || !selection.runSetup))
          }
          onClick={() => {
            if (abort.current.signal.aborted) return;
            saveExecutionSelection(root, selection);
            useConfigStore.getState().setThreadCwdMode(mode);
            onClose();
          }}
        >
          保存新会话设置
        </Button>
        {existing && (
          <p className="text-xs text-muted-foreground">
            当前已打开的会话不会切换工作目录。
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
