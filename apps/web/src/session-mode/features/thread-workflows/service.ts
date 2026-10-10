import { codexService } from "@session/services/codexService";
import { useCodexStore } from "@session/components/codex/stores";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { sessionDraftKey } from "@session/stores/useSessionDraftStore";
import { composerDrafts } from "@session/components/codex/composer/v2/drafts";
import { runTurnMutation } from "./delivery";
import type { TurnSource } from "./model";

/** The source is captured from a rendered turn, never from the currently selected global thread. */
export function forkAtTurn(
  chosen: TurnSource,
  selection?: string,
): Promise<string> {
  const source = Object.freeze({ ...chosen });
  return runTurnMutation(
    "fork",
    source,
    async () => {
      const activeBefore =
        useCodexStore.getState().currentThreadId === source.threadId &&
        useAgentSettingsStore.getState().selectedAgent === "codex";
      const thread = await codexService.threadFork(source.threadId, {
        lastTurnId: source.turnId,
      });
      if (!thread.id || thread.id === source.threadId)
        throw new Error("服务未返回独立的分支会话，请检查结果后继续。");
      if (selection?.trim())
        composerDrafts.add(sessionDraftKey("codex", thread.id), {
          id: crypto.randomUUID(),
          kind: "quote",
          name: "来自分支源轮次的选区",
          text: selection,
          sourceThreadId: source.threadId,
          sourceItemId: source.itemId,
        });
      const activate =
        activeBefore &&
        useCodexStore.getState().currentThreadId === source.threadId &&
        useAgentSettingsStore.getState().selectedAgent === "codex";
      useAgentCenterStore.getState().addAgentCard(
        {
          kind: "codex",
          id: thread.id,
          cwd: thread.cwd,
          preview: thread.name || "会话分支",
        },
        { activate },
      );
      if (activate) useCodexStore.getState().setCurrentThreadId(thread.id);
      return thread.id;
    },
    { newIntent: true },
  );
}

export function downloadThreadMarkdown(
  markdown: string,
  name = "conversation",
) {
  const filename = `${name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 100) || "conversation"}.md`;
  const url = URL.createObjectURL(
    new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
