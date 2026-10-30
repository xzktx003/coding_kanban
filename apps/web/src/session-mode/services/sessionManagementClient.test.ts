import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SessionManagement } from "../../../../server/src/services/session-management";
import { usePinStore } from "../stores/usePinStore";
import { useSessionAttentionStore } from "../stores/useSessionAttentionStore";
import { MANAGEMENT_OPERATION_PREFIX } from "./sessionManagementSync";
import {
  startSessionManagementSync,
  setSharedSessionUnread,
  markSharedSessionsRead,
} from "./sessionManagementClient";

let close: (() => void) | undefined;
beforeEach(() => {
  localStorage.clear();
  usePinStore.setState({ pinned: [] });
  useSessionAttentionStore.setState({ receipts: {} });
  vi.useFakeTimers();
});
afterEach(() => {
  close?.();
  close = undefined;
  vi.useRealTimers();
});

test("actual store actions sync through the real management service without snapshot feedback", async () => {
  const backend = new SessionManagement({
    accountScope: async () => "account-a",
  });
  const writes: any[] = [];
  close = startSessionManagementSync(async (_url, init) => {
    const value =
      init?.method === "POST" ? JSON.parse(String(init.body)) : undefined;
    if (value) writes.push(value);
    return new Response(
      JSON.stringify(
        value ? await backend.apply(value) : await backend.snapshot(),
      ),
    );
  }, 100);
  await vi.advanceTimersByTimeAsync(1);
  usePinStore
    .getState()
    .togglePin({ kind: "codex", id: "a", title: "a", cwd: "/project" });
  await vi.advanceTimersByTimeAsync(50);
  expect(writes.filter((w) => w.action.type === "pin")).toHaveLength(1);
  expect((await backend.snapshot()).entries[0]).toMatchObject({
    pinned: true,
    pinRevision: 1,
  });
  useSessionAttentionStore.getState().complete("codex", "a", "reply");
  await vi.advanceTimersByTimeAsync(50);
  useSessionAttentionStore.getState().read("codex", "a", "reply");
  await vi.advanceTimersByTimeAsync(50);
  useSessionAttentionStore.getState().markUnread("codex", "a");
  await vi.advanceTimersByTimeAsync(50);
  const count = writes.length;
  await vi.advanceTimersByTimeAsync(500);
  expect(writes).toHaveLength(count);
  expect((await backend.snapshot()).entries[0]).toMatchObject({
    manualUnreadRevision: 1,
    read: [],
  });
  expect(
    Object.keys(localStorage).filter((k) =>
      k.startsWith(MANAGEMENT_OPERATION_PREFIX),
    ),
  ).toEqual([]);
});

test("restored account namespaces isolate equal thread ids while retaining local recovery metadata", async () => {
  let account = "account-a";
  const backend = new SessionManagement({ accountScope: async () => account });
  close = startSessionManagementSync(
    async (_url, init) =>
      new Response(
        JSON.stringify(
          init?.method === "POST"
            ? await backend.apply(JSON.parse(String(init.body)))
            : await backend.snapshot(),
        ),
      ),
    100,
  );
  await vi.advanceTimersByTimeAsync(1);
  useSessionAttentionStore
    .getState()
    .complete("codex", "same", "account-a-reply");
  await vi.advanceTimersByTimeAsync(50);
  close();
  close = undefined;
  account = "account-b";
  close = startSessionManagementSync(
    async () => new Response(JSON.stringify(await backend.snapshot())),
    100,
  );
  await vi.advanceTimersByTimeAsync(1);
  expect(
    useSessionAttentionStore.getState().receipts["codex:same"],
  ).toBeUndefined();
  expect(
    localStorage.getItem("kanban.session.management.legacy.codex"),
  ).toContain("account-a-reply");
});

test("the first confirmed namespace quarantines unscoped legacy receipts without uploading them", async () => {
  useSessionAttentionStore.setState({
    receipts: {
      "codex:same": { completed: [{ id: "legacy-reply", at: 1 }], read: [] },
    },
  });
  const backend = new SessionManagement({
    accountScope: async () => "new-account",
  });
  const writes: unknown[] = [];
  close = startSessionManagementSync(async (_url, init) => {
    if (init?.method === "POST") writes.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify(await backend.snapshot()));
  }, 100);
  await vi.advanceTimersByTimeAsync(10);
  expect(
    useSessionAttentionStore.getState().receipts["codex:same"],
  ).toBeUndefined();
  expect(
    localStorage.getItem("kanban.session.management.legacy.codex"),
  ).toContain("legacy-reply");
  expect(writes).toEqual([]);
});

