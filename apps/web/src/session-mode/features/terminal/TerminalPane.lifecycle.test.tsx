import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { TerminalPane } from "./TerminalPane";
const calls = vi.hoisted(() => ({
  open: vi.fn(),
  dispose: vi.fn(),
  focus: vi.fn(),
  start: vi.fn(async () => ({ session_id: "isolated-pane" })),
  stop: vi.fn(),
}));
vi.mock("xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    open = calls.open;
    dispose = calls.dispose;
    focus = calls.focus;
    loadAddon() {}
    onData() {
      return { dispose() {} };
    }
    write() {}
    writeln() {}
  },
}));
vi.mock("xterm-addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock("@session/services/apiAdapt", () => ({
  terminalStart: calls.start,
  terminalStop: calls.stop,
  terminalWrite: vi.fn(),
  terminalResize: vi.fn(),
}));
vi.mock("@session/stores/useWorkspaceStore", () => ({
  useWorkspaceStore: () => ({ cwd: "/fixture" }),
}));
vi.mock("@session/hooks/runtime", () => ({
  buildWsUrl: () => "ws://fixture.invalid/ws",
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
test("StrictMode cancels the discarded terminal attachment before opening its renderer", async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.set(++next, cb);
    return next;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "WebSocket",
    class {
      close() {}
    },
  );
  const view = render(
    <StrictMode>
      <TerminalPane active panelOpen />
    </StrictMode>,
  );
  expect(calls.open).not.toHaveBeenCalled();
  expect(calls.dispose).toHaveBeenCalledTimes(1);
  await act(async () => {
    for (const cb of frames.values()) cb(0);
    frames.clear();
  });
  expect(calls.open).toHaveBeenCalledTimes(1);
  view.rerender(
    <StrictMode>
      <TerminalPane active={false} panelOpen={false} />
    </StrictMode>,
  );
  expect(calls.dispose).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(calls.dispose).toHaveBeenCalledTimes(2);
});

test("terminal output connection reports loading before the socket opens", () => {
  vi.stubGlobal(
    "WebSocket",
    class {
      close() {}
    },
  );
  render(<TerminalPane active={false} panelOpen={false} />);
  expect(screen.getByRole("status", { hidden: true }).textContent).toContain(
    "正在连接终端输出",
  );
});

test("terminal start error offers one guarded retry in the same pane", async () => {
  vi.stubGlobal(
    "WebSocket",
    class {
      close() {}
    },
  );
  calls.start.mockRejectedValueOnce(new Error("隔离启动失败"));
  render(<TerminalPane active panelOpen />);
  await screen.findByRole("alert");
  const retry = screen.getByRole("button", { name: "重试启动终端" });
  calls.start.mockReturnValueOnce(new Promise(() => {}));
  fireEvent.click(retry);
  fireEvent.click(retry);
  await waitFor(() => expect(calls.start).toHaveBeenCalledTimes(2));
});
