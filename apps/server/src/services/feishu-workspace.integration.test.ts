import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { AgentSessionRecord } from "@agent-orchestrator/shared";
import { FeishuSessionWorkspace } from "./feishu-session-workspace.js";
import { FeishuWorkspaceFiles } from "./feishu-workspace-files.js";

test("workspace confirmation writes real project files and rejects external edit conflicts", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "kanban-workspace-integration-"),
  );
  try {
    const target = path.join(root, "README.md");
    await writeFile(target, "original");
    const session: AgentSessionRecord = {
      id: "integration",
      workspaceId: "default",
      hostId: "local",
      sourceType: "local",
      agentKind: "codex",
      displayName: "integration",
      workingDirectory: root,
      connectionState: "online",
      interactionState: "idle",
      controlMode: "control",
      transportRef: { tmuxSession: "integration", tmuxPane: "%1" },
    };
    let card: unknown;
    let messageId = "";
    let sequence = 0;
    const workspace = new FeishuSessionWorkspace({
      allowedUserId: "ou_test",
      settings: {
        get: () => ({
          configured: true,
          destinationType: "user",
          enabled: true,
          replyConfigured: true,
          replyEnabled: true,
        }),
      },
      registry: { get: () => session },
      resolveSessionId: async () => "thread-integration",
      files: new FeishuWorkspaceFiles(),
      transcript: async () => {
        throw new Error("not used");
      },
      exportTranscript: async () => {
        throw new Error("not used");
      },
      messenger: {
        sendCard: async (input) => {
          card = input.card;
          messageId = `om_${++sequence}`;
          return { messageId, chatId: "oc_test" };
        },
        sendText: async () => {},
        sendFile: async () => {},
      },
    });
    function find(
      predicate: (node: Record<string, any>) => boolean,
    ): Record<string, any> {
      const nodes: unknown[] = [card];
      while (nodes.length) {
        const node = nodes.shift();
        if (!node || typeof node !== "object") continue;
        if (predicate(node)) return node;
        nodes.push(...Object.values(node));
      }
      throw new Error(`missing card action: ${JSON.stringify(card)}`);
    }
    async function click(label: string) {
      const button = find(
        (node) => node.tag === "button" && node.text?.content?.includes(label),
      );
      return workspace.handle({
        type: "card.action.trigger",
        event_id: `evt_${++sequence}`,
        operator_id: "ou_test",
        chat_id: "oc_test",
        message_id: messageId,
        action_tag: "button",
        action_value: JSON.stringify(button.behaviors[0].value),
      });
    }
    async function stage(content: string) {
      await workspace.open({
        sessionId: session.id,
        threadId: "thread-integration",
        operatorId: "ou_test",
        chatId: "oc_test",
      });
      await click("浏览项目文件");
      await click("预览文件 · README.md");
      await click("编辑文件");
      const button = find(
        (node) => node.tag === "button" && node.form_action_type === "submit",
      );
      assert.equal(
        await workspace.handle({
          type: "card.action.trigger",
          event_id: `evt_${++sequence}`,
          operator_id: "ou_test",
          chat_id: "oc_test",
          message_id: messageId,
          action_tag: "button",
          action_name: button.name,
          form_value: JSON.stringify({ content }),
        }),
        "write_confirm_sent",
      );
    }
    await stage("from Feishu");
    assert.equal(await readFile(target, "utf8"), "original");
    assert.equal(await click("确认写入"), "write_applied");
    assert.equal(await readFile(target, "utf8"), "from Feishu");
    await stage("must not replace external change");
    await writeFile(target, "external change");
    assert.notEqual(await click("确认写入"), "write_applied");
    assert.equal(await readFile(target, "utf8"), "external change");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
