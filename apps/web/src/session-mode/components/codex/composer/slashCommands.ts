import { beginExecution, executionIntentId, executionScope, executionSelection, updateExecution, readExecutionContext, verifyExecutionContext } from "@session/features/workspace-execution/state";
import { runLocalEnvironment } from "@session/features/workspace-execution/api";
import { createSideChat } from "@session/services/conversationActions";
import initPrompt from "@session/prompts/init.md?raw";
import { codexService } from "@session/services/codexService";
import { useConfigStore } from "../stores";
import {
  changeThreadModel,
  getThreadModelSettings,
} from "@session/stores/useThreadModelStore";
import { archiveThread, renameThread } from "@session/services/apiAdapt/codex";
import { listMcpServerStatus } from "@session/services/apiAdapt/mcp";
import { gitCreateWorktree } from "@session/services/apiAdapt/git";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { usePinStore } from "@session/stores/usePinStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useCodexStore } from "../stores/useCodexStore";
import { goalDrafts } from "./goalDrafts";
import { sessionDraftKey } from "@session/stores/useSessionDraftStore";
import { postJson } from "@session/services/apiAdapt/shared";
import type { FeedbackUploadParams } from "@session/bindings/v2/FeedbackUploadParams";
import { captureCodexOperationScope, isCodexOperationScopeCurrent } from "@session/services/codexOperationScope";
import { listProjectReferences } from "@session/features/files/projectReferences";
import { readWithDeadline } from "@session/services/sessionReadQueue";
import { lightweightThreadForStore } from "@session/services/codexTranscriptVisibility";
import { useSessionNameStore } from "@session/stores/useSessionNameStore";

/** What a slash command can do once the composer text has been cleared. */
export interface SlashCommandContext {
  /** Thread the command runs against, started on demand. */
  ensureThread: () => Promise<string>;
  /** Current thread, or null when none is open yet. */
  currentThreadId: string | null;
  /** Opens one of the composer's command dialogs. */
  openDialog: (dialog: SlashDialog) => void;
}

export type SlashDialog =
  | "hooks"
  | "memories"
  | "import"
  | "review"
  | "model"
  | "effort"
  | "status"
  | "rename"
  | "fork"
  | "mcp"
  | "personality"
  | "feedback"
  | "auto-review-denials";

export interface SlashCommand {
  id: string;
  /** Plugin catalog title, shown as the row name. */
  title: string;
  description: string;
  confirmation?: string;
  run: (ctx: SlashCommandContext) => Promise<void> | void;
}

/**
 * Commands available in the composer, ordered by expected frequency the way
 * codex-rs orders its own popup (see `tui/src/slash_command.rs`, which notes
 * the enum order is the presentation order). Only commands Codexia can
 * actually carry out are listed.
 */
