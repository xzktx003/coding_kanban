import "fake-indexeddb/auto";
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  cacheSerializedJsonUtf8ByteLength,
  cacheSerializedUtf8ByteLength,
  readTranscriptCache,
  writeTranscriptCache,
  saveReadingPosition,
  getReadingPosition,
} from "./sessionTranscriptCache";
import { invalidateTranscriptCache } from "./sessionCacheState";
import { startSessionTranscriptCache } from "./sessionTranscriptCache";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { useCodexStore } from "../components/codex/stores";
import {
  trackCodexTranscript,
  markCodexTranscriptDormant,
  forgetCodexTranscript,
} from "./codexTranscriptActivity";
import type { ServerNotification } from "../bindings";
import { useServerNotificationHandler } from "../components/codex/hooks/useServerNotificationHandler";
import { invalidateCodexOperationScope } from "./codexOperationScope";
import { usePairingStore } from "../stores/usePairingStore";
vi.mock("@session/services/apiAdapt/codex", () => ({
  allowSleep: vi.fn().mockResolvedValue(undefined),
  preventSleep: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@session/lib/notify", () => ({ notifyDesktop: vi.fn() }));
const visibleReply = {
  method: "item/completed",
  params: {
    threadId: "cache",
    turnId: "t",
    item: { type: "agentMessage", id: "final", text: "Final reply" },
  },
} as ServerNotification;

const cacheJsonReplacer = (_key: string, value: unknown) =>
  typeof value === "bigint" ? value.toString() : value;

async function readStoredTranscriptCache(key: string) {
  return await new Promise<any>((resolve, reject) => {
    const open = indexedDB.open("kanban.session.transcripts.v1", 2);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("transcripts", "readonly");
      const request = tx.objectStore("transcripts").get(key);
      let result: unknown;
      request.onsuccess = () => (result = request.result);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

it.each([
  { label: "ASCII and controls", value: 'ASCII\u0000\n\t\\"' },
  { label: "two-byte code points", value: "é\u07ff" },
  { label: "three-byte code points", value: "会话\u0800" },
  { label: "non-BMP and combining marks", value: "🙂e\u0301" },
  { label: "lone high surrogate", value: "before\ud800after" },
  { label: "lone low surrogate", value: "before\udc00after" },
  { label: "unpaired surrogates around a pair", value: "\ud800🙂\udc00" },
])("counts exact UTF-8 bytes for $label", ({ value }) => {
  const encoder = new TextEncoder();
  const serialized = JSON.stringify(
    { value, nativeCounter: 9_007_199_254_740_995n },
    cacheJsonReplacer,
  );
  expect(cacheSerializedUtf8ByteLength(value)).toBe(
    encoder.encode(value).byteLength,
  );
  expect(cacheSerializedUtf8ByteLength(serialized)).toBe(
    encoder.encode(serialized).byteLength,
  );
});

it("matches native JSON UTF-8 byte counts for bounded randomized values", () => {
  const encoder = new TextEncoder();
  const random = (() => {
    let state = 0x8badf00d;
    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 0x1_0000_0000;
    };
  })();
  const tokens = [
    "a",
    "Z",
    "é",
    "漢",
    "😀",
    "\\",
    '"',
    "\n",
    "\t",
    "\0",
    "\x1f",
    "\u2028",
    String.fromCharCode(0xd800),
    String.fromCharCode(0xdc00),
    "\ud83d\ude80",
  ];
  const randomString = () => {
    const count = Math.floor(random() * 32);
    let text = "";
    for (let index = 0; index < count; index++)
      text += tokens[Math.floor(random() * tokens.length)];
    return text;
  };
  const randomValue = (depth = 0): unknown => {
    const kind = Math.floor(random() * (depth > 3 ? 10 : 13));
    if (kind === 0) return null;
    if (kind === 1) return random() < 0.5;
    if (kind === 2) return (random() - 0.5) * 1e9;
    if (kind === 3)
      return [NaN, Infinity, -Infinity, -0][Math.floor(random() * 4)];
    if (kind === 4) return randomString();
    if (kind === 5)
      return BigInt(Math.floor(random() * 1e9)) * -900719925474099312345n;
    if (kind === 6) return undefined;
    if (kind === 7) return Symbol(randomString());
    if (kind === 8) return () => randomString();
    if (kind === 9) return new String(randomString());
    if (depth > 3) return randomString();
    if (kind === 10) {
      const array: unknown[] = [];
      const count = Math.floor(random() * 8);
      for (let index = 0; index < count; index++) {
        if (random() < 0.2) array.length++;
        else array.push(randomValue(depth + 1));
      }
      return array;
    }
    if (kind === 11) {
      const nested = randomValue(depth + 1);
      const text = randomString();
      return {
        toJSON(key: string) {
          return { key, nested, text };
        },
      };
    }
    const object = Object.create(null) as Record<string, unknown>;
    const count = Math.floor(random() * 9);
    for (let index = 0; index < count; index++)
      object[randomString()] = randomValue(depth + 1);
    return object;
  };

  for (let index = 0; index < 1600; index++) {
    const value = randomValue();
    const serialized = JSON.stringify(value, cacheJsonReplacer);
    if (serialized === undefined) {
      expect(() => cacheSerializedJsonUtf8ByteLength(value)).toThrow(TypeError);
    } else {
      expect(cacheSerializedJsonUtf8ByteLength(value)).toBe(
        encoder.encode(serialized).byteLength,
      );
    }
  }

  const observedCalls: string[] = [];
  const observed = {
    toJSON(key: string) {
      observedCalls.push(`toJSON:${key}`);
      return {
        first: "before",
        get second() {
          observedCalls.push("getter:second");
          return "getter value 😀";
        },
        last: 23n,
      };
    },
  };
  const expectedCalls: string[] = [];
  const expected = {
    toJSON(key: string) {
      expectedCalls.push(`toJSON:${key}`);
      return {
        first: "before",
        get second() {
          expectedCalls.push("getter:second");
          return "getter value 😀";
        },
        last: 23n,
      };
    },
  };
  const expectedJson = JSON.stringify(expected, cacheJsonReplacer)!;
  expect(cacheSerializedJsonUtf8ByteLength(observed)).toBe(
    encoder.encode(expectedJson).byteLength,
  );
  expect(observedCalls).toEqual(expectedCalls);
  expect(() => cacheSerializedJsonUtf8ByteLength(Object(12n))).toThrow(
    TypeError,
  );
  expect(() => cacheSerializedJsonUtf8ByteLength(undefined)).toThrow(TypeError);
  expect(() =>
    cacheSerializedJsonUtf8ByteLength({ toJSON: () => undefined }),
  ).toThrow(TypeError);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(() => cacheSerializedJsonUtf8ByteLength(cyclic)).toThrow(TypeError);
  const throwingGetter = Object.defineProperty({}, "value", {
    enumerable: true,
    get() {
      throw new RangeError("getter sentinel");
    },
  });
  expect(() => cacheSerializedJsonUtf8ByteLength(throwingGetter)).toThrow(
    RangeError,
  );
});

it("counts exact 2 MiB cache records and 30 MiB aggregate boundaries", () => {
  const recordBudget = 2 * 1024 * 1024;
  const totalBudget = 30 * 1024 * 1024;
  const prefix = '{"v":"';
  const suffix = '"}';
  const jsonAtBytes = (bytes: number) =>
    `${prefix}${"x".repeat(bytes - prefix.length - suffix.length)}${suffix}`;
  const exactRecord = jsonAtBytes(recordBudget);
  const oneByteOverRecord = jsonAtBytes(recordBudget + 1);
  const encoder = new TextEncoder();

  expect(cacheSerializedUtf8ByteLength(exactRecord)).toBe(recordBudget);
  expect(cacheSerializedUtf8ByteLength(exactRecord)).toBe(
    encoder.encode(exactRecord).byteLength,
  );
  expect(cacheSerializedUtf8ByteLength(oneByteOverRecord)).toBe(
    recordBudget + 1,
  );
  const aggregate = Array.from({ length: totalBudget / recordBudget }, () =>
    cacheSerializedUtf8ByteLength(exactRecord),
  ).reduce((sum, bytes) => sum + bytes, 0);
  expect(aggregate).toBe(totalBudget);
  expect(aggregate + cacheSerializedUtf8ByteLength("x")).toBe(totalBudget + 1);
});

it("keeps cached JSON byte accounting exact across write and read with Unicode and BigInt", async () => {
  const key = "codex:utf8-cache-accounting";
  const text = "ASCII|é|会话|🙂|e\u0301|\ud800|\udc00|\u0000";
  const nativeCounter = 9_007_199_254_740_995n;
  const source = {
    key,
    savedAt: Date.now(),
    cursor: `cursor-${text}`,
    thread: {
      id: key,
      turns: [],
      status: { type: "idle" },
      nativeCounter,
    },
    events: [
      {
        method: "item/completed",
        params: {
          threadId: key.slice("codex:".length),
          turnId: "unicode-turn",
          item: { type: "agentMessage", id: "unicode-reply", text },
        },
      },
    ],
  } as any;
  await writeTranscriptCache(source);

  const persisted = await readStoredTranscriptCache(key);
  expect(persisted).toBeDefined();
  const { bytes: writeBytes, ...writePayload } = persisted;
  const writeJson = JSON.stringify(writePayload, cacheJsonReplacer);
  expect(writeBytes).toBe(cacheSerializedUtf8ByteLength(writeJson));
  expect(writeBytes).toBe(new TextEncoder().encode(writeJson).byteLength);

  const cached = await readTranscriptCache(key);
  expect((cached?.thread as any)?.nativeCounter).toBe(nativeCounter);
  expect((cached?.events?.[0]?.params as any).item.text).toBe(text);
  const readJson = JSON.stringify(
    { ...cached, bytes: writeBytes },
    cacheJsonReplacer,
  );
  expect(cached?.bytes).toBe(cacheSerializedUtf8ByteLength(readJson));
  expect(cached?.bytes).toBe(new TextEncoder().encode(readJson).byteLength);
});

it("counts large cache bodies without materializing them in read or write JSON", async () => {
  const key = "codex:skeleton-cache-accounting";
  const text = 'A🙂\ud800\\\n"'.repeat(32 * 1024);
  const nativeCounter = 9_007_199_254_740_995n;
  const source = {
    key,
    savedAt: Date.now(),
    thread: {
      id: key.slice("codex:".length),
      turns: [],
      status: { type: "idle" },
      nativeCounter,
    },
    events: [
      {
        method: "item/completed",
        params: {
          threadId: key.slice("codex:".length),
          turnId: "large-body-turn",
          item: { type: "agentMessage", id: "large-body-reply", text },
        },
      },
    ],
  } as any;
  const originalStringify = JSON.stringify;
  const materializedJsonLengths: number[] = [];
  JSON.stringify = ((value: unknown, ...args: unknown[]) => {
    const serialized = originalStringify(value, ...(args as []));
    if ((value as { key?: unknown } | null)?.key === key && serialized)
      materializedJsonLengths.push(serialized.length);
    return serialized;
  }) as typeof JSON.stringify;
  let cached: Awaited<ReturnType<typeof readTranscriptCache>>;
  try {
    await writeTranscriptCache(source);
    expect(materializedJsonLengths).toHaveLength(1);
    materializedJsonLengths.length = 0;
    cached = await readTranscriptCache(key);
  } finally {
    JSON.stringify = originalStringify;
  }

  expect(materializedJsonLengths).toHaveLength(1);
  expect(materializedJsonLengths[0]).toBeLessThan(text.length / 2);
  expect(cached?.events?.[0]).toMatchObject({
    method: "item/completed",
    params: { item: { type: "agentMessage", text } },
  });
  expect((cached?.thread as any)?.nativeCounter).toBe(nativeCounter);

  const persisted = await readStoredTranscriptCache(key);
  expect(persisted.events[0].params.item.text).toBe(text);
  expect(persisted.thread.nativeCounter).toBe(nativeCounter);
  const { bytes, ...payload } = persisted;
  expect(bytes).toBe(
    cacheSerializedUtf8ByteLength(JSON.stringify(payload, cacheJsonReplacer)),
  );
  const readPayload = { ...cached, bytes };
  expect(cached?.bytes).toBe(
    cacheSerializedUtf8ByteLength(
      JSON.stringify(readPayload, cacheJsonReplacer),
    ),
  );
});

it("restores the selected recent page first even when it is the last followed cache", async () => {
  const ids = Array.from(
    { length: 5 },
    (_, index) => `cache-priority-${index}`,
  );
  const cards = ids.map((id) => ({ kind: "codex" as const, id, cwd: "/repo" }));
  useAgentCenterStore.setState({
    cards,
    currentAgentCardId: ids[4],
    currentAgentCardKind: "codex",
    detachedCard: null,
  });
  for (const id of ids)
    await writeTranscriptCache({
      key: `codex:${id}`,
      savedAt: Date.now(),
      events: Array.from({ length: 40 }, (_, index) => ({
        method: "item/completed",
        params: {
          threadId: id,
          turnId: `t${index}`,
          item: {
            type: "agentMessage",
            id: `m${index}`,
            text: "history ".repeat(512),
          },
        },
      })) as ServerNotification[],
    });
  const order: string[] = [];
  const get = IDBObjectStore.prototype.get;
  const spy = vi
    .spyOn(IDBObjectStore.prototype, "get")
    .mockImplementation(function (this: IDBObjectStore, key) {
      if (this.name === "transcripts") order.push(String(key));
      return get.call(this, key);
    });
  const stop = startSessionTranscriptCache();
  try {
    await vi.waitFor(() =>
      expect(
        ids.every((id) => useCodexStore.getState().historyLoadedMap[id]),
      ).toBe(true),
    );
    expect(order[0]).toBe(`codex:${ids[4]}`);
    expect(new Set(order)).toHaveLength(5);
  } finally {
    stop();
    spy.mockRestore();
  }
});

it("does not resurrect dormant bodies from the device cache after a runtime reset", async () => {
  const id = "dormant-device-cache";
  await writeTranscriptCache({
    key: `codex:${id}`,
    savedAt: Date.now(),
    events: [visibleReply],
  });
  trackCodexTranscript(id);
  markCodexTranscriptDormant(id);
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id, cwd: "/repo" }],
    detachedCard: null,
  });
  useCodexStore.setState({ events: {}, historyLoadedMap: {} });
  const stop = startSessionTranscriptCache();
  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(useCodexStore.getState().events[id]).toBeUndefined();
  } finally {
    stop();
    forgetCodexTranscript(id);
    useAgentCenterStore.setState({ cards: [] });
  }
});

