import type {
  ComposerContext,
  FollowupThread,
  NativeInputMention,
} from "@agent-orchestrator/shared";
import { nativeClientScope } from "./native-client-scope";
import type { NativeCodexTarget } from "./native-codex-target";

export function hasPendingSessionFollowups(queue: FollowupThread): boolean {
  return queue.items.some((item) =>
    ["queued", "sending", "uncertain"].includes(item.status),
  );
}

export type NativeCodexSend = {
  target: NativeCodexTarget;
  submissionId: string;
  text: string;
  images: string[];
  contexts: ComposerContext[];
  mentions: NativeInputMention[];
};

export async function sendToNativeCodex(
  input: NativeCodexSend,
  fetcher: typeof fetch = fetch,
): Promise<{ accepted: true; turnId: string }> {
  const response = await fetcher(
    nativeClientScope(window.location.search).api("send"),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId: input.target.threadId,
        column: input.target.column,
        cwd: input.target.cwd,
        submissionId: input.submissionId,
        text: input.text,
        images: input.images,
        contexts: input.contexts,
        mentions: input.mentions,
      }),
      cache: "no-store",
    },
  );
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("原生 Codex 未返回有效发送回执，输入已保留");
  }
  const result = value as {
    accepted?: unknown;
    turnId?: unknown;
    error?: unknown;
  } | null;
  if (!response.ok) {
    throw new Error(
      typeof result?.error === "string"
        ? result.error
        : `发送到原生 Codex 失败（HTTP ${response.status}），输入已保留`,
    );
  }
  if (
    !result ||
    result.accepted !== true ||
    typeof result.turnId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      result.turnId,
    )
  )
    throw new Error("原生 Codex 发送回执不完整，输入已保留");
  return { accepted: true, turnId: result.turnId };
}