export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "model",
    title: "模型",
    description: "选择下次发送的模型；原生队列使用线程当前设置",
    run: ({ openDialog }) => openDialog("model"),
  },
  {
    id: "effort",
    title: "推理",
    description: "调整下一次提交的思考强度",
    run: ({ openDialog }) => openDialog("effort"),
  },
  {
    id: "plan",
    title: "计划模式",
    description: "开启计划模式",
    run: ({ currentThreadId }) => {
      const current = currentThreadId
        ? getThreadModelSettings(currentThreadId).collaborationMode
        : useConfigStore.getState().collaborationMode;
      const next = current === "plan" ? "default" : "plan";
      if (currentThreadId)
        changeThreadModel(currentThreadId, { collaborationMode: next });
      else useConfigStore.getState().setCollaborationMode(next);
    },
  },
  {
    id: "status",
    title: "状态",
    description: "显示聊天 ID、上下文用量和速率限制",
    run: ({ openDialog }) => openDialog("status"),
  },
  {
    id: "side",
    title: "侧边",
    description: "发起临时侧边聊天",
    run: async ({ currentThreadId }) => {
      if (currentThreadId) await createSideChat(currentThreadId);
    },
  },
  {
    id: "review",
    title: "审查",
    description: "使用子智能体审查你的更改",
    run: ({ openDialog }) => openDialog("review"),
  },
  {
    id: "autoreview",
    title: "批准",
    description: "批准最近一次自动审查驳回",
    run: ({ openDialog, currentThreadId }) => {
      if (currentThreadId) openDialog("auto-review-denials");
    },
  },
  {
    id: "compact",
    title: "压缩",
    description: "压缩此聊天的上下文",
    confirmation: "将压缩当前会话上下文。此操作不会发送你的草稿。",
    run: async ({ currentThreadId }) => {
      if (!currentThreadId) {
        return;
      }
      await codexService.threadCompact(currentThreadId);
    },
  },
  {
    id: "init",
    title: "初始化",
    description: "创建包含 Codex 指令的 AGENTS.md 文件",
    confirmation:
      "将启动新任务生成 AGENTS.md，可能修改项目文件。当前草稿保持不变。",
    run: async ({ ensureThread, currentThreadId }) => {
      const scope = captureCodexOperationScope();
      const original = useCodexStore.getState().currentThreadId;
      const workspace = useWorkspaceStore.getState().cwd;
      const cwd = currentThreadId ? useCodexStore.getState().threads.find((thread) => thread.id === currentThreadId)?.cwd : workspace;
      if (!cwd) throw new Error("无法确认项目目录，尚未运行初始化。");
      const listing = await readWithDeadline((signal) => listProjectReferences(cwd, cwd, signal), 10_000);
      if (listing.entries.some((entry) => entry.name === "AGENTS.md")) throw new Error("AGENTS.md 已存在，无需重新初始化。");
      if (listing.truncated) throw new Error("项目目录过大，无法确认 AGENTS.md 是否存在，尚未发送任务。");
      if (!isCodexOperationScopeCurrent(scope) || (!currentThreadId && (useCodexStore.getState().currentThreadId !== original || useWorkspaceStore.getState().cwd !== workspace))) throw new Error("项目或运行服务已变化，尚未运行初始化。");
      const threadId = await ensureThread();
      if (!isCodexOperationScopeCurrent(scope)) throw new Error("运行服务已变化，尚未运行初始化。");
      await codexService.turnStart(threadId, initPrompt);
    },
  },
  {
    id: "memories",
    title: "记忆",
    description: "管理记忆的使用与生成方式",
    run: ({ openDialog }) => openDialog("memories"),
  },
  {
    id: "hooks",
    title: "钩子",
    description: "查看与管理生命周期钩子",
    run: ({ openDialog }) => openDialog("hooks"),
  },
  {
    id: "import",
    title: "导入",
    description: "从 Claude Code 导入配置、项目与最近对话",
    run: ({ openDialog }) => openDialog("import"),
  },
  {
    id: "new",
    title: "新聊天",
    description: "在同一工作空间中开启空白聊天",
    run: async () => {
      await codexService.setCurrentThread(null);
    },
  },
  {
    id: "archive",
    title: "归档",
    description: "归档当前聊天",
    confirmation: "将归档当前聊天，并从关注列表移出。Agent 不会被停止。",
    run: async ({ currentThreadId }) => {
      if (!currentThreadId) return;
      await archiveThread(currentThreadId);
      useAgentCenterStore.getState().removeCard({
        kind: "codex",
        id: currentThreadId,
      });
      useCodexStore.setState((state) => ({
        threads: state.threads.filter(
          (thread) => thread.id !== currentThreadId,
        ),
      }));
    },
  },
  {
    id: "rename",
    title: "重命名",
    description: "重命名当前聊天",
    run: ({ openDialog, currentThreadId }) => {
      if (currentThreadId) openDialog("rename");
    },
  },
  {
    id: "fork",
    title: "创建聊天分支",
    description: "在当前工作空间或新工作树中创建此聊天的分支",
    run: ({ openDialog, currentThreadId }) => {
      if (currentThreadId) openDialog("fork");
    },
  },
  {
    id: "goal",
    title: "目标",
    description: "设置要持续追求的目标",
    run: () => {
      const threadId = useCodexStore.getState().currentThreadId;
      const cwd = useWorkspaceStore.getState().cwd;
      if (threadId)
        changeThreadModel(threadId, { collaborationMode: "default" });
      else useConfigStore.getState().setCollaborationMode("default");
      goalDrafts.set(sessionDraftKey("codex", threadId, cwd), true);
    },
  },
  {
    id: "mcp",
    title: "MCP",
    description: "显示 MCP 服务器状态",
    run: ({ openDialog }) => openDialog("mcp"),
  },
  {
    id: "usage",
    title: "用量",
    description: "打开用量和账单设置",
    run: () => useLayoutStore.getState().setView("insights"),
  },
  {
    id: "star",
    title: "置顶聊天",
    description: "将此聊天保留在侧边栏",
    run: ({ currentThreadId }) => {
      if (!currentThreadId) return;
      const cwd = useWorkspaceStore.getState().cwd ?? "";
      const thread = useCodexStore
        .getState()
        .threads.find((item) => item.id === currentThreadId);
      usePinStore.getState().togglePin({
        kind: "codex",
        id: currentThreadId,
        title: thread?.name || thread?.preview || "Codex",
        cwd,
      });
    },
  },
  {
    id: "personality",
    title: "个性",
    description: "切换亲和友善或务实",
    run: ({ openDialog }) => openDialog("personality"),
  },
  {
    id: "feedback",
    title: "反馈",
    description: "发送有关此聊天的反馈",
    run: ({ openDialog }) => openDialog("feedback"),
  },
];