it.each(["inProgress", "completed", "failed"] as const)(
  "does not publish a cached same-turn interruption over verified %s execution",
  async (status) => {
    const id = `cache-verified-outcome-${status}`;
    const terminal = (turnId: string) =>
      ({
        method: "turn/completed",
        params: {
          threadId: id,
          turn: {
            id: turnId,
            status: "interrupted",
            startedAt: 1,
            completedAt: 2,
            durationMs: 10,
            items: [],
            itemsView: "full",
            error: null,
          },
        },
      }) as ServerNotification;
    await writeTranscriptCache({
      key: `codex:${id}`,
      savedAt: Date.now(),
      events: [
        terminal("older-real-interruption"),
        terminal("exact-verified-turn"),
      ],
    });
    useAgentCenterStore.setState({
      cards: [{ kind: "codex", id, cwd: "/repo" }],
      currentAgentCardId: id,
      currentAgentCardKind: "codex",
      detachedCard: null,
    });
    useCodexStore.setState({
      currentThreadId: id,
      currentTurnId: null,
      events: {},
      historyLoadedMap: {},
      threadStatusMap: {},
      turnTimingMap: {},
    });
    const native = renderHook(() =>
      useServerNotificationHandler(
        {
          isCodexThreadActiveRef: { current: false },
          taskCompleteBeepModeRef: { current: "never" },
          preventSleepDuringTasksRef: { current: false },
        },
        async () => {},
      ),
    );
    const turn = {
      id: "exact-verified-turn",
      status: "inProgress",
      startedAt: 1,
      durationMs: null,
      items: [],
      error: null,
    };
    act(() => {
      native.result.current({
        method: "thread/status/changed",
        params: { threadId: id, status: { type: "active", activeFlags: [] } },
      } as any);
      native.result.current({
        method: "turn/started",
        params: { threadId: id, turn },
      } as any);
      native.result.current({
        method: "item/completed",
        params: {
          threadId: id,
          turnId: turn.id,
          item: {
            id: "fresh-native",
            type: "agentMessage",
            text: "fresh native source",
          },
        },
      } as any);
      if (status !== "inProgress")
        native.result.current({
          method: "turn/completed",
          params: { threadId: id, turn: { ...turn, status, durationMs: 500 } },
        } as any);
    });
    const timing = useCodexStore.getState().turnTimingMap[id];
    const stop = startSessionTranscriptCache();
    try {
      await vi.waitFor(() =>
        expect(useCodexStore.getState().historyLoadedMap[id]).toBe(true),
      );
      const events = useCodexStore.getState().events[id];
      expect(
        events.some(
          (event) =>
            event.method === "turn/completed" &&
            event.params.turn.id === timing.turnId &&
            event.params.turn.status === "interrupted",
        ),
      ).toBe(false);
      expect(
        events.some(
          (event) =>
            event.method === "turn/completed" &&
            event.params.turn.id === "older-real-interruption" &&
            event.params.turn.status === "interrupted",
        ),
      ).toBe(true);
      expect(useCodexStore.getState().turnTimingMap[id]).toEqual(timing);
      expect(JSON.stringify(events)).toContain("fresh native source");
    } finally {
      stop();
      native.unmount();
      useAgentCenterStore.setState({ cards: [] });
    }
  },
);

