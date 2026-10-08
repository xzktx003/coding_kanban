import { createSideChat } from "@session/services/conversationActions";
import initPrompt from "@session/prompts/init.md?raw";
import { codexService } from "@session/services/codexService";
import { useConfigStore } from "../stores";

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
  | "effort";

export interface SlashCommand {
  id: string;
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
    description: "选择模型，保留已排队消息的原配置",
    run: ({ openDialog }) => openDialog("model"),
  },
  {
    id: "effort",
    description: "调整下一次提交的思考强度",
    run: ({ openDialog }) => openDialog("effort"),
  },
  {
    id: "plan",
    description: "切换规划模式，不发送当前草稿",
    run: () => {
      const s = useConfigStore.getState();
      s.setCollaborationMode(
        s.collaborationMode === "plan" ? "default" : "plan",
      );
    },
  },
  {
    id: "side",
    description: "打开独立侧边聊天，保留主任务",
    run: async ({ currentThreadId }) => {
      if (currentThreadId) await createSideChat(currentThreadId);
    },
  },
  {
    id: "review",
    description: "Review my current changes and find issues",
    run: ({ openDialog }) => openDialog("review"),
  },
  {
    id: "compact",
    description: "压缩当前会话上下文，保留未发送草稿",
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
    description: "让 Codex 为项目生成 AGENTS.md",
    confirmation:
      "将启动新任务生成 AGENTS.md，可能修改项目文件。当前草稿保持不变。",
    run: async ({ ensureThread }) => {
      await codexService.turnStart(await ensureThread(), initPrompt);
    },
  },
  {
    id: "memories",
    description: "Configure memory use and generation",
    run: ({ openDialog }) => openDialog("memories"),
  },
  {
    id: "hooks",
    description: "View and manage lifecycle hooks",
    run: ({ openDialog }) => openDialog("hooks"),
  },
  {
    id: "import",
    description:
      "Import setup, this project, and recent chats from Claude Code",
    run: ({ openDialog }) => openDialog("import"),
  },
  {
    id: "new",
    description: "Start a new chat during a conversation",
    run: async () => {
      await codexService.setCurrentThread(null);
    },
  },
];

export function filterSlashCommands(query: string): SlashCommand[] {
  const needle = query.toLowerCase();
  return SLASH_COMMANDS.filter((cmd) => cmd.id.startsWith(needle));
}