export async function forkSlashLocal(threadId: string, label?: string) {
  const scope = captureCodexOperationScope();
  const selected = useCodexStore.getState().currentThreadId;
  const workspace = useWorkspaceStore.getState().cwd;
  const cwd = useCodexStore.getState().threads.find(thread => thread.id === threadId)?.cwd ?? workspace;
  if (!cwd) throw new Error("无法确认原会话目录，尚未创建分支。");
  const transaction = executionIntentId();
  const executionContext=await readExecutionContext();
  if(!isCodexOperationScopeCurrent(scope))throw new Error("连接或账号已变化，尚未创建分支。");
  beginExecution({ id: transaction, scope: executionContext.domain, root: cwd, kind: "fork", sourceThreadId: threadId });
  let forked: Awaited<ReturnType<typeof codexService.threadFork>>;
  try {
    updateExecution(transaction, { phase: "native", cwd });
    forked = await codexService.threadFork(threadId, { activate: false,expectedScope:executionContext.scopeToken });
    if (!isCodexOperationScopeCurrent(scope)) throw new Error("连接或账号已变化，请核对原连接中的分支，勿重复创建。");
    updateExecution(transaction, { phase: "completed", cwd: forked.cwd, threadId: forked.id });
  } catch (error) {
    updateExecution(transaction, { phase: "unknown", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  const activate = selected === threadId && useCodexStore.getState().currentThreadId === selected && useWorkspaceStore.getState().cwd === workspace;
  const projected = lightweightThreadForStore({ ...forked, turns: forked.turns ?? [], ...(label ? { name: label, preview: label } : {}) });
  if (label) useSessionNameStore.getState().setName("codex", forked.id, label);
  useCodexStore.setState(state => ({ threads: [projected, ...state.threads.filter(thread => thread.id !== forked.id)] }));
  useAgentCenterStore.getState().addAgentCard(
    {
      kind: "codex",
      id: forked.id,
      cwd: forked.cwd,
      preview: label || forked.name || "会话分支",
    },
    { activate },
  );
  if (activate) useCodexStore.getState().setCurrentThreadId(forked.id);
  return forked.id;
}

export async function forkSlashWorktree(threadId: string) {
  const state = useCodexStore.getState();
  const cwd = state.threads.find((thread) => thread.id === threadId)?.cwd ??
    (state.currentThreadId === threadId ? useWorkspaceStore.getState().cwd : null);
  if (!cwd) throw new Error("先选择项目，再创建工作树分支。");
  const scope = captureCodexOperationScope();
  const selectedBefore = state.currentThreadId;
  const workspaceBefore = useWorkspaceStore.getState().cwd;
  const key = executionIntentId(), selection = executionSelection(cwd);
  const executionContext=await readExecutionContext();
  if(!isCodexOperationScopeCurrent(scope))throw new Error("连接或账号已变化，尚未创建工作树。");
  beginExecution({id:key,scope:executionContext.domain,root:cwd,kind:"fork",sourceThreadId:threadId,preparation:{mode:"worktree",environmentId:selection.environmentId,environmentVersion:selection.environmentVersion}});
  let worktree: Awaited<ReturnType<typeof gitCreateWorktree>>;
  let forked: Awaited<ReturnType<typeof codexService.threadFork>>;
  try {
    updateExecution(key,{phase:"worktree"});
    worktree = selection.baseBranch ? await gitCreateWorktree(cwd,key,{baseBranch:selection.baseBranch}) : await gitCreateWorktree(cwd,key);
    updateExecution(key,{cwd:worktree.worktree_path});
    if (!isCodexOperationScopeCurrent(scope)) throw new Error("连接或账号已变化，已创建的工作树保留，请核对原连接后再创建会话。");
    if (selection.environmentId) {
      if (!selection.runSetup) throw new Error("请先在工作环境中确认设置命令。");
      updateExecution(key,{phase:"setup"});
      const setup = await runLocalEnvironment(cwd,{cwd:worktree.worktree_path,id:selection.environmentId,version:selection.environmentVersion,intentId:key,confirmed:true});
      if(setup.status!=="completed") throw new Error("设置命令未成功完成，请核对工作树；不会自动重复执行。");
    }
    if (!isCodexOperationScopeCurrent(scope)) throw new Error("连接或账号已变化，已创建的工作树保留，请先核对原连接。");
    await verifyExecutionContext(executionContext);
    updateExecution(key,{phase:"native"});
    forked = await codexService.threadFork(threadId, { cwd: worktree.worktree_path, activate: false,expectedScope:executionContext.scopeToken });
    updateExecution(key,{phase:"completed",cwd:forked.cwd,threadId:forked.id});
  } catch(error) {
    updateExecution(key,{phase:"unknown",error:error instanceof Error?error.message:String(error)});
    throw error;
  }
  const activate = selectedBefore === threadId &&
    useCodexStore.getState().currentThreadId === selectedBefore &&
    useWorkspaceStore.getState().cwd === workspaceBefore;
  if (activate) useWorkspaceStore.getState().setCwd(forked.cwd);
  useAgentCenterStore.getState().addAgentCard(
    {
      kind: "codex",
      id: forked.id,
      cwd: forked.cwd,
      worktreePath: worktree.worktree_path,
      preview: forked.name || "工作树分支",
    },
    { activate },
  );
  if (activate) useCodexStore.getState().setCurrentThreadId(forked.id);
  return forked.id;
}

export async function submitSlashRename(threadId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  await renameThread(threadId, trimmed);
}

export async function loadMcpStatus(threadId: string | null) {
  const response = await listMcpServerStatus({
    cursor: null,
    limit: 50,
    detail: "toolsAndAuthOnly",
    threadId,
  });
  return response.data.map((server) => ({
    name: server.name,
    auth: server.authStatus,
    tools: Object.keys(server.tools).length,
  }));
}

export async function submitSlashFeedback(
  threadId: string | null,
  text: string,
  selection: { classification: string; includeLogs: boolean },
) {
  const reason = text.trim();
  if (!reason) return;
  const params: FeedbackUploadParams = {
    classification: selection.classification,
    reason,
    threadId,
    includeLogs: selection.includeLogs,
  };
  return postJson("/api/codex/feedback/upload", params);
}

export function slashCommandDescription(
  cmd: SlashCommand,
  collaborationMode?: string | null,
): string {
  if (cmd.id !== "plan") return cmd.description;
  return collaborationMode === "plan" ? "关闭计划模式" : "开启计划模式";
}

export function filterSlashCommands(query: string): SlashCommand[] {
  const needle = query.toLowerCase();
  return SLASH_COMMANDS.filter(
    (cmd) =>
      cmd.id.startsWith(needle) || cmd.title.toLowerCase().includes(needle),
  );
}
