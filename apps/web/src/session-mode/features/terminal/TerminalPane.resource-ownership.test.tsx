import { act, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { TerminalPane } from "./TerminalPane";
const io = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  write: vi.fn(),
}));
vi.mock("xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    open() {}
    dispose() {}
    focus() {}
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
  terminalStart: io.start,
  terminalStop: io.stop,
  terminalWrite: io.write,
  terminalResize: vi.fn(),
}));
vi.mock("@session/stores/useWorkspaceStore", () => ({
  useWorkspaceStore: () => ({ cwd: "/fixture" }),
}));
vi.mock("@session/hooks/runtime", () => ({
  buildWsUrl: () => "ws://fixture.invalid/ws",
}));
afterEach(() => vi.unstubAllGlobals());
// A closed pane may clean its own late resource but must never execute commands.
test("late terminal start after pane close cleans only its owned resource and never runs the command", async () => {
  vi.stubGlobal(
    "WebSocket",
    class {
      close() {}
    },
  );
  let resolve!: (value: { session_id: string }) => void;
  io.start.mockReturnValue(
    new Promise<{ session_id: string }>((done) => {
      resolve = done;
    }),
  );
  const view = render(
    <TerminalPane active panelOpen command="isolated-placeholder" />,
  );
  await waitFor(() => expect(io.start).toHaveBeenCalledOnce());
  view.unmount();
  await act(async () => resolve({ session_id: "owned-late-start" }));
  expect(io.write).not.toHaveBeenCalled();
  expect(io.stop).toHaveBeenCalledExactlyOnceWith("owned-late-start");
  vi.unstubAllGlobals();
});