it("does not use an optimistic timing assignment to hide a persisted interruption", async () => {
  const id = "cache-without-native-proof";
  await writeTranscriptCache({
    key: `codex:${id}`,
    savedAt: Date.now(),
    events: [
      {
        method: "turn/completed",
        params: {
          threadId: id,
          turn: {
            id: "unverified",
            status: "interrupted",
            items: [],
            error: null,
          },
        },
      },
    ] as any,
  });
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id }],
    currentAgentCardId: id,
    currentAgentCardKind: "codex",
    detachedCard: null,
  });
  useCodexStore.setState({
    events: {},
    historyLoadedMap: {},
    threadStatusMap: { [id]: { type: "active", activeFlags: [] } },
    turnTimingMap: {
      [id]: {
        turnId: "unverified",
        status: "inProgress",
        startedAtMs: 1000,
        durationMs: null,
      },
    },
  });
  const stop = startSessionTranscriptCache();
  try {
    await vi.waitFor(() =>
      expect(useCodexStore.getState().historyLoadedMap[id]).toBe(true),
    );
    expect(
      useCodexStore
        .getState()
        .events[
          id
        ].some((event) => event.method === "turn/completed" && event.params.turn.status === "interrupted"),
    ).toBe(true);
  } finally {
    stop();
    useAgentCenterStore.setState({ cards: [] });
  }
});

