import { afterEach, expect, it, vi } from "vitest";
vi.mock("@session/hooks/runtime", () => ({
  buildEventUrl: (path: string) => path,
}));
import {
  openEventStream,
  reconcileEventStream,
  retryEventStream,
} from "./eventStream";
afterEach(() => vi.unstubAllGlobals());
it("recovers when a reconnect snapshot proves the runtime sequence restarted", () => {
  const instances: any[] = [];
  class FakeSource {
    onmessage: any;
    close = vi.fn();
    constructor(public url: string) {
      instances.push(this);
    }
  }
  vi.stubGlobal("EventSource", FakeSource);
  const receive = vi.fn();
  const restart = vi.fn();
  window.addEventListener("session-runtime-restarted", restart);
  const close = openEventStream({ onEvent: receive });
  const emit = (seq: number, event = "codex:notification") =>
    instances
      .at(-1)
      .onmessage({ data: JSON.stringify({ seq, event, payload: {} }) });
  try {
    emit(900);
    reconcileEventStream();
    expect(instances.at(-1).url).toContain("since=900");
    emit(2, "codex/pending-requests-snapshot");
    expect(restart).toHaveBeenCalledOnce();
    expect(instances.at(-1).url).not.toContain("since=");
    emit(3);
    expect(receive.mock.calls.at(-1)?.[0].seq).toBe(3);
  } finally {
    close();
    window.removeEventListener("session-runtime-restarted", restart);
  }
});
it("shares one browser connection across agent subscribers and releases it only after all unsubscribe", () => {
  const instances: FakeSource[] = [];
  class FakeSource {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    close = vi.fn();
    constructor(public url: string) {
      instances.push(this);
    }
  }
  vi.stubGlobal("EventSource", FakeSource);
  const codex = vi.fn(),
    cc = vi.fn();
  const closeA = openEventStream({ agents: ["codex"], onEvent: codex });
  const closeB = openEventStream({ agents: ["cc"], onEvent: cc });
  try {
    expect(instances).toHaveLength(1);
    expect(instances[0].url).toContain("view=chat");
    instances[0].onmessage?.({
      data: JSON.stringify({ seq: 1, event: "cc-message", payload: {} }),
    });
    expect(codex).not.toHaveBeenCalled();
    expect(cc).toHaveBeenCalledOnce();
    closeA();
    expect(instances[0].close).not.toHaveBeenCalled();
  } finally {
    closeA();
    closeB();
  }
  expect(instances[0].close).toHaveBeenCalledOnce();
});
it("routes acp-message frames to acp subscribers without leaking codex frames", () => {
  const instances: FakeSource[] = [];
  class FakeSource {
    onmessage: ((event: { data: string }) => void) | null = null;
    close = vi.fn();
    constructor(public url: string) {
      instances.push(this);
    }
  }
  vi.stubGlobal("EventSource", FakeSource);
  const acp = vi.fn();
  const codex = vi.fn();
  const closeA = openEventStream({ agents: ["acp"], onEvent: acp });
  const closeB = openEventStream({ agents: ["codex"], onEvent: codex });
  try {
    expect(instances).toHaveLength(1);
    instances[0].onmessage?.({
      data: JSON.stringify({ seq: 1, event: "acp-message", payload: {} }),
    });
    instances[0].onmessage?.({
      data: JSON.stringify({
        seq: 2,
        event: "codex:notification",
        payload: {},
      }),
    });
    expect(acp.mock.calls.map((call) => call[0].event)).toEqual([
      "acp-message",
    ]);
    expect(codex.mock.calls.map((call) => call[0].event)).toEqual([
      "codex:notification",
    ]);
  } finally {
    closeA();
    closeB();
  }
});
it("delivers reconciliation at the same sequence as replay without redelivering ordinary events", () => {
  let source: any;
  class FakeSource {
    close = vi.fn();
    onmessage: any;
    constructor() {
      source = this;
    }
  }
  vi.stubGlobal("EventSource", FakeSource);
  const receive = vi.fn();
  const close = openEventStream({ onEvent: receive });
  try {
    const emit = (event: string) =>
      source.onmessage({
        data: JSON.stringify({ seq: 2, event, payload: { requests: [] } }),
      });
    emit("codex/request-user-input");
    emit("codex/user-input-snapshot");
    emit("codex/pending-requests-snapshot");
    emit("codex/request-user-input");
    expect(receive.mock.calls.map((call) => call[0].event)).toEqual([
      "codex/request-user-input",
      "codex/user-input-snapshot",
      "codex/pending-requests-snapshot",
    ]);
  } finally {
    close();
  }
});

