import { beforeEach, expect, test } from "vitest";
import {
  MANAGEMENT_CONFIRMATION_PREFIX,
  SessionManagementSync,
} from "./sessionManagementSync";
import type { SharedSessionManagement } from "@agent-orchestrator/shared";

const snapshot = (namespace = "account-a"): SharedSessionManagement => ({
  revision: 0,
  operationWindow: { id: "window", expiresAt: Date.now() + 600_000 },
  namespaces: { codex: namespace, cc: "board", acp: "board" },
  entries: [],
});
beforeEach(() => localStorage.clear());

test("the originating page can read the exact ACK consumed by a second page without posting again", async () => {
  let posts = 0;
  const entry = {
    namespace: "account-a",
    kind: "codex" as const,
    id: "shared-pin",
    revision: 1,
    pinRevision: 1,
    pinned: true,
    manualUnreadRevision: 0,
    completed: [],
    read: [],
  };
  const fetcher: typeof fetch = async (_url, init) => {
    if (init?.method === "POST") posts++;
    return Response.json({
      ...snapshot(),
      entries: init?.method === "POST" ? [entry] : [],
      operationStatus: "done",
    });
  };
  const origin = new SessionManagementSync({
      storage: localStorage,
      fetch: fetcher,
    }),
    consumer = new SessionManagementSync({
      storage: localStorage,
      fetch: fetcher,
    });
  await Promise.all([origin.syncOnce(), consumer.syncOnce()]);
  const operation = origin.record("codex", "shared-pin", () => ({
    type: "pin",
    value: true,
    expectedRevision: 0,
  }));
  await consumer.syncOnce();
  expect(origin.pending()).toHaveLength(0);
  expect(await origin.confirmation(operation, 200)).toEqual({
    namespace: "account-a",
    entry,
  });
  expect(posts).toBe(1);
});

test("a pin operation captures its account, revision and original window before transmission", async () => {
  const requests: any[] = [];
  const sync = new SessionManagementSync({
    storage: localStorage,
    fetch: async (_url, init) => {
      if (init?.method === "POST") requests.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({ ...snapshot(), operationStatus: "done" }),
      );
    },
  });
  await sync.syncOnce();
  sync.record("codex", "same-id", (entry) => ({
    type: "pin",
    value: true,
    expectedRevision: entry?.pinRevision ?? 0,
  }));
  expect(sync.pending()[0].target.namespace).toBe("account-a");
  expect(localStorage.length).toBe(1);
  await sync.syncOnce();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    windowId: "window",
    target: { namespace: "account-a", kind: "codex", id: "same-id" },
  });
  expect(sync.pending()).toHaveLength(0);
});

test("account changes quarantine old intentions instead of assigning them to the new account", async () => {
  let account = "account-a";
  let posts = 0;
  const sync = new SessionManagementSync({
    storage: localStorage,
    fetch: async (_url, init) => {
      if (init?.method === "POST") posts++;
      return new Response(JSON.stringify(snapshot(account)));
    },
  });
  await sync.syncOnce();
  sync.record("codex", "same-id", () => ({ type: "unread" }));
  account = "account-b";
  await sync.syncOnce();
  expect(posts).toBe(0);
  expect(sync.pending()[0].target.namespace).toBe("account-a");
  expect(sync.pending()[0].state).toBe("blocked");
});

test("expired windows and native unknown receipts never silently obtain a new retry identity", async () => {
  const saved = snapshot();
  let unknown = false;
  let posts = 0;
  const sync = new SessionManagementSync({
    storage: localStorage,
    fetch: async (_url, init) => {
      if (init?.method === "POST") posts++;
      return new Response(
        JSON.stringify({
          ...saved,
          operationStatus: unknown ? "unknown" : "done",
        }),
      );
    },
  });
  await sync.syncOnce();
  sync.record("codex", "a", () => ({ type: "unread" }));
  unknown = true;
  await sync.syncOnce();
  await sync.syncOnce();
  expect(posts).toBe(1);
  expect(sync.pending()[0].state).toBe("unknown");
});

test("separate operation keys preserve simultaneous page intents and sequence their optimistic revisions", async () => {
  const fetcher = async () => new Response(JSON.stringify(snapshot()));
  const a = new SessionManagementSync({
    storage: localStorage,
    fetch: fetcher,
  });
  const b = new SessionManagementSync({
    storage: localStorage,
    fetch: fetcher,
  });
  await Promise.all([a.syncOnce(), b.syncOnce()]);
  a.record("codex", "a", (entry) => ({
    type: "pin",
    value: true,
    expectedRevision: entry?.pinRevision ?? 0,
  }));
  b.record("codex", "a", (entry) => ({
    type: "pin",
    value: false,
    expectedRevision: entry?.pinRevision ?? 0,
  }));
  expect(a.pending()).toHaveLength(2);
  expect(b.pending()[1].action).toMatchObject({ expectedRevision: 1 });
});

