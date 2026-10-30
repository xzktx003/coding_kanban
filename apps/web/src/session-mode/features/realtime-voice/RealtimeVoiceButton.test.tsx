import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  instances: [] as Array<{ deps: any; finishStop?: () => void }>,
  request: vi.fn(),
  event: undefined as ((event: any) => void) | undefined,
}));
vi.mock("./transport", () => ({
  realtimeTransport: () => ({ current: () => true, request: state.request }),
}));
vi.mock("@session/lib/eventStream", () => ({
  openEventStream: (options: any) => {
    state.event = options.onEvent;
    return () => {};
  },
}));
vi.mock("./controller", () => ({
  RealtimeVoiceController: class {
    deps: any;
    finishStop?: () => void;
    constructor(deps: any) {
      this.deps = deps;
      state.instances.push(this);
    }
    async start() {
      this.deps.phase("active");
    }
    stop() {
      this.deps.phase("stopping");
      return new Promise<boolean>((resolve) => {
        this.finishStop = () => {
          this.deps.phase("idle");
          resolve(true);
        };
      });
    }
    revoke() {
      this.deps.phase("idle");
    }
    mute() {}
    async sendText() {}
  },
}));
import { RealtimeVoiceButton } from "./RealtimeVoiceButton";
beforeEach(() => {
  state.instances.length = 0;
  state.request.mockReset();
  state.event = undefined;
  localStorage.clear();
  state.request.mockImplementation(async (_action: string, body: any) => ({
    threadId: body.threadId,
    contextToken: "a".repeat(64),
  }));
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
  vi.stubGlobal("RTCPeerConnection", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function start() {
  fireEvent.click(screen.getByRole("button", { name: "语音对话" }));
  const confirm = await screen.findByRole("button", { name: "确认开始语音对话" });
  // The dialog is visible before readonly preflight resolves. A user can only
  // activate the enabled control; firing a disabled button silently drops it.
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(confirm);
  // Cold Vitest imports are independent of the Workbench browser latency gate.
  await screen.findByRole("button", { name: "静音麦克风" }, { timeout: 5000 });
}
it("switches voice target immediately and ignores the old session's late stop phase", async () => {
  const view = render(<RealtimeVoiceButton threadId="one" owner="codex:one" />);
  await start();
  view.rerender(<RealtimeVoiceButton threadId="two" owner="codex:two" />);
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "语音对话" })).toBeNull(),
  );
  await start();
  expect(
    state.request.mock.calls
      .filter(([action]) => action === "preflight")
      .map(([, body]) => body.threadId),
  ).toEqual(["one", "two"]);
  expect(state.instances).toHaveLength(2);
  await act(async () => state.instances[0].finishStop?.());
  expect(screen.getByRole("button", { name: "静音麦克风" })).not.toBeNull();
});
it("releases and resets the UI on an account event without letting an old start restore active controls", async () => {
  render(<RealtimeVoiceButton threadId="one" owner="codex:one" />);
  await start();
  act(() =>
    state.event?.({
      event: "codex:notification",
      payload: { method: "account/updated", params: {} },
    }),
  );
  expect(screen.queryByRole("button", { name: "静音麦克风" })).toBeNull();
  act(() => state.instances[0].deps.phase("active"));
  expect(screen.queryByRole("button", { name: "静音麦克风" })).toBeNull();
});
it("keeps the audio sink mounted when returning to chat and exposes a speaker mute control", async () => {
  render(<RealtimeVoiceButton threadId="one" owner="codex:one" />);
  await start();
  const sink = document.querySelector("audio");
  expect(sink).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "静音扬声器" }));
  expect(sink!.muted).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "返回聊天（保持语音）" }));
  expect(sink!.isConnected).toBe(true);
});
it("does not append native text if account authority changes while hashing the captured draft",async()=>{
  render(<RealtimeVoiceButton threadId="one" owner="codex:one"/>);await start();
  let finish!:(value:ArrayBuffer)=>void;const crypto=globalThis.crypto;
  vi.stubGlobal("crypto",{getRandomValues:crypto.getRandomValues.bind(crypto),subtle:{digest:()=>new Promise<ArrayBuffer>(resolve=>{finish=resolve;})}});
  const pending=state.instances[0].deps.sendText("captured voice text");
  const rejected=expect(pending).rejects.toThrow(/变化/);
  act(()=>state.event?.({event:"codex:notification",payload:{method:"account/updated",params:{}}}));
  finish(new ArrayBuffer(32));await rejected;
  expect(state.request.mock.calls.some(([action])=>action==="append-text")).toBe(false);
  expect(localStorage.getItem("kanban.session.realtime-text.v1.codex:one")).toBeNull();
});
