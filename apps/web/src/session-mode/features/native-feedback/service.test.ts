import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  endpoint: "https://fixture.invalid",
  token: "fixture-a",
  fetch: vi.fn(),
  subscriber: null as any,
  stop: vi.fn(),
}));
vi.mock("@session/hooks/runtime", () => ({
  buildUrl: (path: string) => mocks.endpoint + path,
  authHeaders: () => ({ Authorization: mocks.token }),
}));
vi.mock("@session/lib/eventStream", () => ({
  openEventStream: (subscriber: any) => {
    mocks.subscriber = subscriber;
    return mocks.stop;
  },
}));
import { startFeedbackUpload, feedbackUploads } from "./service";
import { useCodexStore } from "@session/components/codex/stores";
import { usePairingStore } from "@session/stores/usePairingStore";
beforeEach(() => {
  feedbackUploads.clear();
  useCodexStore.setState({ account: null, accountNamespace: null });
  vi.clearAllMocks();
  mocks.subscriber = null;
  mocks.endpoint = "https://fixture.invalid";
  mocks.token = "fixture-a";
  vi.stubGlobal("fetch", mocks.fetch);
  usePairingStore.setState({ selectedHost: null, desktops: [] });
});
afterEach(() => {
  feedbackUploads.clear();
  vi.unstubAllGlobals();
});
const receipt = (body: unknown, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => body,
});
it("captures the thread, host, credentials and consent for an explicit retry", async () => {
  const selection = { classification: "bug", includeLogs: false };
  mocks.fetch
    .mockResolvedValueOnce(
      receipt({ error: "feedback uploads are already in progress" }, 503),
    )
    .mockResolvedValueOnce(receipt({ threadId: "result-A" }));
  const id = startFeedbackUpload(
    "thread-A",
    "  Captured details  ",
    selection,
    "owner-A",
  );
  selection.classification = "other";
  selection.includeLogs = true;
  mocks.endpoint = "https://other.invalid";
  mocks.token = "fixture-b";
  await vi.waitFor(() =>
    expect(feedbackUploads.getSnapshot()[0].status).toBe("failed"),
  );
  expect(feedbackUploads.retry(id)).toBe(true);
  await vi.waitFor(() =>
    expect(feedbackUploads.getSnapshot()[0]).toMatchObject({
      owner: "owner-A",
      status: "uploaded",
      correlationId: "result-A",
    }),
  );
  for (const call of mocks.fetch.mock.calls)
    expect(call).toEqual([
      "https://fixture.invalid/api/codex/feedback/upload",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "fixture-a",
        },
        body: JSON.stringify({
          threadId: "thread-A",
          reason: "Captured details",
          classification: "bug",
          includeLogs: false,
        }),
      },
    ]);
  expect(JSON.stringify(feedbackUploads.getSnapshot())).not.toMatch(
    /fixture-a|Captured details/,
  );
});
it.each([{}, null, { threadId: "" }])(
  "does not offer retry when a successful HTTP response has no receipt %j",
  async (data) => {
    mocks.fetch.mockResolvedValueOnce(receipt(data));
    const id = startFeedbackUpload(
      null,
      "details",
      { classification: "other", includeLogs: true },
      "owner-A",
    );
    await vi.waitFor(() =>
      expect(feedbackUploads.getSnapshot()[0].status).toBe("unconfirmed"),
    );
    expect(feedbackUploads.retry(id)).toBe(false);
  },
);
it.each(["account/updated", "account/login/completed", "codex:disconnected"])(
  "disposes an old workflow on %s and releases its observer",
  async (method) => {
    let finish!: (v: unknown) => void;
    mocks.fetch.mockImplementation(() => new Promise((r) => (finish = r)));
    startFeedbackUpload(
      "thread-A",
      "details",
      { classification: "bug", includeLogs: false },
      "owner-A",
    );
    expect(mocks.subscriber).not.toBeNull();
    mocks.subscriber.onEvent({
      event: method === "codex:disconnected" ? method : "codex:notification",
      payload: { method },
    });
    expect(feedbackUploads.getSnapshot()).toEqual([]);
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    finish(receipt({ threadId: "late" }));
    await Promise.resolve();
    await Promise.resolve();
    expect(feedbackUploads.getSnapshot()).toEqual([]);
  },
);
it("changing the paired host drops old UI without cancelling or resending its upload", async () => {
  let finish!: (v: unknown) => void;
  mocks.fetch.mockImplementation(() => new Promise((r) => (finish = r)));
  startFeedbackUpload(
    "thread-A",
    "details",
    { classification: "bug", includeLogs: false },
    "owner-A",
  );
  usePairingStore.setState({ selectedHost: "another-host" });
  expect(feedbackUploads.getSnapshot()).toEqual([]);
  finish(receipt({ threadId: "late" }));
  await Promise.resolve();
  await Promise.resolve();
  expect(feedbackUploads.getSnapshot()).toEqual([]);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it("clears a pending report on a same-email workspace switch without reviving its late receipt", async () => {
  useCodexStore.setState({
    account: {
      type: "chatgpt",
      email: "fixture@example.invalid",
      planType: "pro",
    },
    accountNamespace: "workspace-A",
  });
  let finish!: (value: unknown) => void;
  mocks.fetch.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  startFeedbackUpload(
    "thread-A",
    "details",
    { classification: "bug", includeLogs: false },
    "owner-A",
  );
  useCodexStore.setState({ accountNamespace: "workspace-B" });
  expect(feedbackUploads.getSnapshot()).toEqual([]);
  expect(mocks.stop).toHaveBeenCalledOnce();
  finish(receipt({ threadId: "old-workspace-receipt" }));
  await Promise.resolve();
  await Promise.resolve();
  expect(feedbackUploads.getSnapshot()).toEqual([]);
  expect(mocks.fetch).toHaveBeenCalledOnce();
});
it("keeps a pending report when only the plan changes within the same workspace", async () => {
  useCodexStore.setState({
    account: {
      type: "chatgpt",
      email: "fixture@example.invalid",
      planType: "pro",
    },
    accountNamespace: "workspace-A",
  });
  let finish!: (value: unknown) => void;
  mocks.fetch.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  startFeedbackUpload(
    "thread-A",
    "details",
    { classification: "bug", includeLogs: false },
    "owner-A",
  );
  useCodexStore.setState({
    account: {
      type: "chatgpt",
      email: "fixture@example.invalid",
      planType: "plus",
    },
  });
  expect(feedbackUploads.getSnapshot()).toHaveLength(1);
  finish(receipt({ threadId: "same-workspace-receipt" }));
  await vi.waitFor(() =>
    expect(feedbackUploads.getSnapshot()[0]?.status).toBe("uploaded"),
  );
});

it("reconnect revokes report UI while an already sent upload may finish without reviving it", async () => {
  let finish!: (value: unknown) => void;
  mocks.fetch.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  startFeedbackUpload(
    "thread-A",
    "details",
    { classification: "bug", includeLogs: false },
    "owner-A",
  );
  mocks.subscriber.onResync?.();
  expect(feedbackUploads.getSnapshot()).toEqual([]);
  finish(receipt({ threadId: "late" }));
  await Promise.resolve();
  await Promise.resolve();
  expect(feedbackUploads.getSnapshot()).toEqual([]);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});
