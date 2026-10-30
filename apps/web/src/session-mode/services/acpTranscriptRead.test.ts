import { beforeEach, afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ read: vi.fn(), endpoint: "fixture" }));
vi.mock("./apiAdapt/acp", () => ({
  acpReadSessionTranscript: (...args: unknown[]) => api.read(...args),
}));
vi.mock("../hooks/runtime", () => ({
  buildUrl: (path: string) => `${api.endpoint}${path}`,
  authHeaders: () => ({}),
}));
import { useAcpStore } from "../stores/useAcpStore";
import {
  refreshAcpTranscript,
  acpTranscriptOwner,
  cancelAcpTranscriptRead,
  disposeAcpTranscriptReads,
} from "./acpTranscriptRead";
import { foldPersistentAcpUpdate } from "./acpTranscriptIdentity";
import {
  useProviderTranscriptStore,
  trackProviderTranscript,
  markProviderTranscriptDormant,
  retainProviderTranscript,
} from "./sessionProviderTranscriptState";
const target = {
  agentId: "agent",
  connectionId: "connection",
  sessionId: "session",
};
const owner = acpTranscriptOwner(target);
beforeEach(() => {
  api.read.mockReset();
  api.endpoint = "fixture";
  useProviderTranscriptStore.setState({ entries: {} });
  useAcpStore.getState().reset();
  useAcpStore.setState({ ...target, entries: [], configOptions: [] });
});
afterEach(() => cancelAcpTranscriptRead(owner));
const page = (text = "first ") => ({
  projection: "acp-entries",
  data: [{ id: "acp-1-0", role: "agent", text, historySourceId: 1 }],
  nextCursor: null,
  truncated: false,
  revision: "1:1",
  metadata: { historySourceId: 1 },
});
it("merges source-fenced live updates into a delayed readonly recent page without losing the current reply", async () => {
  useAcpStore.setState({ entries: page().data as any });
  let resolve!: (value: unknown) => void;
  api.read.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  const reading = refreshAcpTranscript(target);
  await vi.waitFor(() => expect(api.read).toHaveBeenCalledOnce());
  useAcpStore.setState((s) => ({
    entries: foldPersistentAcpUpdate(
      s.entries,
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "second" },
      },
      2,
    ),
  }));
  resolve(page());
  await reading;
  expect(useAcpStore.getState().entries).toHaveLength(1);
  expect(useAcpStore.getState().entries[0]).toMatchObject({
    text: "first second",
    historySourceId: 2,
  });
});
it("rejects late readonly replies after target change or invisible-body reclamation", async () => {
  let resolve!: (value: unknown) => void;
  api.read.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  const reading = refreshAcpTranscript(target);
  await vi.waitFor(() => expect(api.read).toHaveBeenCalled());
  markProviderTranscriptDormant(owner, 1000);
  resolve(page());
  await reading;
  expect(useAcpStore.getState().entries).toEqual([]);
  expect(
    useProviderTranscriptStore.getState().entries[owner].restoreNeeded,
  ).toBe(true);
  const release = retainProviderTranscript(owner, "acp", "session");
  api.read.mockResolvedValueOnce(page("restored"));
  await refreshAcpTranscript(target);
  release();
  expect(useAcpStore.getState().entries[0]).toMatchObject({ text: "restored" });
});
it("allows earlier pages while known live rows advance and never guesses untagged row identity", async () => {
  useAcpStore.setState({
    entries: [
      { id: "acp-20-0", role: "agent", text: "current", historySourceId: 20 },
    ],
  });
  let resolve!: (value: unknown) => void;
  api.read.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  const reading = refreshAcpTranscript(
    target,
    undefined,
    "interactive",
    "older-cursor",
  );
  await vi.waitFor(() => expect(api.read).toHaveBeenCalled());
  useAcpStore.setState((s) => ({
    entries: [
      ...s.entries,
      { id: "acp-21-0", role: "user", text: "next", historySourceId: 21 },
    ],
  }));
  resolve({ ...page("older"), metadata: { historySourceId: 20 } });
  await reading;
  expect(useAcpStore.getState().entries.map((row) => row.id)).toEqual([
    "acp-1-0",
    "acp-20-0",
    "acp-21-0",
  ]);
});
it("module disposal cancels its own pending reader and cannot restore body from a late reply", async () => {
  let resolve!: (value: unknown) => void;
  api.read.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  const reading = refreshAcpTranscript(target);
  const rejected = expect(reading).rejects.toThrow(/abort/i);
  await vi.waitFor(() => expect(api.read).toHaveBeenCalledOnce());
  disposeAcpTranscriptReads();
  await rejected;
  resolve(page("late module body"));
  await new Promise((r) => setTimeout(r, 0));
  expect(useAcpStore.getState().entries).toEqual([]);
});

it("does not publish a delayed page after even a same-account scope invalidation", async () => {
  const { invalidateCodexOperationScope } =
    await import("./codexOperationScope");
  let resolve!: (value: unknown) => void;
  api.read.mockReturnValue(new Promise((r) => (resolve = r)));
  const reading = refreshAcpTranscript(target);
  await vi.waitFor(() => expect(api.read).toHaveBeenCalledOnce());
  invalidateCodexOperationScope();
  resolve(page("old account body"));
  await reading;
  expect(useAcpStore.getState().entries).toEqual([]);
});
it("uses the application history source for reads and rejects a different source on the same native RPC identity", async () => {
  useAcpStore.setState({
    historySessionId: "acph_A",
    runtimeInstance: "runtime",
  });
  api.read.mockResolvedValue(page("scoped source A"));
  await refreshAcpTranscript({ ...target, historySessionId: "acph_A" });
  expect(api.read.mock.calls[0][0]).toBe("acph_A");
  api.read.mockClear();
  await refreshAcpTranscript({ ...target, historySessionId: "acph_B" });
  expect(api.read).not.toHaveBeenCalled();
});
it("accepted readonly rows carry the original exact source scope, while absent and newer live rows do not", async () => {
  const { readProviderHistoryConfirmation } =
    await import("./providerHistorySourceConfirmation");
  useAcpStore.setState({
    runtimeInstance: "runtime",
    historySessionId: "history-A",
    entries: [
      {
        id: "older",
        role: "agent",
        text: "old",
        historySourceId: 0,
        truncated: true,
        historyDetail: { itemId: "source-0" },
      },
    ],
  });
  api.read.mockResolvedValue({
    ...page(),
    data: [
      {
        ...page().data[0],
        truncated: true,
        historyDetail: { itemId: "source-1" },
      },
    ],
  });
  await refreshAcpTranscript(
    { ...target, historySessionId: "history-A" },
    undefined,
    "interactive",
    "actual-earlier-page",
  );
  expect(api.read.mock.lastCall?.[1]).toMatchObject({
    cursor: "actual-earlier-page",
  });
  const rows = useAcpStore.getState().entries;
  const identity = {
    provider: "acp" as const,
    sourceId: "history-A",
    itemId: "source-1",
    owner,
  };
  expect(
    readProviderHistoryConfirmation(
      rows.find((row) => row.id === "acp-1-0")!,
      identity,
    )?.scope.path,
  ).toBe("/api/acp/session");
  expect(
    readProviderHistoryConfirmation(
      rows.find((row) => row.id === "acp-1-0")!,
      identity,
    )?.readCursor,
  ).toBe("actual-earlier-page");
  expect(
    readProviderHistoryConfirmation(rows.find((row) => row.id === "older")!, {
      ...identity,
      itemId: "source-0",
    }),
  ).toBeNull();
});
