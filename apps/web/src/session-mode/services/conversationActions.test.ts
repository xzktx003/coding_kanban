// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ threadFork: vi.fn(), startReview: vi.fn() }));
vi.mock("./apiAdapt/codex", () => api);
vi.mock("./apiAdapt/shared", () => ({
  postJsonWithOptions: (_path: string, body: unknown) => api.startReview(body),
}));
import { createSideChat, runConversationReview } from "./conversationActions";
import { useCodexStore } from "../components/codex/stores";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import {
  useSessionDraftStore,
  sessionDraftKey,
} from "../stores/useSessionDraftStore";
beforeEach(() => {
  vi.clearAllMocks();
  useCodexStore.setState({
    currentThreadId: "main",
    currentTurnId: "active",
    threads: [],
    events: {},
    activeThreadIds: [],
    threadStatusMap: {},
    turnTimingMap: {},
  });
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id: "main", cwd: "/main" }],
    currentAgentCardId: "main",
    currentAgentCardKind: "codex",
  });
});
it("forks a side chat and carries the question without switching the main conversation", async () => {
  api.threadFork.mockResolvedValue({
    thread: { id: "side", cwd: "/main", status: { type: "idle" }, turns: [] },
  });
  expect(await createSideChat("main", "explain this")).toBe("side");
  expect(api.threadFork).toHaveBeenCalledWith({ threadId: "main" });
  expect(useCodexStore.getState().currentThreadId).toBe("main");
  expect(useCodexStore.getState().currentTurnId).toBe("active");
  expect(useAgentCenterStore.getState().currentAgentCardId).toBe("main");
  expect(
    useSessionDraftStore.getState().drafts[sessionDraftKey("codex", "side")]
      .text,
  ).toBe("explain this");
});
it("uses the review thread returned by the backend and keeps the source selected", async () => {
  api.startReview.mockResolvedValue({
    reviewThreadId: "review",
    turn: { id: "review-turn", status: "inProgress", items: [] },
  });
  expect(
    await runConversationReview("main", "detached", {
      type: "uncommittedChanges",
    }),
  ).toBe("review");
  expect(api.startReview.mock.calls[0][0]).toMatchObject({
    threadId: "main",
    delivery: "detached",
  });
  expect(useCodexStore.getState().currentThreadId).toBe("main");
  expect(
    useAgentCenterStore.getState().cards.some((c) => c.id === "review"),
  ).toBe(true);
});
it("does not retain forked tool payloads in side-chat metadata", async () => {
  const thread = {
    id: "side-tools",
    cwd: "/main",
    status: { type: "idle" },
    turns: [
      {
        id: "old-turn",
        status: "completed",
        items: [
          {
            type: "commandExecution",
            id: "tool",
            aggregatedOutput: "x".repeat(1024 * 1024),
          },
          { type: "agentMessage", id: "answer", text: "Final answer" },
        ],
      },
    ],
  };
  api.threadFork.mockResolvedValueOnce({ thread });
  await createSideChat("main");
  const state = useCodexStore.getState();
  expect(
    state.threads.find((t) => t.id === thread.id)?.turns[0].items.length,
  ).toBe(0);
  expect(JSON.stringify(state.events[thread.id])).not.toContain(
    "commandExecution",
  );
  expect(JSON.stringify(state.events[thread.id])).toContain("Final answer");
  expect(thread.turns[0].items).toHaveLength(2);
});
