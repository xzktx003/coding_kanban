import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  history: vi.fn(),
  queue: vi.fn(),
  threads: {} as Record<string, any>,
}));
vi.mock("./apiAdapt/cc", () => ({
  ccReadSessionTranscript: async (...args: unknown[]) => {
    const value = await api.history(...args);
    return Array.isArray(value)
      ? {
          data: value,
          nextCursor: null,
          revision: "fixture",
          truncated: false,
          projection: "cc-messages",
        }
      : value;
  },
}));
vi.mock("./followupService", () => ({
  followupService: { load: api.queue },
  useFollowupStore: { getState: () => ({ threads: api.threads }) },
}));
vi.mock("../lib/eventStream", () => ({ openEventStream: () => () => {} }));
import { useCCStore } from "../stores/cc";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import {
  refreshClaudeHistory,
  startFollowedSessionAuxSync,
} from "./followedSessionAuxSync";
beforeEach(() => {
  api.threads = {};
  api.history.mockReset().mockResolvedValue([]);
  api.queue.mockReset().mockResolvedValue({});
  useCCStore.setState({
    messages: [],
    sessionMessagesMap: {},
    sessionLoadingMap: {},
    activeSessionId: null,
  });
});
afterEach(() => vi.useRealTimers());
it("promotes a queued Claude history when the visible view joins background preloading", async () => {
  const releases: Array<() => void> = [];
  api.history.mockImplementation(
    () => new Promise((resolve) => releases.push(() => resolve([]))),
  );
  const reads = ["held", "waiting", "selected"].map((id) =>
    refreshClaudeHistory(`priority-${id}`, undefined, "background"),
  );
  const visible = refreshClaudeHistory("priority-selected");
  try {
    expect(api.history.mock.calls.map((call) => call[0])).toEqual([
      "priority-held",
      "priority-selected",
    ]);
  } finally {
    for (let i = 0; i < 6; i++) {
      releases.splice(0).forEach((release) => release());
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all([...reads, visible]);
  }
});
it("cancelling one Claude consumer keeps the shared read for another view", async () => {
  let release!: (value: unknown) => void;
  let transport!: AbortSignal;
  api.history.mockImplementationOnce((_id, options) => {
    transport = options.signal;
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const controller = new AbortController();
  const first = refreshClaudeHistory("shared-claude", controller.signal);
  const cancelled = expect(first).rejects.toThrow(/abort/i);
  const visible = refreshClaudeHistory("shared-claude");
  const outcome = visible.catch((error) => error);
  controller.abort();
  try {
    await cancelled;
    expect(transport.aborted).toBe(false);
    release([
      { type: "assistant", uuid: "shared-final", message: { content: [] } },
    ]);
    expect(await outcome).toBeUndefined();
    expect(api.history).toHaveBeenCalledOnce();
    expect(
      useCCStore.getState().sessionMessagesMap["shared-claude"][0],
    ).toMatchObject({ uuid: "shared-final" });
  } finally {
    release([]);
    await outcome;
  }
});
it("the final Claude cancellation immediately detaches a hung read before reopening", async () => {
  api.history.mockImplementationOnce(() => new Promise(() => {}));
  api.history.mockResolvedValueOnce([
    { type: "assistant", uuid: "fresh-final", message: { content: [] } },
  ]);
  const controller = new AbortController();
  const old = refreshClaudeHistory("reopened-claude", controller.signal);
  const cancelled = expect(old).rejects.toThrow(/abort/i);
  controller.abort();
  const fresh = refreshClaudeHistory("reopened-claude");
  await cancelled;
  await expect(fresh).resolves.toBeUndefined();
  expect(api.history).toHaveBeenCalledTimes(2);
  expect(
    useCCStore.getState().sessionMessagesMap["reopened-claude"][0],
  ).toMatchObject({ uuid: "fresh-final" });
});
it("background history stays display-only and preserves a stream update during the read", async () => {
  let resolve!: (value: unknown) => void;
  api.history.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = refreshClaudeHistory("cc");
  useCCStore.setState({
    activeSessionId: "other",
    sessionMessagesMap: {
      cc: [
        {
          type: "assistant",
          uuid: "reply",
          session_id: "cc",
          message: { content: [{ type: "text", text: "live" }] },
        } as any,
      ],
    },
  });
  resolve([
    {
      type: "assistant",
      uuid: "reply",
      message: { content: [{ type: "text", text: "old" }] },
    },
  ]);
  await pending;
  expect(
    (useCCStore.getState().sessionMessagesMap.cc[0] as any).message.content[0]
      .text,
  ).toBe("live");
  expect(useCCStore.getState().activeSessionId).toBe("other");
  expect(useCCStore.getState().sessionLoadingMap.cc).toBeUndefined();
});
it("reuses unchanged Claude rows without serializing the complete history and retains external replies and permissions", async () => {
  const raw = Array.from({ length: 500 }, (_, index) => ({
    type: "assistant",
    uuid: `history-${index}`,
    message: { content: [{ type: "text", text: "history ".repeat(256) }] },
  }));
  api.history.mockResolvedValue(raw);
  await refreshClaudeHistory("sharing");
  const current = useCCStore.getState().sessionMessagesMap.sharing;
  const permission = {
    type: "permission_request",
    sessionId: "sharing",
    requestId: "approval",
    toolName: "Bash",
    toolInput: {},
  } as const;
  useCCStore.setState({
    sessionMessagesMap: { sharing: [...current, permission] },
  });
  const stringify = vi.spyOn(JSON, "stringify");
  const notify = vi.fn();
  const unsubscribe = useCCStore.subscribe(notify);
  try {
    api.history.mockResolvedValue(structuredClone(raw));
    await refreshClaudeHistory("sharing");
    expect(notify).not.toHaveBeenCalled();
    expect(
      stringify.mock.calls.some(
        ([value]) =>
          Array.isArray(value) &&
          value.some((row) => row?.uuid === "history-0"),
      ),
    ).toBe(false);
    api.history.mockResolvedValue([
      ...structuredClone(raw),
      {
        type: "assistant",
        uuid: "external-final",
        message: {
          content: [{ type: "text", text: "external completed reply" }],
        },
      },
    ]);
    await refreshClaudeHistory("sharing");
    const next = useCCStore.getState().sessionMessagesMap.sharing;
    expect(next[0]).toBe(current[0]);
    expect(next.some((row: any) => row.uuid === "external-final")).toBe(true);
    expect(next).toContain(permission);
    expect(notify).toHaveBeenCalledOnce();
  } finally {
    stringify.mockRestore();
    unsubscribe();
  }
});
it("queue snapshots include every opened Codex including detached tabs", async () => {
  vi.useFakeTimers();
  useAgentCenterStore.setState({
    cards: [
      { kind: "codex", id: "a" },
      { kind: "codex", id: "b" },
    ],
    detachedCard: { kind: "codex", id: "c" },
  });
  const stop = startFollowedSessionAuxSync();
  await vi.advanceTimersByTimeAsync(1);
  expect(new Set(api.queue.mock.calls.map((c) => c[0]))).toEqual(
    new Set(["a", "b", "c"]),
  );
  await vi.advanceTimersByTimeAsync(5000);
  expect(api.queue).toHaveBeenCalledTimes(6);
  stop();
});

it("idle Codex queues poll every thirty seconds and queued work stays responsive", async () => {
  vi.useFakeTimers();
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id: "idle" }],
    detachedCard: null,
  });
  api.threads.idle = { revision: 1, items: [] };
  const stop = startFollowedSessionAuxSync();
  try {
    await vi.advanceTimersByTimeAsync(1);
    expect(api.queue).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.queue).toHaveBeenCalledTimes(1);
    api.threads.idle = { revision: 2, items: [{ status: "queued" }] };
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.queue).toHaveBeenCalledTimes(2);
    api.threads.idle = { revision: 3, items: [] };
    await vi.advanceTimersByTimeAsync(29000);
    expect(api.queue).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.queue).toHaveBeenCalledTimes(3);
  } finally {
    stop();
  }
});

it("a delayed Claude page cannot publish after the shared owner scope is invalidated",async()=>{
 const {invalidateCodexOperationScope}=await import("./codexOperationScope");
 let resolve!:(value:unknown)=>void;api.history.mockReturnValue(new Promise(r=>resolve=r));
 const reading=refreshClaudeHistory("revoked-page");await vi.waitFor(()=>expect(api.history).toHaveBeenCalledOnce());
 invalidateCodexOperationScope();resolve([{type:"assistant",uuid:"old",message:{content:[{type:"text",text:"old owner"}]}}]);await reading;
 expect(useCCStore.getState().sessionMessagesMap["revoked-page"]).toEqual([]);
});