test("an explicit native unread captures the original revision and waits for its shared receipt", async () => {
  const native: unknown[] = [];
  const backend = new SessionManagement({
    accountScope: async () => "account-a",
    nativeRead: async (...args) => {
      native.push(args);
    },
  });
  const initial = await backend.snapshot();
  const target = {
    namespace: initial.namespaces.codex!,
    kind: "codex" as const,
    id: "a",
  };
  await backend.apply({
    operationId: "initial-complete",
    target,
    action: { type: "complete", replyId: "reply" },
  });
  await backend.apply({
    operationId: "initial-read",
    target,
    action: { type: "read", replyId: "reply", manualUnreadRevision: 0, nativeReadRevision: "seed-revision", nativeScope: "seed-scope" },
  });
  native.length = 0; // The fixture's prior explicit read is outside the operation under test.
  close = startSessionManagementSync(async (url, init) => {
    if (String(url).includes("/read-context?"))
      return new Response(
        JSON.stringify({
          revision: "original-native-revision",
          scope: "account-scope",
          replyId: "reply",
        }),
      );
    return new Response(
      JSON.stringify(
        init?.method === "POST"
          ? await backend.apply(JSON.parse(String(init.body)))
          : await backend.snapshot(),
      ),
    );
  }, 100);
  await vi.advanceTimersByTimeAsync(10);
  const result = setSharedSessionUnread("codex", "a");
  await vi.advanceTimersByTimeAsync(100);
  expect(await result).toBe(true);
  expect(native).toEqual([
    [target, "original-native-revision", "unread", "account-scope"],
  ]);
  expect((await backend.snapshot()).entries[0]).toMatchObject({
    manualUnreadRevision: 1,
    read: [],
  });
});

test("explicit mark-all-read captures a separate native proof for each original target", async () => {
  const native: unknown[] = [];
  const backend = new SessionManagement({
    accountScope: async () => "account-a",
    nativeRead: async (...args) => {
      native.push(args);
    },
  });
  const initial = await backend.snapshot();
  for (const id of ["a", "b"])
    await backend.apply({
      operationId: `complete-${id}`,
      target: { namespace: initial.namespaces.codex!, kind: "codex", id },
      action: { type: "complete", replyId: `reply-${id}` },
    });
  close = startSessionManagementSync(async (url, init) => {
    if (String(url).includes("/read-context?")) {
      const query = new URL(String(url), "http://fixture").searchParams;
      return new Response(
        JSON.stringify({
          revision: `revision-${query.get("threadId")}`,
          scope: "account-scope",
          replyId: query.get("replyId"),
        }),
      );
    }
    return new Response(
      JSON.stringify(
        init?.method === "POST"
          ? await backend.apply(JSON.parse(String(init.body)))
          : await backend.snapshot(),
      ),
    );
  }, 100);
  await vi.advanceTimersByTimeAsync(10);
  const result = markSharedSessionsRead(["a", "b", "a"]);
  await vi.advanceTimersByTimeAsync(500);
  expect(await result).toBe(2);
  expect(native).toEqual(
    ["a", "b"].map((id) => [
      { namespace: initial.namespaces.codex!, kind: "codex", id },
      `revision-${id}`,
      "read",
      "account-scope",
    ]),
  );
  expect((await backend.snapshot()).entries.map((entry) => entry.read)).toEqual(
    [["reply-a"], ["reply-b"]],
  );
});

test("a late native proof cannot move an old unread intent into a newly selected account", async () => {
  let account = "account-a",
    release!: () => void;
  const native: unknown[] = [],
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
  const backend = new SessionManagement({
    accountScope: async () => account,
    nativeRead: async (...args) => {
      native.push(args);
    },
  });
  const initial = await backend.snapshot(),
    target = {
      namespace: initial.namespaces.codex!,
      kind: "codex" as const,
      id: "same",
    };
  await backend.apply({
    operationId: "complete",
    target,
    action: { type: "complete", replyId: "old-reply" },
  });
  close = startSessionManagementSync(async (url, init) => {
    if (String(url).includes("/read-context?")) {
      await gate;
      return new Response(
        JSON.stringify({
          revision: "old-revision",
          scope: "old-scope",
          replyId: "old-reply",
        }),
      );
    }
    return new Response(
      JSON.stringify(
        init?.method === "POST"
          ? await backend.apply(JSON.parse(String(init.body)))
          : await backend.snapshot(),
      ),
    );
  }, 100);
  await vi.advanceTimersByTimeAsync(10);
  const pending = setSharedSessionUnread("codex", "same");
  const rejected = expect(pending).rejects.toThrow(/账号范围已变化/);
  account = "account-b";
  await vi.advanceTimersByTimeAsync(150);
  release();
  await rejected;
  expect(native).toEqual([]);
  expect((await backend.snapshot()).entries).toEqual([]);
});