test("the same snapshot does not repeatedly notify consumers and storage failure prevents sending", async () => {
  let notifications = 0;
  const value = snapshot();
  const sync = new SessionManagementSync({
    storage: localStorage,
    fetch: async () => new Response(JSON.stringify(value)),
    apply: () => notifications++,
  });
  await sync.syncOnce();
  await sync.syncOnce();
  expect(notifications).toBe(1);
  const broken = new SessionManagementSync({
    storage: {
      ...localStorage,
      length: 0,
      key: () => null,
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    },
    fetch: async () => new Response(JSON.stringify(value)),
  });
  await broken.syncOnce();
  expect(() => broken.record("codex", "a", () => ({ type: "unread" }))).toThrow(
    /保存/,
  );
});

test("an older pending automatic read never optimistically overrides a newer manual unread", async () => {
  let value: SharedSessionManagement = {
    ...snapshot(),
    entries: [
      {
        namespace: "account-a",
        kind: "codex",
        id: "a",
        revision: 0,
        pinRevision: 0,
        pinned: false,
        manualUnreadRevision: 0,
        completed: [{ id: "reply", at: 1 }],
        read: [],
      },
    ],
  };
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const posting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const sync = new SessionManagementSync({
    storage: localStorage,
    fetch: async (_url, init) => {
      if (init?.method === "POST") {
        started();
        await gate;
        return new Response(JSON.stringify({ error: "Newer manual unread" }), {
          status: 409,
        });
      }
      return new Response(JSON.stringify(value));
    },
  });
  await sync.syncOnce();
  sync.record("codex", "a", () => ({
    type: "read",
    replyId: "reply",
    manualUnreadRevision: 0,
  }));
  value = {
    ...value,
    revision: 1,
    entries: [{ ...value.entries[0], revision: 1, manualUnreadRevision: 1 }],
  };
  const pending = sync.syncOnce();
  try {
    await posting;
    expect(sync.projection()?.entries[0].read).toEqual([]);
  } finally {
    release();
    await pending;
    sync.close();
  }
});

test("browser fetch is invoked as a function rather than with the sync instance as its receiver", async () => {
  const receivers: unknown[] = [];
  const fetcher: typeof fetch = async function (this: unknown) {
    receivers.push(this);
    if (this !== undefined) throw new TypeError("Illegal invocation");
    return new Response(JSON.stringify(snapshot()));
  };
  const sync = new SessionManagementSync({
    storage: localStorage,
    fetch: fetcher,
  });
  await sync.syncOnce();
  expect(sync.projection()?.namespaces.codex).toBe("account-a");
  expect(receivers).toEqual([undefined]);
});

test("a successful unchanged snapshot clears an earlier transport error without republishing data", async () => {
  let fail = false,
    error: string | undefined,
    notifications = 0;
  const value = snapshot();
  const sync = new SessionManagementSync({
    storage: localStorage,
    fetch: async () => {
      if (fail) throw new Error("offline");
      return new Response(JSON.stringify(value));
    },
    apply: () => notifications++,
    error: (message) => {
      error = message;
    },
    success: () => {
      error = undefined;
    },
  });
  await sync.syncOnce();
  fail = true;
  await sync.syncOnce();
  expect(error).toBe("offline");
  fail = false;
  await sync.syncOnce();
  expect(error).toBeUndefined();
  expect(notifications).toBe(1);
});

test.each(["target", "window", "action"])(
  "cross-page management ACK rejects changed %s provenance without another POST",
  async (changed) => {
    let posts = 0;
    const fetcher: typeof fetch = async (_url, init) => {
      if (init?.method === "POST") posts++;
      return Response.json({ ...snapshot(), operationStatus: "done" });
    };
    const origin = new SessionManagementSync({
        storage: localStorage,
        fetch: fetcher,
      }),
      consumer = new SessionManagementSync({
        storage: localStorage,
        fetch: fetcher,
      });
    await Promise.all([origin.syncOnce(), consumer.syncOnce()]);
    const id = origin.record("codex", "original-thread", () => ({
      type: "pin",
      value: true,
      expectedRevision: 0,
    }));
    await consumer.syncOnce();
    const key = MANAGEMENT_CONFIRMATION_PREFIX + id,
      saved = JSON.parse(localStorage.getItem(key)!);
    if (changed === "target") saved.target.id = "other-thread";
    else {
      const intent = JSON.parse(saved.intent);
      if (changed === "window") intent.windowId = "other-window";
      else intent.action.value = false;
      saved.intent = JSON.stringify(intent);
    }
    localStorage.setItem(key, JSON.stringify(saved));
    await expect(origin.confirmation(id, 200)).rejects.toThrow(/身份|原操作/);
    expect(posts).toBe(1);
  },
);

test("cross-page ACK cannot authorize the originating action after an account switch", async () => {
  let account = "account-a",
    posts = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    if (init?.method === "POST") posts++;
    return Response.json({ ...snapshot(account), operationStatus: "done" });
  };
  const origin = new SessionManagementSync({
      storage: localStorage,
      fetch: fetcher,
    }),
    consumer = new SessionManagementSync({
      storage: localStorage,
      fetch: fetcher,
    });
  await Promise.all([origin.syncOnce(), consumer.syncOnce()]);
  const id = origin.record("codex", "same-thread", () => ({
    type: "pin",
    value: true,
    expectedRevision: 0,
  }));
  await consumer.syncOnce();
  account = "account-b";
  await origin.syncOnce();
  await expect(origin.confirmation(id, 200)).rejects.toThrow(/账号范围/);
  expect(posts).toBe(1);
});
