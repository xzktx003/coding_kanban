import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CodexSteerReceipts } from "./CodexSteerReceipts";
import { TranscriptDetailVisibility } from "../hooks/transcriptDetailVisibility";
import { enqueueSessionRead } from "@session/services/sessionReadQueue";
const mocks = vi.hoisted(() => ({
  revision: 0,
  watch: vi.fn(),
  context: vi.fn(async () => ({
    scopeToken: "new-scope",
    namespace: "history-owner",
  })),
}));
vi.mock("@session/services/nativeOperationContext", () => ({
  readNativeOperationContext: mocks.context,
}));
vi.mock("@session/components/history/historySourceScope", () => ({
  captureHistorySourceScope: (path: string) => ({
    path,
    url: path,
    headers: {},
    revision: mocks.revision,
  }),
  isHistorySourceScopeCurrent: (scope: any) =>
    scope.revision === mocks.revision,
  watchHistorySourceScope: (_: unknown, invalidate: () => void) => {
    mocks.watch.mockImplementation(invalidate);
    return () => {};
  },
}));
vi.mock("../items/UserMessageItem", () => ({
  UserMessageItem: ({ content }: any) => (
    <p>{content.map((part: any) => part.text ?? part.path).join(" ")}</p>
  ),
}));
const receipt = (
  id = "source-one",
  clientId = "client-one",
  turnId = "turn-one",
) => ({
  sourceId: id,
  operationId: id,
  clientId,
  threadId: "thread",
  turnId,
  scope: "old-scope",
  namespace: "history-owner",
  createdAt: 1,
  status: "accepted",
  nativeIdentityUnique: true,
  text: "same accepted supplement",
  images: [],
});
const response = (data: any[], nextCursor: string | null = null) =>
  new Response(JSON.stringify({ data, nextCursor }), {
    headers: { "content-type": "application/json" },
  });
const event = (clientId: string, turnId = "turn-one") =>
  ({
    method: "item/completed",
    params: {
      threadId: "thread",
      turnId,
      item: { type: "userMessage", id: "native", clientId, content: [] },
    },
  }) as any;
beforeEach(() => {
  mocks.revision = 0;
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response([receipt()])),
  );
});
afterEach(() => vi.unstubAllGlobals());
it("keeps a second view's read alive when the first view of the same thread unmounts", async () => {
  vi.mocked(fetch)
    .mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init?.signal?.reason), { once: true });
    }))
    .mockResolvedValue(response([receipt()]));
  const props = { threadId: "thread", events: [], pendingClientIds: [], revision: 1 };
  const first = render(<CodexSteerReceipts {...props} />);
  const second = render(<CodexSteerReceipts {...props} />);
  try {
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    first.unmount();
    await waitFor(() => expect(second.getByText("same accepted supplement")).toBeTruthy());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(second.queryByRole("alert")).toBeNull();
  } finally {
    first.unmount();
    second.unmount();
  }
});

it("cancels only the queued view when it unmounts before admission", async () => {
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const props = { threadId: "thread", events: [], pendingClientIds: [], revision: 1 };
  const first = render(<CodexSteerReceipts {...props} />);
  const second = render(<CodexSteerReceipts {...props} />);
  try {
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    second.unmount();
    await act(async () => finish(response([receipt()])));
    await waitFor(() => expect(first.getByText("same accepted supplement")).toBeTruthy());
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    first.unmount();
    second.unmount();
  }
});

it("waits for the shared status worker without treating queue time as a read timeout", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const blocker = enqueueSessionRead(
    "status",
    "steer-test-occupied-worker",
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const view = render(
    <CodexSteerReceipts
      threadId="thread"
      events={[]}
      pendingClientIds={[]}
      revision={1}
    />,
  );
  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => {
      release();
      await blocker;
    });
    expect(screen.getByText("same accepted supplement")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    release();
    view.unmount();
    await blocker;
    vi.useRealTimers();
  }
});

