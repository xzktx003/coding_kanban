import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  applyGroupAction,
  startSessionGroupsSync,
  type GroupAction,
} from "./session-groups-sync.js";
import type { SessionGroupState } from "./session-groups.js";

const OP_PREFIX = "coding-kanban-session-group-operation.";
const SNAPSHOT_PREFIX = "coding-kanban-session-group-snapshot.";
const LOCAL_KEY = "coding-kanban-session-groups-v1";

/**
 * A single shared store stands in for one browser profile: every page of that
 * browser observes the same keys, which is what cross-tab merging relies on.
 */
function installEnvironment(initial?: Record<string, string>) {
  const values = new Map<string, string>(Object.entries(initial ?? {}));
  let failWrites = false;
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const storage = {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error("quota exceeded");
      values.set(key, value);
    },
    removeItem: (key: string) => void values.delete(key),
  };
  const addEventListener = (type: string, listener: (event: unknown) => void) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(listener);
  };
  const removeEventListener = (
    type: string,
    listener: (event: unknown) => void,
  ) => void listeners.get(type)?.delete(listener);
  for (const [name, value] of [
    ["localStorage", storage],
    ["window", { addEventListener, removeEventListener }],
    ["document", { addEventListener, removeEventListener }],
  ] as const) {
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  return {
    values,
    listenerCount: () =>
      [...listeners.values()].reduce((total, set) => total + set.size, 0),
    emit(type: string, event: unknown) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
    breakWrites(broken: boolean) {
      failWrites = broken;
    },
    operations: () =>
      [...values.keys()].filter((key) => key.startsWith(OP_PREFIX)),
    snapshots: () =>
      [...values.keys()]
        .filter((key) => key.startsWith(SNAPSHOT_PREFIX))
        .map((key) => Number(key.slice(SNAPSHOT_PREFIX.length)))
        .sort((a, b) => a - b),
  };
}

type Call = { method: string; body: Record<string, unknown> | undefined };