it("reports gaps and failed delivery while still delivering healthy subscribers", async () => {
  vi.useFakeTimers();
  let source: any;
  class FakeSource {
    onopen: any;
    onmessage: any;
    onerror: any;
    close() {}
    constructor() {
      source = this;
    }
  }
  vi.stubGlobal("EventSource", FakeSource);
  const resync = vi.fn(),
    healthy = vi.fn();
  const closeA = openEventStream({
    onEvent: () => {
      throw new Error("broken renderer");
    },
    onResync: resync,
  });
  const closeB = openEventStream({ onEvent: healthy });
  try {
    source.onopen();
    for (const seq of [1, 3])
      source.onmessage({
        data: JSON.stringify({ seq, event: "codex:notification", payload: {} }),
      });
    await vi.advanceTimersByTimeAsync(300);
    expect(healthy).toHaveBeenCalledTimes(2);
    expect(resync).toHaveBeenCalledOnce();
  } finally {
    closeA();
    closeB();
    vi.useRealTimers();
  }
});
it("invalid frames request reconciliation and stale connections cannot deliver after replacement", async () => {
  vi.useFakeTimers();
  const instances: any[] = [];
  class FakeSource {
    onopen: any;
    onmessage: any;
    onerror: any;
    close() {}
    constructor() {
      instances.push(this);
    }
  }
  vi.stubGlobal("EventSource", FakeSource);
  const receive = vi.fn(),
    resync = vi.fn();
  const close = openEventStream({ onEvent: receive, onResync: resync });
  try {
    instances[0].onopen();
    instances[0].onmessage({ data: "{bad" });
    await vi.advanceTimersByTimeAsync(300);
    expect(resync).toHaveBeenCalledOnce();
    instances[0].onerror();
    await vi.advanceTimersByTimeAsync(500);
    instances[0].onmessage({
      data: JSON.stringify({
        seq: 9,
        event: "codex:notification",
        payload: {},
      }),
    });
    expect(receive).not.toHaveBeenCalled();
  } finally {
    close();
    vi.useRealTimers();
  }
});

it("pauses oversized stream failures without replaying or repairing in a loop", async () => {
  vi.useFakeTimers();
  const instances: any[] = [];
  class FakeSource {
    onopen: any;
    onmessage: any;
    onerror: any;
    close = vi.fn();
    listeners = new Map<string, () => void>();
    addEventListener(name: string, listener: () => void) {
      this.listeners.set(name, listener);
    }
    constructor() {
      instances.push(this);
    }
  }
  vi.stubGlobal("EventSource", FakeSource);
  const resync = vi.fn();
  const close = openEventStream({ onEvent: vi.fn(), onResync: resync });
  try {
    instances[0].onopen();
    instances[0].listeners.get("session-projection-error")?.();
    instances[0].onerror();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(instances[0].close).toHaveBeenCalledOnce();
    expect(instances).toHaveLength(1);
    expect(resync).not.toHaveBeenCalled();
    reconcileEventStream();
    expect(instances).toHaveLength(1);
    retryEventStream();
    expect(instances).toHaveLength(2);
  } finally {
    close();
    vi.useRealTimers();
  }
});