it("reports a bounded admission timeout and permits an explicit retry", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const blocker = enqueueSessionRead(
    "status",
    "steer-test-admission-blocker",
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const view = render(
    <CodexSteerReceipts
      threadId="thread"
      events={[]}
      pendingClientIds={[]}
      revision={1}
    />,
  );
  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("排队超时");
    await act(async () => {
      release();
      await blocker;
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重新读取补充说明" }));
    });
    expect(screen.getByText("same accepted supplement")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    release();
    view.unmount();
    await blocker;
    vi.useRealTimers();
  }
});

it("times out an active read even if its transport ignores abort and frees the shared worker", async () => {
  vi.useFakeTimers();
  let release!: (value: Response) => void;
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const view = render(
    <CodexSteerReceipts
      threadId="thread"
      events={[]}
      pendingClientIds={[]}
      revision={1}
    />,
  );
  try {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });
    expect(screen.getByRole("alert").textContent).toContain("超时");
    let ran = false;
    const following = enqueueSessionRead(
      "status",
      "steer-test-next-worker",
      async () => {
        ran = true;
      },
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(ran).toBe(true);
    await following;
    const cancelLateBody = vi.fn();
    await act(async () => {
      release(new Response(new ReadableStream({ cancel: cancelLateBody })));
      await Promise.resolve();
    });
    expect(cancelLateBody).toHaveBeenCalledOnce();
    expect(screen.queryByText("same accepted supplement")).toBeNull();
  } finally {
    release?.(response([]));
    view.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    vi.useRealTimers();
  }
});

