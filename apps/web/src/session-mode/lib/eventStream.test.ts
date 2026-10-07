import { afterEach, expect, it, vi } from "vitest";
vi.mock("@session/hooks/runtime", () => ({
  buildEventUrl: (path: string) => path,
}));
import { openEventStream } from "./eventStream";
afterEach(() => vi.unstubAllGlobals());
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
    emit("codex/request-user-input");
    expect(receive.mock.calls.map((call) => call[0].event)).toEqual([
      "codex/request-user-input",
      "codex/user-input-snapshot",
    ]);
  } finally {
    close();
  }
});
