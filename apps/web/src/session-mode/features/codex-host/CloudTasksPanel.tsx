import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuid } from "uuid";
import { Cloud, LoaderCircle, RotateCw } from "lucide-react";
import { composeContextText } from "@agent-orchestrator/shared";
import type {
  CodexCloudCapability,
  CodexCloudEnvironment,
  CodexCloudSnapshot,
  CodexHostOwner,
} from "@agent-orchestrator/shared";
import { Button } from "@session/components/ui/button";
import { readDraft } from "@session/stores/useSessionDraftStore";
import { composerDrafts } from "@session/components/codex/composer/v2/drafts";
import { authHeaders } from "@session/hooks/runtime";
type Draft = {
  prompt: string;
  environmentId: string;
  taskId: string;
  turnId: string;
  localDelegation: boolean;
  requestId: string;
};
type Runtime = {
  capability?: CodexCloudCapability;
  environments: CodexCloudEnvironment[];
  snapshot?: CodexCloudSnapshot;
  tasks: any[];
  result?: unknown;
  error: string | null;
  busy: boolean;
};
const emptyRuntime: Runtime = {
  environments: [],
  tasks: [],
  error: null,
  busy: false,
};
const drafts = create<{
  sessions: Partial<Record<string, Draft>>;
  change: (key: string, update: Partial<Draft>) => void;
}>()(
  persist(
    (set, get) => ({
      sessions: {},
      change: (key, update) =>
        set({
          sessions: {
            ...get().sessions,
            [key]: {
              prompt: "",
              environmentId: "",
              taskId: "",
              turnId: "",
              localDelegation: false,
              requestId: uuid(),
              ...get().sessions[key],
              ...update,
            },
          },
        }),
    }),
    { name: "kanban.session.codex-cloud-drafts" },
  ),
);
const runtime = create<{ sessions: Record<string, Runtime> }>(() => ({
  sessions: {},
}));
const update = (key: string, change: Partial<Runtime>) =>
  runtime.setState((state) => ({
    sessions: {
      ...state.sessions,
      [key]: { ...(state.sessions[key] ?? emptyRuntime), ...change },
    },
  }));