/** Records every request so acknowledgement ordering can be asserted exactly. */
function recordingFetcher(
  reply: (call: Call, index: number) => { status?: number; json?: unknown },
) {
  const calls: Call[] = [];
  const fetcher = (async (_url: string, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? "GET",
      body:
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined,
    };
    calls.push(call);
    const { status = 200, json = {} } = reply(call, calls.length - 1);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

const snapshot = (
  revision: number,
  state: Partial<SessionGroupState> = {},
  extra: Record<string, unknown> = {},
) => ({
  initialized: true,
  revision,
  groups: [],
  assignments: {},
  collapsedGroupIds: [],
  ...state,
  ...extra,
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  for (const name of ["localStorage", "window", "document"]) {
    Reflect.deleteProperty(globalThis, name);
  }
});

describe("session group cross-device sync", () => {
  it("applies each action locally without resurrecting unknown groups", () => {
    const empty: SessionGroupState = {
      groups: [],
      assignments: {},
      collapsedGroupIds: [],
    };
    const added = applyGroupAction(empty, {
      type: "add",
      group: { id: "group-a", name: "A" },
      sessionKeys: ["session:one"],
    });
    assert.deepEqual(added.groups, [{ id: "group-a", name: "A" }]);
    assert.deepEqual(added.assignments, { "session:one": "group-a" });

    // Another device already removed the group, so the queued assign is a no-op
    // instead of recreating a grouping the user cannot see.
    assert.deepEqual(
      applyGroupAction(empty, {
        type: "assign",
        sessionKeys: ["session:one"],
        groupId: "group-a",
      }),
      empty,
    );
    // A stale assign must not strip the grouping the session already has: the
    // target group is simply gone, which is not a request to ungroup anything.
    const elsewhere = applyGroupAction(added, {
      type: "assign",
      sessionKeys: ["session:one"],
      groupId: "group-removed-elsewhere",
    });
    assert.deepEqual(elsewhere.assignments, { "session:one": "group-a" });
    assert.deepEqual(
      applyGroupAction(added, {
        type: "assign",
        sessionKeys: ["session:one"],
        groupId: null,
      }).assignments,
      {},
    );

    const collapsed = applyGroupAction(added, {
      type: "setCollapsed",
      key: "kanban:group:group-a",
      collapsed: true,
    });
    assert.deepEqual(collapsed.collapsedGroupIds, ["kanban:group:group-a"]);
    assert.deepEqual(
      applyGroupAction(collapsed, {
        type: "setCollapsed",
        key: "kanban:group:group-a",
        collapsed: false,
      }).collapsedGroupIds,
      [],
    );
  });

  it("shows a queued change immediately and clears only its own intent once acknowledged", async () => {
    const environment = installEnvironment();
    const states: SessionGroupState[] = [];
    const errors: (string | null)[] = [];
    const { calls, fetcher } = recordingFetcher((call) => {
      const operations = (call.body?.operations as { seq: number }[]) ?? [];
      return {
        json: snapshot(
          operations.length ? 2 : 1,
          operations.length ? { groups: [{ id: "group-a", name: "A" }] } : {},
          operations.length ? { sequence: 1 } : {},
        ),
      };
    });

    const sync = startSessionGroupsSync(
      (state) => states.push(state),
      (message) => errors.push(message),
      fetcher,
    );
    try {
      sync.dispatch({ type: "add", group: { id: "group-a", name: "A" } });
      // The intent is durable and visible before any acknowledgement arrives.
      assert.equal(environment.operations().length, 1);
      assert.deepEqual(sync.getState().groups, [{ id: "group-a", name: "A" }]);

      for (let attempt = 0; attempt < 40 && environment.operations().length; attempt++) {
        await settle();
      }
      assert.deepEqual(environment.operations(), []);
      assert.deepEqual(sync.getState().groups, [{ id: "group-a", name: "A" }]);
      assert.deepEqual(errors.at(-1), null);
      assert.ok(
        calls.some(
          (call) =>
            call.method === "POST" &&
            ((call.body?.operations as unknown[]) ?? []).length === 1,
        ),
        "the queued action must reach the server",
      );
      assert.deepEqual(environment.snapshots(), [2]);
    } finally {
      sync.stop();
    }
  });

  it("keeps an offline change queued, reports it, and replays it on reconnect", async () => {
    const environment = installEnvironment();
    const errors: (string | null)[] = [];
    let online = false;
    const { calls, fetcher } = recordingFetcher((call) => {
      if (!online) throw new Error("offline");
      const operations = (call.body?.operations as { seq: number }[]) ?? [];
      return {
        json: snapshot(
          3,
          { groups: [{ id: "group-b", name: "B" }] },
          operations.length ? { sequence: 1 } : {},
        ),
      };
    });

    const sync = startSessionGroupsSync(
      () => {},
      (message) => errors.push(message),
      fetcher,
    );
    try {
      sync.dispatch({ type: "add", group: { id: "group-b", name: "B" } });
      for (let attempt = 0; attempt < 40 && !errors.some(Boolean); attempt++) {
        await settle();
      }
      // The user is told sync is pending, and the change is neither lost nor
      // silently dropped from the visible grouping.
      assert.ok(errors.some((message) => typeof message === "string" && message));
      assert.equal(environment.operations().length, 1);
      assert.deepEqual(sync.getState().groups, [{ id: "group-b", name: "B" }]);

      online = true;
      const before = calls.length;
      environment.emit("online", {});
      for (
        let attempt = 0;
        attempt < 60 && (environment.operations().length || calls.length === before);
        attempt++
      ) {
        await settle();
      }
      assert.deepEqual(environment.operations(), []);
      assert.equal(errors.at(-1), null);
    } finally {
      sync.stop();
    }
  });

  it("adopts a newer snapshot and queued intent written by another page", async () => {
    const environment = installEnvironment();
    const states: SessionGroupState[] = [];
    let online = false;
    const { fetcher } = recordingFetcher(() => {
      if (!online) throw new Error("offline");
      return { json: snapshot(5) };
    });

    const sync = startSessionGroupsSync(
      (state) => states.push(state),
      () => {},
      fetcher,
    );
    try {
      // Another page of the same browser confirms a grouping and queues an edit.
      environment.values.set(
        `${SNAPSHOT_PREFIX}7`,
        JSON.stringify(
          snapshot(7, { groups: [{ id: "group-c", name: "C" }] }),
        ),
      );
      environment.values.set(
        `${OP_PREFIX}other-page`,
        JSON.stringify({
          id: "other-page",
          order: 1,
          action: {
            type: "assign",
            sessionKeys: ["session:two"],
            groupId: "group-c",
          } satisfies GroupAction,
        }),
      );
      environment.emit("storage", { key: `${SNAPSHOT_PREFIX}7` });
      for (let attempt = 0; attempt < 40 && !sync.getState().groups.length; attempt++) {
        await settle();
      }

      assert.deepEqual(sync.getState().groups, [{ id: "group-c", name: "C" }]);
      assert.deepEqual(sync.getState().assignments, {
        "session:two": "group-c",
      });
      // The shared local copy is what a cold start of this browser reads next.
      assert.deepEqual(
        JSON.parse(environment.values.get(LOCAL_KEY) ?? "{}").assignments,
        { "session:two": "group-c" },
      );
    } finally {
      sync.stop();
    }
  });

  it("reports an unusable local store instead of dropping the change silently", async () => {
    const environment = installEnvironment();
    const errors: (string | null)[] = [];
    const { calls, fetcher } = recordingFetcher(() => ({ json: snapshot(1) }));
    const sync = startSessionGroupsSync(
      () => {},
      (message) => errors.push(message),
      fetcher,
    );
    try {
      environment.breakWrites(true);
      sync.dispatch({ type: "add", group: { id: "group-d", name: "D" } });
      assert.ok(
        errors.some((message) => typeof message === "string" && message),
        "a failed local write must surface to the user",
      );
      assert.deepEqual(environment.operations(), []);
      const before = calls.length;
      await settle();
      // A change that was never recorded must not be invented on the server.
      assert.ok(
        calls
          .slice(before)
          .every(
            (call) => ((call.body?.operations as unknown[]) ?? []).length === 0,
          ),
      );
    } finally {
      environment.breakWrites(false);
      sync.stop();
    }
  });

  it("stops every listener and timer when the page unmounts", async () => {
    const environment = installEnvironment();
    const { calls, fetcher } = recordingFetcher(() => ({ json: snapshot(1) }));
    const sync = startSessionGroupsSync(
      () => {},
      () => {},
      fetcher,
    );
    assert.ok(environment.listenerCount() > 0);
    sync.stop();
    const before = calls.length;
    environment.emit("online", {});
    for (let attempt = 0; attempt < 10; attempt++) await settle();
    assert.equal(environment.listenerCount(), 0);
    assert.equal(calls.length, before);
  });
});
