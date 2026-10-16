import { createSideChat } from "@session/services/conversationActions";
import initPrompt from "@session/prompts/init.md?raw";
import { codexService } from "@session/services/codexService";
import { useConfigStore } from "../stores";
import {
  changeThreadModel,
  getThreadModelSettings,
} from "@session/stores/useThreadModelStore";
import { archiveThread, renameThread } from "@session/services/apiAdapt";
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
  | "ide"
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
    description: "选择模型，保留已排队消息的原配置",
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
    run: async ({ ensureThread }) => {
      await codexService.turnStart(await ensureThread(), initPrompt);
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
    id: "ide",
    title: "IDE 上下文",
    description: "包含当前选择、打开的文件以及其他来自你的 IDE 的上下文",
    run: ({ openDialog }) => openDialog("ide"),
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

export async function forkSlashLocal(threadId: string) {
  const forked = await codexService.threadFork(threadId);
  useAgentCenterStore.getState().addAgentCard(
    {
      kind: "codex",
      id: forked.id,
      cwd: forked.cwd,
      preview: forked.name || "会话分支",
    },
    { activate: true },
  );
  useCodexStore.getState().setCurrentThreadId(forked.id);
  return forked.id;
}

export async function forkSlashWorktree(threadId: string) {
  const cwd = useWorkspaceStore.getState().cwd;
  if (!cwd) throw new Error("先选择项目，再创建工作树分支。");
  const key = `slash-${threadId.slice(0, 8)}-${Date.now().toString(36)}`;
  const worktree = await gitCreateWorktree(cwd, key);
  const forked = await codexService.threadFork(threadId);
  useWorkspaceStore.getState().setCwd(worktree.worktree_path);
  useAgentCenterStore.getState().addAgentCard(
    {
      kind: "codex",
      id: forked.id,
      cwd: worktree.worktree_path,
      worktreePath: worktree.worktree_path,
      preview: forked.name || "工作树分支",
    },
    { activate: true },
  );
  useCodexStore.getState().setCurrentThreadId(forked.id);
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