async function api<T>(
  path: string,
  owner?: CodexHostOwner,
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api/session/codex-cloud/" + path, {
    headers: {
      ...authHeaders(),
      ...(owner ? { "content-type": "application/json" } : {}),
    },
    ...(owner
      ? { method: "POST", body: JSON.stringify({ owner, ...(body as object) }) }
      : {}),
    signal: AbortSignal.timeout(path === "upload" ? 150_000 : 40_000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.message ?? result.error ?? "云任务请求失败");
  return result;
}
/** Server credentials never enter this component, its device draft, or URLs. */
export function CloudTasksPanel({ owner }: { owner: CodexHostOwner }) {
  // A late canonical directory alias must not move a device draft to a new key.
  const key = JSON.stringify([owner.draftOwner, owner.agentId ?? ""]),
    draft = drafts((state) => state.sessions[key]);
  const state = runtime((s) => s.sessions[key] ?? emptyRuntime);
  const change = (value: Partial<Draft>) =>
    drafts.getState().change(key, { ...value, requestId: uuid() });
  useEffect(() => {
    if (!drafts.getState().sessions[key])
      drafts
        .getState()
        .change(key, { prompt: readDraft(owner.draftOwner).text });
    const captured = key;
    void api<CodexCloudCapability>("capability")
      .then((capability) => update(captured, { capability }))
      .catch((error) => update(captured, { error: String(error) }));
  }, [key]);
  async function run(
    action: (captured: CodexHostOwner, capturedKey: string) => Promise<void>,
  ) {
    const captured = { ...owner },
      capturedKey = key;
    if (runtime.getState().sessions[capturedKey]?.busy) return;
    update(capturedKey, { busy: true, error: null });
    try {
      await action(captured, capturedKey);
    } catch (error) {
      update(capturedKey, { error: String(error) });
      void api<CodexCloudCapability>("capability")
        .then((capability) => update(capturedKey, { capability }))
        .catch(() => {});
    } finally {
      update(capturedKey, { busy: false });
    }
  }
  const capability = state.capability,
    available = !!capability?.available,
    disabled = state.busy || !available;
  const selectedTask = state.tasks.find(
    (item) => (item.id ?? item.task?.id) === draft?.taskId,
  );
  const taskLabel = (item: any) =>
    `${item.title ?? item.task?.title ?? item.id ?? item.task?.id} · ${item.status ?? item.task?.status ?? "未知状态"}`;
  const turns = (state.result as any)?.turns;
  const turnRows: any[] = Array.isArray(turns)
    ? turns
    : (turns?.items ?? turns?.turns ?? []);
  async function createTask() {
    const capturedDraft = draft ?? drafts.getState().sessions[key];
    if (!capturedDraft || !capability?.identity) return;
    const prompt = composeContextText(
      capturedDraft.prompt,
      composerDrafts.read(owner.draftOwner).contexts,
    );
    const destination = capturedDraft.taskId
      ? `续聊任务 ${capturedDraft.taskId}，轮次 ${capturedDraft.turnId}`
      : capturedDraft.environmentId
        ? `环境 ${capturedDraft.environmentId}`
        : `已校验快照 ${state.snapshot?.filename ?? "尚未准备"}`;
    if (
      !window.confirm(
        `确认将以下内容发送到 ChatGPT 云任务？\n${destination}\n项目：${owner.cwd}\n${capturedDraft.localDelegation ? "包含本会话公开历史\n" : ""}\n${prompt.slice(0, 1200)}${prompt.length > 1200 ? "\n…" : ""}`,
      )
    )
      return;
    await run(async (captured, capturedKey) => {
      const result = await api<any>("create", captured, {
        requestId: capturedDraft.requestId,
        identity: capability.identity,
        prompt,
        ...(capturedDraft.taskId
          ? { taskId: capturedDraft.taskId, turnId: capturedDraft.turnId }
          : capturedDraft.environmentId
            ? { environmentId: capturedDraft.environmentId }
            : { snapshotId: state.snapshot?.id }),
        ...(capturedDraft.localDelegation ? { localDelegation: true } : {}),
      });
      update(capturedKey, { result });
      const taskId = result.task?.id ?? result.id;
      if (typeof taskId === "string")
        drafts
          .getState()
          .change(capturedKey, {
            taskId,
            turnId: result.turn?.id ?? result.task?.latest_turn?.id ?? "",
          });
    });
  }
  return (
    <section className="space-y-3 text-sm" aria-label="Codex 云任务">
      <div className="flex items-center gap-2">
        <Cloud className="size-4" />
        <strong>Codex 云任务</strong>
        {state.busy && <LoaderCircle className="size-4 animate-spin" />}
      </div>
      <p className="text-xs text-muted-foreground">
        {capability?.reason ??
          (available
            ? `ChatGPT 账号已连接${capability?.plan ? ` · ${capability.plan}` : ""}；刷新环境和任务以核验网络与当前账号权限。`
            : "正在读取账号能力…")}
      </p>
      {capability?.recovery && (
        <p className="text-xs text-muted-foreground">{capability.recovery}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={state.busy}
          onClick={() =>
            void run(async (_captured, capturedKey) =>
              update(capturedKey, {
                capability: await api<CodexCloudCapability>("capability"),
              }),
            )
          }
        >
          <RotateCw className="size-3.5" />
          刷新账号
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() =>
            void run(async (captured, capturedKey) =>
              update(capturedKey, {
                environments: await api<CodexCloudEnvironment[]>(
                  "environments",
                  captured,
                  { identity: capability?.identity },
                ),
              }),
            )
          }
        >
          刷新环境
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() =>
            void run(async (captured, capturedKey) => {
              const value: any = await api("tasks", captured, {
                identity: capability?.identity,
              });
              update(capturedKey, {
                tasks: Array.isArray(value)
                  ? value
                  : (value.items ?? value.tasks ?? []),
              });
            })
          }
        >
          查看云任务
        </Button>
      </div>
      <label className="block space-y-1">
        <span>执行环境</span>
        <select
          className="w-full rounded border bg-background p-2"
          aria-label="执行环境"
          value={draft?.environmentId ?? ""}
          onChange={(event) =>
            change({
              environmentId: event.target.value,
              taskId: "",
              turnId: "",
            })
          }
        >
          <option value="">当前工作区快照</option>
          {state.environments.map((environment) => (
            <option key={environment.id} value={environment.id}>
              {environment.name}
            </option>
          ))}
        </select>
      </label>
      {!draft?.environmentId && !draft?.taskId && (
        <div className="space-y-2 rounded border p-2">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={state.busy}
              onClick={() =>
                void run(async (captured, capturedKey) =>
                  update(capturedKey, {
                    snapshot: await api<CodexCloudSnapshot>(
                      "prepare",
                      captured,
                    ),
                  }),
                )
              }
            >
              准备工作区快照
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={
                disabled ||
                capability?.snapshotAvailable === false ||
                !state.snapshot ||
                state.snapshot.state === "verified"
              }
              onClick={() => {
                if (
                  window.confirm(
                    `确认上传 ${state.snapshot?.files.length} 个文件、${state.snapshot?.bytes} 字节到云端？请先核对下方文件清单。`,
                  )
                )
                  void run(async (captured, capturedKey) =>
                    update(capturedKey, {
                      snapshot: await api<CodexCloudSnapshot>(
                        "upload",
                        captured,
                        {
                          snapshotId: state.snapshot?.id,
                          identity: capability?.identity,
                        },
                      ),
                    }),
                  );
              }}
            >
              上传并校验快照
            </Button>
          </div>
          {capability?.snapshotReason && (
            <p className="text-xs text-destructive">
              {capability.snapshotReason}
            </p>
          )}
          {state.snapshot && (
            <>
              <p className="text-xs">
                {state.snapshot.filename} · {state.snapshot.bytes} 字节 ·{" "}
                {state.snapshot.state === "verified"
                  ? "云端已校验"
                  : state.snapshot.state === "failed"
                    ? "上传或校验失败"
                    : "等待上传校验"}
              </p>
              <details>
                <summary>
                  {state.snapshot.files.length} 个文件 · 查看上传范围
                </summary>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">
                  {state.snapshot.files.join("\n")}
                </pre>
              </details>
            </>
          )}
        </div>
      )}
      <label className="block space-y-1">
        <span>云任务消息</span>
        <textarea
          className="min-h-28 w-full rounded border bg-background p-2"
          aria-label="云任务消息"
          value={draft?.prompt ?? ""}
          onChange={(event) => change({ prompt: event.target.value })}
        />
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={draft?.localDelegation ?? false}
          disabled={!owner.threadId || !!draft?.taskId}
          onChange={(event) =>
            change({ localDelegation: event.target.checked })
          }
        />
        同时委派本会话公开历史
      </label>
      {state.tasks.length > 0 && (
        <label className="block space-y-1">
          <span>现有云任务</span>
          <select
            aria-label="现有云任务"
            className="w-full rounded border bg-background p-2"
            value={draft?.taskId ?? ""}
            onChange={(event) =>
              change({ taskId: event.target.value, turnId: "" })
            }
          >
            <option value="">创建新任务</option>
            {state.tasks.map((task) => (
              <option
                key={task.id ?? task.task?.id}
                value={task.id ?? task.task?.id}
              >
                {taskLabel(task)}
              </option>
            ))}
          </select>
        </label>
      )}
      {draft?.taskId && (
        <div className="space-y-2">
          <p className="text-xs">
            {selectedTask ? taskLabel(selectedTask) : `任务 ${draft.taskId}`}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              void run(async (captured, capturedKey) =>
                update(capturedKey, {
                  result: await api("result", captured, {
                    taskId: draft.taskId,
                    ...(draft.turnId ? { turnId: draft.turnId } : {}),
                    identity: capability?.identity,
                  }),
                }),
              )
            }
          >
            读取真实结果与轮次
          </Button>
          <select
            aria-label="云端轮次"
            className="w-full rounded border bg-background p-2"
            value={draft.turnId}
            onChange={(event) => change({ turnId: event.target.value })}
          >
            <option value="">选择云端轮次后续聊</option>
            {turnRows.map((turn) => (
              <option
                key={turn.id ?? turn.turn_id}
                value={turn.id ?? turn.turn_id}
              >
                {turn.id ?? turn.turn_id} · {turn.status ?? "未知状态"}
              </option>
            ))}
          </select>
        </div>
      )}
      <Button
        size="sm"
        disabled={
          disabled ||
          !draft?.prompt.trim() ||
          (draft.taskId
            ? !draft.turnId
            : !draft.environmentId && state.snapshot?.state !== "verified")
        }
        onClick={() => void createTask()}
      >
        {draft?.taskId ? "续聊云任务" : "创建云任务"}
      </Button>
      {state.error && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
      {state.result !== undefined && (
        <details open>
          <summary>云端返回的真实任务结果</summary>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border p-2 text-xs">
            {JSON.stringify(state.result, null, 2)}
          </pre>
        </details>
      )}
    </section>
  );
}
