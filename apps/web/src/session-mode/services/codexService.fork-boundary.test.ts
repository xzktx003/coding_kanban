import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ threadFork: vi.fn(), turnStart: vi.fn() }));
vi.mock("./apiAdapt", () => api);
import { codexService } from "./codexService";
import { useCodexStore } from "../components/codex/stores";
import { MutationNotStartedError } from "./MutationNotStartedError";

beforeEach(() => {
  vi.clearAllMocks();
  useCodexStore.setState({
    threads: [],
    events: {},
    turnTimingMap: {},
    threadStatusMap: {},
    currentThreadId: null,
    currentTurnId: null,
  });
  api.threadFork.mockResolvedValue({
    thread: { id: "fork", cwd: "/owner", turns: [] },
  });
});
it("passes the selected native inclusive or exclusive turn boundary and defers inherited goals", async () => {
  await codexService.threadFork("owner", { lastTurnId: "last" });
  expect(api.threadFork).toHaveBeenLastCalledWith({
    threadId: "owner",
    lastTurnId: "last",
    deferGoalContinuation: true,
  });
  await codexService.threadFork("owner", { beforeTurnId: "before" });
  expect(api.threadFork).toHaveBeenLastCalledWith({
    threadId: "owner",
    beforeTurnId: "before",
    deferGoalContinuation: true,
  });
});
it("rejects ambiguous boundaries or an inclusive in-progress source before invoking the protocol", async () => {
  await expect(
    codexService.threadFork("owner", {
      lastTurnId: "one",
      beforeTurnId: "two",
    }),
  ).rejects.toBeInstanceOf(MutationNotStartedError);
  await expect(
    codexService.threadFork("owner", { lastTurnId: "" }),
  ).rejects.toBeInstanceOf(MutationNotStartedError);
  useCodexStore.setState({
    turnTimingMap: {
      owner: {
        turnId: "live",
        status: "inProgress",
        startedAtMs: 1000,
        durationMs: null,
      },
    },
  });
  await expect(
    codexService.threadFork("owner", { lastTurnId: "live" }),
  ).rejects.toBeInstanceOf(MutationNotStartedError);
  expect(api.threadFork).not.toHaveBeenCalled();
});
it("re-sends a captured edit input including remote images and skill context without sharing its mutable buffer", async () => {
  let finish!: (value: unknown) => void;
  api.turnStart.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const input = [
    { type: "text" as const, text: "edited", text_elements: [] },
    { type: "image" as const, url: "https://fixture.invalid/original.png" },
    {
      type: "skill" as const,
      name: "owned",
      path: "/owner/.agents/skills/owned/SKILL.md",
    },
  ];
  useCodexStore.setState({ currentThreadId: "other" });
  const pending = codexService.turnStart(
    "owner",
    "edited",
    [],
    "edit-request",
    input,
  );
  input[1].url = "https://fixture.invalid/changed.png";
  expect(api.turnStart.mock.calls[0][0].input).toEqual([
    { type: "text", text: "edited", text_elements: [] },
    { type: "image", url: "https://fixture.invalid/original.png" },
    {
      type: "skill",
      name: "owned",
      path: "/owner/.agents/skills/owned/SKILL.md",
    },
  ]);
  expect(api.turnStart.mock.calls[0][0].clientUserMessageId).toBe(
    "edit-request",
  );
  finish({
    turn: { id: "edit-turn", status: "inProgress", startedAt: 1, items: [] },
  });
  await pending;
  expect(useCodexStore.getState().currentThreadId).toBe("other");
});
it("uses frozen commit settings across edit waits and never lets overrides change the target or inputs", async () => {
  api.turnStart.mockResolvedValue({
    turn: { id: "snapshot", status: "inProgress", startedAt: 1, items: [] },
  });
  const captured = {
    cwd: "/source",
    model: "captured-model",
    effort: "high",
    serviceTier: "fast",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandboxPolicy: { type: "readOnly", networkAccess: false },
    collaborationMode: {
      mode: "plan",
      settings: {
        model: "captured-model",
        reasoning_effort: "high",
        developer_instructions: null,
      },
    },
    threadId: "wrong",
    input: [{ type: "text", text: "wrong", text_elements: [] }],
    clientUserMessageId: "wrong",
  } as any;
  await codexService.turnStart(
    "owner",
    "edited",
    [],
    "captured-send",
    undefined,
    captured,
  );
  expect(api.turnStart.mock.calls[0][0]).toMatchObject({
    threadId: "owner",
    clientUserMessageId: "captured-send",
    input: [{ type: "text", text: "edited", text_elements: [] }],
    cwd: "/source",
    model: "captured-model",
    effort: "high",
    serviceTier: "fast",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandboxPolicy: { type: "readOnly", networkAccess: false },
    collaborationMode: captured.collaborationMode,
  });
  captured.sandboxPolicy.networkAccess = true;
  expect(api.turnStart.mock.calls[0][0].sandboxPolicy.networkAccess).toBe(
    false,
  );
});