it.each(["operation-revocation", "pairing-token"])(
  "rejects a held device-cache response after %s",
  async (change) => {
    const id = `cache-late-${change}`;
    const record = {
      key: `codex:${id}`,
      savedAt: Date.now(),
      events: [
        { ...visibleReply, params: { ...visibleReply.params, threadId: id } },
      ] as ServerNotification[],
    };
    await writeTranscriptCache(record);
    useAgentCenterStore.setState({
      cards: [{ kind: "codex", id }],
      currentAgentCardId: id,
      currentAgentCardKind: "codex",
      detachedCard: null,
    });
    useCodexStore.setState({
      events: {},
      historyLoadedMap: {},
      turnTimingMap: {},
      threadStatusMap: {},
    });
    const device = {
      name: "fixture",
      host: "cache-fixture.invalid",
      port: 45000,
      token: "old-fixture-token",
    };
    usePairingStore.setState({ desktops: [device], selectedHost: device.host });
    let release!: () => void;
    const original = IDBObjectStore.prototype.get;
    const get = vi
      .spyOn(IDBObjectStore.prototype, "get")
      .mockImplementation(function (this: IDBObjectStore, key) {
        if (this.name !== "transcripts" || key !== record.key)
          return original.call(this, key);
        const request = {
          result: record,
          onsuccess: null as (() => void) | null,
          onerror: null,
        };
        release = () => request.onsuccess?.();
        return request as unknown as IDBRequest;
      });
    const stop = startSessionTranscriptCache();
    try {
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      if (change === "operation-revocation") invalidateCodexOperationScope();
      else
        usePairingStore.setState({
          desktops: [{ ...device, token: "new-fixture-token" }],
        });
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(useCodexStore.getState().events[id]).toBeUndefined();
      expect(useCodexStore.getState().historyLoadedMap[id]).not.toBe(true);
    } finally {
      stop();
      get.mockRestore();
      useAgentCenterStore.setState({ cards: [] });
      usePairingStore.setState({ desktops: [], selectedHost: null });
    }
  },
);
it("does not restore or persist hidden output payloads alongside the final result", async () => {
  await writeTranscriptCache({
    key: "codex:hidden-output",
    savedAt: Date.now(),
    events: [
      {
        method: "item/commandExecution/outputDelta",
        params: {
          threadId: "hidden-output",
          turnId: "t",
          itemId: "cmd",
          delta: "old hidden output",
        },
      } as any,
      {
        method: "item/completed",
        params: {
          threadId: "hidden-output",
          turnId: "t",
          item: {
            type: "commandExecution",
            id: "cmd",
            status: "completed",
            command: "pnpm test",
            aggregatedOutput: "complete output",
          },
        },
      } as any,
      visibleReply,
    ],
  });
  const cached = await readTranscriptCache("codex:hidden-output");
  expect(cached?.events?.map((event) => event.method)).toEqual([
    "item/completed",
    "item/completed",
  ]);
  expect((cached?.events?.[0].params as any).item).toMatchObject({
    type: "commandExecution",
    id: "cmd",
    status: "completed",
    command: "pnpm test",
    aggregatedOutput: null,
    transcriptMetadataOnly: true,
  });
  expect((cached?.events?.[1].params as any).item.text).toBe("Final reply");
  expect(JSON.stringify(cached?.events)).not.toContain("old hidden output");
  expect(JSON.stringify(cached?.events)).not.toContain("complete output");
});
it("filters hidden payloads from records written by an older client", async () => {
  const events = [
    ...[
      "rawResponseItem/completed",
      "item/fileChange/outputDelta",
      "item/commandExecution/outputDelta",
    ].map((method) => ({
      method,
      params: {
        threadId: "legacy-output",
        turnId: "t",
        itemId: "cmd",
        delta: "legacy hidden output",
      },
    })),
    {
      method: "item/completed",
      params: {
        threadId: "legacy-output",
        turnId: "t",
        item: {
          type: "commandExecution",
          id: "legacy-tool",
          status: "completed",
          command: "legacy command",
          aggregatedOutput: "old tool output",
        },
      },
    },
    {
      method: "item/completed",
      params: {
        threadId: "legacy-output",
        turnId: "t",
        item: {
          type: "agentMessage",
          id: "reply",
          text: "complete visible reply",
        },
      },
    },
  ];
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("kanban.session.transcripts.v1", 2);
    request.onupgradeneeded = () => {
      for (const name of ["transcripts", "budget"])
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name, { keyPath: "key" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("transcripts", "readwrite");
      tx.objectStore("transcripts").put({
        key: "codex:legacy-output",
        savedAt: Date.now(),
        events,
        thread: {
          id: "legacy-output",
          status: { type: "active", activeFlags: ["waitingOnApproval"] },
          turns: [
            {
              id: "old",
              items: [
                {
                  type: "commandExecution",
                  id: "old-tool",
                  aggregatedOutput: "legacy nested output",
                },
              ],
            },
          ],
        },
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
  const cached = await readTranscriptCache("codex:legacy-output");
  expect(cached?.thread?.status.type).toBe("notLoaded");
  expect(cached?.thread?.turns).toEqual([]);
  expect(cached?.events?.map((event) => event.method)).toEqual([
    "item/completed",
    "item/completed",
  ]);
  expect((cached?.events?.[0].params as any).item).toMatchObject({
    id: "legacy-tool",
    type: "commandExecution",
    status: "completed",
    aggregatedOutput: null,
    transcriptMetadataOnly: true,
  });
  expect((cached?.events?.[1].params as any).item.text).toBe(
    "complete visible reply",
  );
  expect(JSON.stringify(cached)).not.toContain("legacy hidden output");
  expect(JSON.stringify(cached)).not.toContain("old tool output");
  expect(JSON.stringify(cached)).not.toContain("legacy nested output");
});
it("restores recent content and a reading anchor without restoring executable requests", async () => {
  await writeTranscriptCache({
    key: "codex:cache-test",
    savedAt: Date.now(),
    events: [
      {
        method: "item/completed",
        params: {
          threadId: "cache-test",
          turnId: "t",
          item: {
            type: "agentMessage",
            id: "a",
            text: "saved reply",
            phase: null,
            memoryCitation: null,
          },
          completedAtMs: 0,
        },
      },
    ],
    cursor: "older",
    thread: {
      id: "cache-test",
      turns: [],
      status: { type: "active", activeFlags: ["waitingOnApproval"] },
    } as any,
  });
  const cached = await readTranscriptCache("codex:cache-test");
  expect(cached?.events).toHaveLength(1);
  expect(cached?.thread?.status.type).toBe("notLoaded");
  expect(cached?.cursor).toBe("older");
  saveReadingPosition("codex:cache-test", {
    atBottom: false,
    anchor: "a",
    offset: 14,
    scrollTop: 200,
  });
  expect(getReadingPosition("codex:cache-test")?.anchor).toBe("a");
});
it("rollback invalidation rejects old disk snapshots and late writes", async () => {
  const record = {
    key: "codex:rollback-cache",
    savedAt: Date.now() - 1000,
    events: [],
  };
  await writeTranscriptCache(record);
  invalidateTranscriptCache(record.key);
  expect(await readTranscriptCache(record.key)).toBeUndefined();
  await writeTranscriptCache(record);
  expect(await readTranscriptCache(record.key)).toBeUndefined();
});
it("bounds persisted event data and strips duplicated turn item bodies", async () => {
  const events = Array.from({ length: 1200 }, (_, i) => ({
    method: "turn/completed",
    params: {
      threadId: "large",
      turn: {
        id: String(i),
        items: [{ huge: "x".repeat(1000) }],
        status: "completed",
      },
    },
  })) as any;
  await writeTranscriptCache({
    key: "codex:large",
    savedAt: Date.now(),
    events,
  });
  const cached = await readTranscriptCache("codex:large");
  expect(cached!.events!.length).toBeLessThanOrEqual(600);
  expect((cached!.events!.at(-1)!.params as any).turn.items).toEqual([]);
});

it("drops oversized codex tool payloads before serializing cache records", async () => {
  const originalStringify = JSON.stringify;
  let stringifyCalls = 0;
  let largestSerialized = 0;
  JSON.stringify = ((value: unknown, ...args: unknown[]) => {
    const serialized = originalStringify(value, ...(args as []));
    stringifyCalls += 1;
    largestSerialized = Math.max(largestSerialized, serialized.length);
    return serialized;
  }) as typeof JSON.stringify;
  try {
    const events = Array.from({ length: 120 }, (_, i) => ({
      method: "item/completed",
      params: {
        threadId: "oversized-tool-cache",
        turnId: `turn-${i}`,
        item: {
          type: "commandExecution",
          id: `cmd-${i}`,
          status: "completed",
          aggregatedOutput: `${i}:`.repeat(50_000),
        },
      },
    })) as ServerNotification[];
    await writeTranscriptCache({
      key: "codex:oversized-tool-cache",
      savedAt: Date.now(),
      events: [...events, visibleReply],
    });
  } finally {
    JSON.stringify = originalStringify;
  }
  expect(stringifyCalls).toBeLessThanOrEqual(1);
  expect(largestSerialized).toBeLessThan(2 * 1024 * 1024);
  const cached = await readTranscriptCache("codex:oversized-tool-cache");
  expect(cached?.events).toHaveLength(121);
  expect(cached?.events).toContainEqual(visibleReply);
  const tools = cached!.events!.filter(
    (event) =>
      event.method === "item/completed" &&
      event.params.item.type === "commandExecution",
  );
  expect(tools).toHaveLength(120);
  for (const event of tools)
    expect((event.params as any).item).toMatchObject({
      status: "completed",
      aggregatedOutput: null,
      transcriptMetadataOnly: true,
    });
  expect(JSON.stringify(cached?.events)).not.toContain("0:".repeat(1024));
  expect(cached?.bytes).toBeLessThanOrEqual(2 * 1024 * 1024);
});

it("persists a reduced event window after estimate-based cache trimming", async () => {
  const events = Array.from({ length: 900 }, (_, i) => ({
    method: "item/completed",
    params: {
      threadId: "estimated-window-cache",
      turnId: `turn-${i}`,
      item: {
        type: "agentMessage",
        id: `reply-${i}`,
        text: `${i}:`.repeat(2_000),
      },
    },
  })) as ServerNotification[];
  await writeTranscriptCache({
    key: "codex:estimated-window-cache",
    savedAt: Date.now(),
    events,
  });
  const cached = await readTranscriptCache("codex:estimated-window-cache");
  expect(cached?.events?.length).toBeGreaterThan(0);
  expect(cached?.events?.length).toBeLessThan(events.length);
  expect(cached?.bytes).toBeLessThanOrEqual(2 * 1024 * 1024);
});

it("coalesces concurrent writes for the same transcript key to the latest pending record", async () => {
  const originalStringify = JSON.stringify;
  let stringifyCalls = 0;
  JSON.stringify = ((value: unknown, ...args: unknown[]) => {
    stringifyCalls += 1;
    return originalStringify(value, ...(args as []));
  }) as typeof JSON.stringify;
  try {
    await Promise.all([
      writeTranscriptCache({
        key: "codex:coalesced-cache",
        savedAt: 1,
        events: [
          {
            method: "item/completed",
            params: {
              threadId: "coalesced-cache",
              turnId: "t1",
              item: { type: "agentMessage", id: "a1", text: "first" },
            },
          } as any,
        ],
      }),
      writeTranscriptCache({
        key: "codex:coalesced-cache",
        savedAt: 2,
        events: [
          {
            method: "item/completed",
            params: {
              threadId: "coalesced-cache",
              turnId: "t2",
              item: { type: "agentMessage", id: "a2", text: "middle" },
            },
          } as any,
        ],
      }),
      writeTranscriptCache({
        key: "codex:coalesced-cache",
        savedAt: 3,
        events: [
          {
            method: "item/completed",
            params: {
              threadId: "coalesced-cache",
              turnId: "t3",
              item: { type: "agentMessage", id: "a3", text: "latest" },
            },
          } as any,
        ],
      }),
    ]);
  } finally {
    JSON.stringify = originalStringify;
  }
  expect(stringifyCalls).toBeLessThanOrEqual(2);
  const cached = await readTranscriptCache("codex:coalesced-cache");
  expect(cached?.savedAt).toBe(3);
  expect((cached?.events?.[0].params as any).item.text).toBe("latest");
});

it("queues only bounded cache records for repeated oversized sources", async () => {
  const originalStringify = JSON.stringify;
  const serializedLengths: number[] = [];
  JSON.stringify = ((value: unknown, ...args: unknown[]) => {
    const serialized = originalStringify(value, ...(args as []));
    serializedLengths.push(serialized.length);
    return serialized;
  }) as typeof JSON.stringify;
  try {
    const hugeEvents = (label: string) =>
      Array.from({ length: 100 }, (_, i) => ({
        method: "item/completed",
        params: {
          threadId: "blocked-cache",
          turnId: `turn-${label}-${i}`,
          item: {
            type: "commandExecution",
            id: `cmd-${label}-${i}`,
            status: "completed",
            aggregatedOutput: `${label}:`.repeat(100_000),
          },
        },
      })) as ServerNotification[];
    const first = writeTranscriptCache({
      key: "codex:blocked-cache",
      savedAt: 20,
      events: [...hugeEvents("first"), visibleReply],
    });
    const pending = writeTranscriptCache({
      key: "codex:blocked-cache",
      savedAt: 21,
      events: [...hugeEvents("latest"), visibleReply],
    });
    await Promise.all([first, pending]);
  } finally {
    JSON.stringify = originalStringify;
  }
  expect(serializedLengths).toHaveLength(2);
  expect(Math.max(...serializedLengths)).toBeLessThan(2 * 1024 * 1024);
  const cached = await readTranscriptCache("codex:blocked-cache");
  expect(cached?.savedAt).toBe(21);
  expect(cached?.events).toHaveLength(101);
  expect(cached?.events).toContainEqual(visibleReply);
  const tools = cached!.events!.filter(
    (event) =>
      event.method === "item/completed" &&
      event.params.item.type === "commandExecution",
  );
  expect(tools).toHaveLength(100);
  for (const event of tools)
    expect((event.params as any).item).toMatchObject({
      status: "completed",
      aggregatedOutput: null,
      transcriptMetadataOnly: true,
    });
  expect((tools.at(-1)!.params as any).item.id).toBe("cmd-latest-99");
  expect(JSON.stringify(cached?.events)).not.toContain("latest:".repeat(1024));
  expect(JSON.stringify(cached?.events)).not.toContain("first:".repeat(1024));
  expect(cached?.bytes).toBeLessThanOrEqual(2 * 1024 * 1024);
});

it("resolves superseded writes and rechecks cache invalidation before queued writes persist", async () => {
  const key = "codex:queued-invalidated-cache";
  const first = writeTranscriptCache({
    key,
    savedAt: 10,
    events: [
      {
        method: "item/completed",
        params: {
          threadId: "queued-invalidated-cache",
          turnId: "t1",
          item: { type: "agentMessage", id: "a1", text: "first" },
        },
      } as any,
    ],
  });
  const superseded = writeTranscriptCache({
    key,
    savedAt: 11,
    events: [
      {
        method: "item/completed",
        params: {
          threadId: "queued-invalidated-cache",
          turnId: "t2",
          item: { type: "agentMessage", id: "a2", text: "superseded" },
        },
      } as any,
    ],
  });
  const latest = writeTranscriptCache({
    key,
    savedAt: 12,
    events: [
      {
        method: "item/completed",
        params: {
          threadId: "queued-invalidated-cache",
          turnId: "t3",
          item: { type: "agentMessage", id: "a3", text: "invalidated" },
        },
      } as any,
    ],
  });
  invalidateTranscriptCache(key);
  await expect(Promise.all([first, superseded, latest])).resolves.toEqual([
    undefined,
    undefined,
    undefined,
  ]);
  expect(await readTranscriptCache(key)).toBeUndefined();
});

it("persists native hook bigint counters without losing the final reply or precision", async () => {
  const events = [
    {
      method: "hook/completed",
      params: {
        threadId: "hook-cache",
        turnId: "t",
        run: {
          id: "hook",
          eventName: "postToolUse",
          handlerType: "command",
          executionMode: "sync",
          scope: "turn",
          source: "project",
          sourcePath: "/repo/hooks.json",
          displayOrder: 9007199254740994n,
          status: "completed",
          statusMessage: null,
          startedAt: 9007199254740995n,
          completedAt: 9007199254740996n,
          durationMs: 1n,
          entries: [{ kind: "feedback", text: "Public hook result" }],
        },
      },
    },
    visibleReply,
  ] as ServerNotification[];
  await writeTranscriptCache({
    key: "codex:hook-cache",
    savedAt: Date.now(),
    events,
  });
  const cached = await readTranscriptCache("codex:hook-cache");
  expect(cached?.events).toHaveLength(2);
  const hook = cached?.events?.find(
    (event) => event.method === "hook/completed",
  );
  expect((hook?.params as any).run.displayOrder).toBe(9007199254740994n);
  expect((hook?.params as any).run.startedAt).toBe(9007199254740995n);
  expect(cached?.events).toContainEqual(visibleReply);
  expect(cached?.bytes).toBeLessThanOrEqual(2 * 1024 * 1024);
});

it("bounds legacy device records before first restore publishes a baseline or store", async () => {
  const id = "legacy-over-budget";
  const savedAt = Date.now();
  const events = Array.from({ length: 80 }, (_, index) => ({
    method: "item/completed",
    params: {
      threadId: id,
      turnId: `turn-${index}`,
      item: {
        type: "agentMessage",
        id: `reply-${index}`,
        text: "visible text ".repeat(6000),
      },
    },
  }));
  events.push({
    method: "turn/completed",
    params: {
      threadId: id,
      turn: {
        id: "turn-79",
        status: "completed",
        startedAt: 123,
        durationMs: 456,
        items: [],
      },
    },
  } as any);
  const record = {
    key: `codex:${id}`,
    savedAt,
    cursor: "older-native-page",
    events,
    bytes: 1,
    thread: { id, turns: [], status: { type: "idle" } },
  };
  expect(
    new TextEncoder().encode(JSON.stringify(record)).byteLength,
  ).toBeGreaterThan(2 * 1024 * 1024);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("kanban.session.transcripts.v1", 2);
    request.onupgradeneeded = () => {
      for (const name of ["transcripts", "budget"])
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name, { keyPath: "key" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("transcripts", "readwrite");
      tx.objectStore("transcripts").put(record);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
  const cached = await readTranscriptCache(record.key);
  expect(cached).toMatchObject({
    key: record.key,
    savedAt,
  });
  expect(cached?.cursor).toMatch(/^kanban-memory-(?:reload|items):/);
  expect(cached?.cursor).not.toBe(record.cursor);
  expect(
    new TextEncoder().encode(JSON.stringify(cached)).byteLength,
  ).toBeLessThanOrEqual(2 * 1024 * 1024);
  expect(cached?.events?.at(-1)).toEqual(events.at(-1));
  const { cachedTranscriptBaselines, cachedTranscriptTimings } =
    await import("./sessionCacheState");
  const { useSessionSyncStore } = await import("../stores/useSessionSyncStore");
  useAgentCenterStore.setState({
    cards: [{ kind: "codex", id, cwd: "/repo" }],
    detachedCard: null,
  });
  useCodexStore.setState({ events: {}, historyLoadedMap: {} });
  const published: number[] = [];
  const unsubscribe = useCodexStore.subscribe((state) => {
    if (state.events[id])
      published.push(
        new TextEncoder().encode(JSON.stringify(state.events[id])).byteLength,
      );
  });
  const stop = startSessionTranscriptCache();
  try {
    await vi.waitFor(() =>
      expect(useCodexStore.getState().historyLoadedMap[id]).toBe(true),
    );
    expect(published.length).toBeGreaterThan(0);
    expect(Math.max(...published)).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(cachedTranscriptBaselines.get(id)).toBe(
      useCodexStore.getState().events[id],
    );
    expect(cachedTranscriptTimings.get(id)).toMatchObject({
      turnId: "turn-79",
      status: "completed",
      startedAtMs: 123000,
      durationMs: 456,
    });
    expect(useSessionSyncStore.getState().cursors[id]).toBe(cached?.cursor);
  } finally {
    unsubscribe();
    stop();
    cachedTranscriptBaselines.delete(id);
    cachedTranscriptTimings.delete(id);
    useAgentCenterStore.setState({ cards: [] });
  }
});

it("replaces a stale native cursor when writing a shorter cached history window", async () => {
  const id = "write-trim-cursor";
  const events = Array.from({ length: 80 }, (_, index) => ({
    method: "item/completed",
    params: {
      threadId: id,
      turnId: `trim-turn-${index}`,
      item: {
        type: "agentMessage",
        id: `trim-reply-${index}`,
        text: "visible text ".repeat(6000),
      },
    },
  })) as ServerNotification[];
  await writeTranscriptCache({
    key: `codex:${id}`,
    savedAt: Date.now(),
    events,
    cursor: "before-original-turn-0",
  });
  const cached = await readTranscriptCache(`codex:${id}`);
  expect(cached?.events?.length).toBeGreaterThan(0);
  expect(cached!.events!.length).toBeLessThan(events.length);
  expect(cached?.cursor).toMatch(/^kanban-memory-(?:reload|items):/);
  const first = cached!.events![0] as any;
  const cursor = cached!.cursor!;
  if (cursor.startsWith("kanban-memory-reload:"))
    expect(
      decodeURIComponent(cursor.slice("kanban-memory-reload:".length)),
    ).toBe(first.params.turnId);
  else
    expect(
      JSON.parse(
        decodeURIComponent(cursor.slice("kanban-memory-items:".length)),
      ),
    ).toMatchObject({
      turnId: first.params.turnId,
      beforeItemId: first.params.item.id,
    });
});

it("retains a same-turn item recovery anchor when the cache event window drops a prefix", async () => {
  const id = "same-turn-cache-window";
  const events = Array.from({ length: 900 }, (_, index) => ({
    method: "item/completed",
    params: {
      threadId: id,
      turnId: "one-turn",
      item: {
        type: "agentMessage",
        id: `one-item-${index}`,
        text: `reply ${index}`,
      },
    },
  })) as ServerNotification[];
  await writeTranscriptCache({
    key: `codex:${id}`,
    savedAt: Date.now(),
    events,
    cursor: "before-original-turn",
  });
  const cached = await readTranscriptCache(`codex:${id}`);
  expect(cached?.events).toHaveLength(600);
  expect(cached?.cursor).toMatch(/^kanban-memory-items:/);
  expect(
    JSON.parse(
      decodeURIComponent(cached!.cursor!.slice("kanban-memory-items:".length)),
    ),
  ).toEqual({ turnId: "one-turn", beforeItemId: "one-item-300" });
});