it("cancels a response body stalled after headers when the read deadline expires", async () => {
  vi.useFakeTimers();
  const cancelBody = vi.fn();
  vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"data":[')); },
    cancel: cancelBody,
  })));
  const view = render(<CodexSteerReceipts threadId="thread" events={[]} pendingClientIds={[]} revision={1} />);
  try {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(screen.getByRole("alert").textContent).toContain("超时");
    expect(cancelBody).toHaveBeenCalledOnce();
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});
it("restores explicitly marked accepted input after refresh with captured current scope, never treating old receipt scope as a new write", async () => {
  render(
    <CodexSteerReceipts
      threadId="thread"
      events={[]}
      pendingClientIds={[]}
      revision={1}
    />,
  );
  expect(await screen.findByText("same accepted supplement")).toBeTruthy();
  expect(screen.getByText("已发送的补充说明")).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain(
    "expectedScope=new-scope",
  );
  expect(vi.mocked(fetch).mock.calls[0][1]?.method).toBe("GET");
});
it("removes only exact native clientId+turn matches and does not deduplicate equal text or another turn", async () => {
  vi.mocked(fetch).mockImplementation(async () =>
    response([
      receipt(),
      receipt("source-two", "client-two"),
      receipt("source-three", "client-one", "turn-other"),
    ]),
  );
  const view = render(
    <CodexSteerReceipts
      threadId="thread"
      events={[event("client-one")]}
      pendingClientIds={[]}
      revision={1}
    />,
  );
  await waitFor(() =>
    expect(screen.getAllByText("same accepted supplement")).toHaveLength(2),
  );
  view.rerender(
    <CodexSteerReceipts
      threadId="thread"
      events={[event("client-one"), event("client-two")]}
      pendingClientIds={[]}
      revision={1}
    />,
  );
  await waitFor(() =>
    expect(screen.getAllByText("same accepted supplement")).toHaveLength(1),
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("replaces a bounded page and releases records when hidden, then restores without native resume or send", async () => {
  vi.mocked(fetch).mockImplementation(async (input) =>
    String(input).includes("cursor=older")
      ? response([{ ...receipt("older"), text: "older supplement" }])
      : response([receipt()], "older"),
  );
  const view = render(
    <TranscriptDetailVisibility.Provider value={true}>
      <CodexSteerReceipts
        threadId="thread"
        events={[]}
        pendingClientIds={[]}
        revision={1}
      />
    </TranscriptDetailVisibility.Provider>,
  );
  await screen.findByText("same accepted supplement");
  fireEvent.click(screen.getByRole("button", { name: "更早的补充说明" }));
  await screen.findByText("older supplement");
  expect(screen.queryByText("same accepted supplement")).toBeNull();
  view.rerender(
    <TranscriptDetailVisibility.Provider value={false}>
      <CodexSteerReceipts
        threadId="thread"
        events={[]}
        pendingClientIds={[]}
        revision={1}
      />
    </TranscriptDetailVisibility.Provider>,
  );
  expect(screen.queryByText("older supplement")).toBeNull();
  view.rerender(
    <TranscriptDetailVisibility.Provider value={true}>
      <CodexSteerReceipts
        threadId="thread"
        events={[]}
        pendingClientIds={[]}
        revision={1}
      />
    </TranscriptDetailVisibility.Provider>,
  );
  await screen.findByText("same accepted supplement");
  expect(
    vi
      .mocked(fetch)
      .mock.calls.every(([, options]) => options?.method === "GET"),
  ).toBe(true);
});
it("revokes a same-value account/read scope and ignores a late page", async () => {
  let resolve!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(
    <CodexSteerReceipts
      threadId="thread"
      events={[]}
      pendingClientIds={[]}
      revision={1}
    />,
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  act(() => {
    mocks.revision++;
    mocks.watch();
  });
  await act(async () => resolve(response([receipt()])));
  expect(screen.queryByText("same accepted supplement")).toBeNull();
  expect(
    screen.getByText("补充说明记录的连接已变化，请重新读取。"),
  ).toBeTruthy();
});
it("rejects an oversized page before parsing or rendering and allows explicit retry", async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response("{}", {
      headers: { "content-length": String(1024 * 1024 + 1) },
    }),
  );
  render(
    <CodexSteerReceipts
      threadId="thread"
      events={[]}
      pendingClientIds={[]}
      revision={1}
    />,
  );
  expect((await screen.findByRole("alert")).textContent).toContain("超过");
  expect(screen.queryByText("same accepted supplement")).toBeNull();
});

it("preserves distinct source receipts when native client identity is ambiguous, including duplicates outside the page", async () => {
  vi.mocked(fetch).mockImplementation(async () =>
    response([
      { ...receipt("source-one"), nativeIdentityUnique: false },
      { ...receipt("source-two"), nativeIdentityUnique: false },
    ]),
  );
  render(
    <CodexSteerReceipts
      threadId="thread"
      events={[event("client-one")]}
      pendingClientIds={["client-one"]}
      revision={1}
    />,
  );
  await waitFor(() =>
    expect(screen.getAllByText("same accepted supplement")).toHaveLength(2),
  );
});

it("retains readable native non-text references without fetching, decoding or executing them", async () => {
  vi.mocked(fetch).mockImplementation(async () =>
    response([
      {
        ...receipt(),
        text: "",
        nativeReferences: [
          { type: "image", url: "https://fixture.invalid/source.png" },
          { type: "audio", url: "https://fixture.invalid/voice.wav" },
          { type: "localAudio", path: "/fixture/voice.wav" },
          { type: "mention", name: "Original agent", path: "agent://original" },
          { type: "skill", name: "Original skill", path: "/fixture/SKILL.md" },
        ],
      },
    ]),
  );
  render(
    <CodexSteerReceipts
      threadId="thread"
      events={[]}
      pendingClientIds={[]}
      revision={1}
    />,
  );
  expect(
    await screen.findByText("https://fixture.invalid/source.png"),
  ).toBeTruthy();
  expect(screen.getByText("https://fixture.invalid/voice.wav")).toBeTruthy();
  expect(screen.getByText("/fixture/voice.wav")).toBeTruthy();
  expect(screen.getByText("Original agent · agent://original")).toBeTruthy();
  expect(screen.getByText("Original skill · /fixture/SKILL.md")).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("img")).toBeNull();
});
