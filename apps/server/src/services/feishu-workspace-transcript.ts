import { setImmediate } from "node:timers/promises";
import type {
  AgentSessionRecord,
  AgentTranscriptResponse,
} from "@agent-orchestrator/shared";
import type { CodexTranscriptService } from "./codex-transcript-service.js";

const MAX_EXPORT_BYTES = 10 * 1024 * 1024;

/** Exports the human conversation, never raw rollout/tool/internal records. */
export class FeishuWorkspaceTranscript {
  constructor(
    private readonly source: Pick<
      CodexTranscriptService,
      "read" | "readRemote"
    >,
  ) {}

  async read(
    session: AgentSessionRecord,
    threadId: string,
    cursor?: string,
  ): Promise<AgentTranscriptResponse> {
    return this.readPage(session, threadId, cursor, 5);
  }

  private async readPage(
    session: AgentSessionRecord,
    threadId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<AgentTranscriptResponse> {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(threadId))
      throw new Error("无法确认对话记录身份。");
    if (session.hostId && session.hostId !== "local" && !session.sshTarget)
      throw new Error("远端记录通道不可用。");
    const input = { sessionId: threadId, limit, ...(cursor ? { cursor } : {}) };
    const page = session.sshTarget
      ? await this.source.readRemote({ ...input, sshTarget: session.sshTarget })
      : this.source.read(input);
    if (
      !page.available ||
      page.sessionId !== threadId ||
      page.matchedBy !== "session-id"
    ) {
      throw new Error("未找到当前 Codex 对话的记录，请刷新后重试。");
    }
    return {
      ...page,
      entries: page.entries.filter(
        (entry) =>
          (entry.kind === "user" || entry.kind === "assistant") &&
          !entry.internal &&
          !entry.text.includes("goal.internal_context"),
      ),
    };
  }

  async export(
    session: AgentSessionRecord,
    threadId: string,
  ): Promise<{ name: string; data: Buffer }> {
    const pages: string[] = [];
    const cursors = new Set<string>();
    const ids = new Set<string>();
    let cursor: string | undefined;
    let bytes = 0;
    for (let count = 0; count < 500; count++) {
      const page = await this.readPage(session, threadId, cursor, 100);
      const text = page.entries
        .filter((entry) => {
          if (ids.has(entry.id)) return false;
          ids.add(entry.id);
          return true;
        })
        .map(
          (entry) =>
            `## ${entry.kind === "user" ? "用户" : "Codex"} · ${entry.timestamp}\n\n${entry.text}\n\n`,
        )
        .join("");
      bytes += Buffer.byteLength(text);
      if (bytes > MAX_EXPORT_BYTES)
        throw new Error("记录超过 10 MiB，请分段查看。");
      pages.unshift(text);
      if (!page.hasMore)
        return {
          name: `codex-${threadId}.md`,
          data: Buffer.from(pages.join("")),
        };
      if (!page.nextCursor || cursors.has(page.nextCursor))
        throw new Error("记录分页发生变化，请重新获取。");
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
      await setImmediate();
    }
    throw new Error("记录过长，请分段查看；没有发送不完整的导出文件。");
  }
}
