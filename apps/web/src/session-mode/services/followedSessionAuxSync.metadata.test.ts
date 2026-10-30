import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ read: vi.fn(), connection: vi.fn() }));
vi.mock("./apiAdapt/cc", () => ({ ccReadSessionTranscript: api.read }));
vi.mock("./claudeConnectionRecovery", () => ({
  refreshClaudeConnection: api.connection,
}));
vi.mock("./followupService", () => ({
  followupService: { load: vi.fn() },
  useFollowupStore: { getState: () => ({ threads: {} }) },
}));
vi.mock("../lib/eventStream", () => ({ openEventStream: () => () => {} }));
vi.mock("./acpConnectionRecovery", () => ({
  startAcpConnectionRecovery: () => () => {},
}));
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { useCCStore } from "../stores/cc";
import { startFollowedSessionAuxSync } from "./followedSessionAuxSync";
import {
  markProviderTranscriptDormant,
  useProviderTranscriptStore,
} from "./sessionProviderTranscriptState";

const owner = "cc:metadata-test";
const page = {
  data: [
    {
      type: "assistant",
      uuid: "existing-answer",
      message: { content: [{ type: "text", text: "keep the existing reply" }] },
    },
  ],
  projection: "cc-messages",
  revision: "revision-one",
  nextCursor: null,
  truncated: false,
};
let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  api.read
    .mockReset()
    .mockImplementation(async (_id, options) =>
      options.metadataOnly ? { ...page, data: [] } : page,
    );
  api.connection.mockReset().mockResolvedValue(undefined);
  useAgentCenterStore.setState({
    cards: [{ kind: "cc", id: "metadata-test" }],
    detachedCard: null,
  });
  useCCStore.setState({
    messages: [],
    sessionMessagesMap: {},
    sessionLoadingMap: {},
    activeSessionId: null,
  });
  useProviderTranscriptStore.setState({ entries: {}, revision: 0 });
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
});

async function initialRead() {
  stop = startFollowedSessionAuxSync();
  await vi.advanceTimersByTimeAsync(1);
  expect(useProviderTranscriptStore.getState().entries[owner].revision).toBe(
    page.revision,
  );
  expect(api.read).toHaveBeenCalledOnce();
  expect(
    useCCStore.getState().sessionMessagesMap["metadata-test"],
  ).toHaveLength(1);
}

it("shows a failed metadata check without clearing existing history, and clears the notice on recovery", async () => {
  await initialRead();
  const history = useCCStore.getState().sessionMessagesMap["metadata-test"];
  api.read.mockRejectedValueOnce(new Error("当前会话服务不支持有界近期历史"));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(api.read.mock.calls[1][1]).toMatchObject({ metadataOnly: true });
  expect(useProviderTranscriptStore.getState().entries[owner].error).toBe(
    "当前会话服务不支持有界近期历史",
  );
  expect(useCCStore.getState().sessionMessagesMap["metadata-test"]).toBe(
    history,
  );
  await vi.advanceTimersByTimeAsync(30_000);
  expect(useProviderTranscriptStore.getState().entries[owner].error).toBeNull();
  expect(api.read).toHaveBeenCalledTimes(3);
});

it("reports a malformed metadata projection instead of silently treating it as a successful check", async () => {
  await initialRead();
  api.read.mockResolvedValueOnce({ ...page, projection: "raw" });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(useProviderTranscriptStore.getState().entries[owner].error).toMatch(
    /近期历史协议不可用/,
  );
});

it("does not publish a cancelled check after the sync consumer closes", async () => {
  await initialRead();
  let reject!: (reason: Error) => void;
  let requestSignal!: AbortSignal;
  api.read.mockImplementationOnce((_id, options) => {
    requestSignal = options.signal;
    return new Promise((_, fail) => {
      reject = fail;
    });
  });
  await vi.advanceTimersByTimeAsync(30_000);
  stop!();
  stop = undefined;
  expect(requestSignal.aborted).toBe(true);
  reject(new Error("late transport failure"));
  await vi.advanceTimersByTimeAsync(1);
  expect(useProviderTranscriptStore.getState().entries[owner].error).toBeNull();
});

it("does not publish a check from before the transcript generation was reclaimed", async () => {
  await initialRead();
  let reject!: (reason: Error) => void;
  api.read.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await vi.advanceTimersByTimeAsync(30_000);
  markProviderTranscriptDormant(owner, 0);
  reject(new Error("old generation failure"));
  await vi.advanceTimersByTimeAsync(1);
  expect(useProviderTranscriptStore.getState().entries[owner]).toMatchObject({
    dormant: true,
    error: null,
  });
});

it("keeps the history cancellation owner when the parallel connection snapshot fails first", async () => {
  await initialRead();
  let reject!: (reason: Error) => void;
  let requestSignal!: AbortSignal;
  api.connection.mockRejectedValueOnce(
    new Error("connection snapshot unavailable"),
  );
  api.read.mockImplementationOnce((_id, options) => {
    requestSignal = options.signal;
    return new Promise((_, fail) => {
      reject = fail;
    });
  });
  await vi.advanceTimersByTimeAsync(30_000);
  stop!();
  stop = undefined;
  try {
    expect(requestSignal.aborted).toBe(true);
  } finally {
    reject(new Error("late history transport failure"));
    await vi.advanceTimersByTimeAsync(1);
  }
  expect(useProviderTranscriptStore.getState().entries[owner].error).toBeNull();
});
it("same-body accepted readonly refresh confirms the retained canonical row for the new scope without changing message references", async () => {
  const { refreshClaudeHistory } = await import("./followedSessionAuxSync");
  const { invalidateCodexOperationScope } =
    await import("./codexOperationScope");
  const { readProviderHistoryConfirmation } =
    await import("./providerHistorySourceConfirmation");
  const withDetail = {
    ...page,
    data: page.data.map((row) => ({
      ...row,
      truncated: true,
      historyDetail: { itemId: "sdk-existing-answer" },
    })),
  };
  api.read.mockImplementation(async (_id, options) =>
    options.metadataOnly ? { ...withDetail, data: [] } : withDetail,
  );
  await initialRead();
  const before = useCCStore.getState().sessionMessagesMap["metadata-test"];
  const row = before[0];
  const identity = {
    provider: "cc" as const,
    sourceId: "metadata-test",
    itemId: "sdk-existing-answer",
    owner,
  };
  const proof = readProviderHistoryConfirmation(row, identity);
  expect(proof).not.toBeNull();
  invalidateCodexOperationScope();
  await refreshClaudeHistory(
    "metadata-test",
    undefined,
    "interactive",
    "actual-earlier-page",
  );
  expect(api.read.mock.lastCall?.[1]).toMatchObject({
    cursor: "actual-earlier-page",
  });
  expect(useCCStore.getState().sessionMessagesMap["metadata-test"]).toBe(
    before,
  );
  expect(
    readProviderHistoryConfirmation(row, identity)?.confirmationKey,
  ).not.toBe(proof?.confirmationKey);
  expect(readProviderHistoryConfirmation(row, identity)?.readCursor).toBe(
    "actual-earlier-page",
  );
});
