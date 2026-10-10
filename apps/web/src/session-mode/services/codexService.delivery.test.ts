import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  threadRead: vi.fn(),
  threadRollback: vi.fn(),
}));
vi.mock("./apiAdapt", () => api);
import { codexService } from "./codexService";
import { useCodexStore } from "../components/codex/stores";
import { buildThreadRows } from "../components/codex/thread/threadRows";
import { useCodexDeliveryStore } from "../stores/useCodexDeliveryStore";
import {
  trackCodexTranscript,
  markCodexTranscriptDormant,
  forgetCodexTranscript,
} from "./codexTranscriptActivity";
const user = (id: string, turnId = "live-turn") =>
  ({
    method: "item/started",
    params: {
      threadId: "delivery-thread",
      turnId,
      item: {
        type: "userMessage",
        id,
        clientId: id,
        content: [{ type: "text", text: id, text_elements: [] }],
      },
    },
  }) as any;
const thread = (turns: any[] = []) => ({
  id: "delivery-thread",
  status: { type: "idle" },
  turns,
});
beforeEach(() => {
  vi.clearAllMocks();
  useCodexStore.setState({
    currentThreadId: "delivery-thread",
    threads: [],
    events: {},
    activeThreadIds: [],
    threadStatusMap: {},
    turnTimingMap: {},
    historyLoadingMap: {},
  });
});
it("preserves messages and active status arriving while an older history snapshot loads", async () => {
  let resolve!: (value: any) => void;
  api.threadRead.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = codexService.threadResume("delivery-thread");
  useCodexStore.getState().addEvent("delivery-thread", user("new-message"));
  useCodexStore.getState().addEvent("delivery-thread", {
    method: "thread/status/changed",
    params: {
      threadId: "delivery-thread",
      status: { type: "active", activeFlags: [] },
    },
  });
  resolve({ thread: thread() });
  await pending;
  expect(
    buildThreadRows(useCodexStore.getState().events["delivery-thread"]),
  ).toHaveLength(1);
  expect(useCodexStore.getState().threadStatusMap["delivery-thread"].type).toBe(
    "active",
  );
});
it("rollback still removes discarded messages and invalidates older history loads", async () => {
  useCodexStore.setState({ events: { "delivery-thread": [user("removed")] } });
  let resolve!: (v: any) => void;
  api.threadRead.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const load = codexService.threadResume("delivery-thread");
  api.threadRollback.mockResolvedValue({ thread: thread() });
  await codexService.threadRollback("delivery-thread", 1);
  resolve({
    thread: thread([
      {
        id: "live-turn",
        status: "completed",
        items: [user("removed").params.item],
      },
    ]),
  });
  await load;
  expect(
    buildThreadRows(useCodexStore.getState().events["delivery-thread"]),
  ).toHaveLength(0);
});

it("acknowledges native history receipts without mounting or repopulating a dormant transcript", async () => {
  const id = "delivery-thread";
  trackCodexTranscript(id);
  markCodexTranscriptDormant(id);
  // The receipt store uses the composite identity, independent of its UI.
  useCodexDeliveryStore.setState({
    entries: {
      [JSON.stringify([id, "confirmed"])]: {
        id: "confirmed",
        threadId: id,
        text: "message",
        images: [],
        status: "sent",
      },
    },
  });
  api.threadRead.mockResolvedValue({
    thread: thread([
      {
        id: "live-turn",
        status: "completed",
        items: [user("confirmed").params.item],
      },
    ]),
  });
  try {
    await codexService.loadThreadHistory(id, undefined, {
      background: true,
      recent: true,
    });
    expect(useCodexDeliveryStore.getState().entries).toEqual({});
    expect(useCodexStore.getState().events[id]).toBeUndefined();
  } finally {
    forgetCodexTranscript(id);
  }
});
