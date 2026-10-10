import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { expect, it, vi } from "vitest";
import { ShellCommand } from "./ShellCommand";
import { useCodexStore } from "../stores/useCodexStore";
import { RowStateContext } from "../thread/rowState";
import * as terminal from "../presentation/nativeCommand";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      [key, ...Object.values(values ?? {})].join(" "),
  }),
}));
it("uses the owning command snapshot instead of a conflicting global item status", () => {
  useCodexStore.setState({
    commandStatusMap: { command: "inProgress" },
    commandDurationMap: { command: 99 },
  });
  render(
    <ShellCommand
      {...({
        command: "run-checks",
        commandItemId: "command",
        status: "completed",
        durationMs: 1500,
        exitCode: 0,
        aggregatedOutput: "checks passed",
      } as any)}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /run-checks/ }));
  expect(screen.getByText("command.success")).toBeTruthy();
  expect(screen.getByText("checks passed")).toBeTruthy();
});

it("starts collapsed, retains a manual expansion on completion, and never assumes a missing exit code is success", () => {
  const props = {
    command: "run-test",
    commandItemId: "cmd",
    status: "inProgress",
  };
  const view = render(<ShellCommand {...props} />);
  expect(screen.queryByText("command.shell")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /command.running/ }));
  view.rerender(
    <ShellCommand
      {...props}
      status="completed"
      aggregatedOutput="final output"
    />,
  );
  expect(screen.getByText("final output")).toBeTruthy();
  expect(screen.getByText(/command.exitCode.*command.unknown/)).toBeTruthy();
  expect(screen.queryByText("command.success")).toBeNull();
});

it("reports actual exit codes and stopped turns rather than retaining a running badge", () => {
  const props = {
    command: "fail-test",
    commandItemId: "cmd",
    aggregatedOutput: "failed result",
  };
  const view = render(<ShellCommand {...props} status="failed" exitCode={7} />);
  fireEvent.click(screen.getByRole("button", { name: /fail-test/ }));
  expect(screen.getByText("command.exitCode 7")).toBeTruthy();
  view.rerender(
    <ShellCommand {...props} status="inProgress" termination="interrupted" />,
  );
  expect(screen.getByText("command.stopped")).toBeTruthy();
  expect(screen.queryByText("command.success")).toBeNull();
});

it("normalizes the display command, expands the command separately, and copies the untouched output", async () => {
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: copy },
  });
  const raw = "\u001b[32mchecks passed\u001b[0m\n";
  render(
    <ShellCommand
      command={"/bin/zsh -lc 'first\nsecond\nthird'"}
      commandItemId="cmd"
      status="completed"
      exitCode={0}
      aggregatedOutput={raw}
      cwd="/owner"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /first/ }));
  const command = screen.getByRole("button", {
    name: /^\$ first\s+second\s+third$/,
  });
  expect(command.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(command);
  expect(command.getAttribute("aria-expanded")).toBe("true");
  expect(
    screen.getByText("checks passed").closest("code")?.textContent,
  ).not.toContain("\u001b");
  fireEvent.click(screen.getByRole("button", { name: "command.copyOutput" }));
  await waitFor(() => expect(copy).toHaveBeenCalledWith(raw));
});

it("restores disclosure for virtual remounts without sharing it with the same item in another owner", () => {
  const cache = new Map<string, unknown>();
  const content = (threadId: string) => (
    <RowStateContext.Provider value={cache}>
      <ShellCommand
        threadId={threadId}
        command="test"
        commandItemId="same"
        status="completed"
      />
    </RowStateContext.Provider>
  );
  const first = render(content("a"));
  fireEvent.click(screen.getByRole("button", { name: /test/ }));
  first.unmount();
  const second = render(content("a"));
  expect(
    screen
      .getByRole("button", { name: /command.ran/ })
      .getAttribute("aria-expanded"),
  ).toBe("true");
  second.unmount();
  render(content("b"));
  expect(
    screen.getByRole("button", { name: /test/ }).getAttribute("aria-expanded"),
  ).toBe("false");
});

it("does not carry an open shell into a different streaming command at the same row position", () => {
  const view = render(
    <ShellCommand
      command="first-command"
      commandItemId="first"
      status="inProgress"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /command.running/ }));
  expect(screen.getByTestId("exec-shell-body")).toBeTruthy();
  view.rerender(
    <ShellCommand
      command="second-command"
      commandItemId="second"
      status="inProgress"
    />,
  );
  expect(screen.queryByTestId("exec-shell-body")).toBeNull();
});

it("does not borrow an unverified global command status for a known owner", () => {
  useCodexStore.setState({
    commandStatusMap: { same: "inProgress" },
    commandDurationMap: { same: 99000 },
  });
  render(
    <ShellCommand threadId="owner" command="check" commandItemId="same" />,
  );
  expect(
    screen.getByRole("button", { name: "command.ran check" }),
  ).toBeTruthy();
});

it("reports a clipboard rejection without claiming the command was copied", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) },
  });
  render(
    <ShellCommand command="copy-test" commandItemId="cmd" status="completed" />,
  );
  fireEvent.click(screen.getByRole("button", { name: /copy-test/ }));
  fireEvent.click(screen.getByRole("button", { name: "command.copyCommand" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("command.copyFailed"),
  );
  expect(screen.queryByRole("button", { name: "command.copied" })).toBeNull();
});

it("does not decode large terminal output while its shell body is collapsed", () => {
  const decode = vi.spyOn(terminal, "ansiSegments");
  decode.mockClear();
  const view = render(
    <ShellCommand
      command="large-log"
      commandItemId="large"
      status="completed"
      aggregatedOutput={"line\n".repeat(20000)}
    />,
  );
  expect(decode).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /large-log/ }));
  expect(decode).toHaveBeenCalledOnce();
  view.unmount();
  decode.mockRestore();
});

it("supports Enter and Space on the command's own expansion control", () => {
  render(
    <ShellCommand
      command="keyboard-command"
      commandItemId="keyboard"
      status="completed"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /keyboard-command/ }));
  const control = screen.getByRole("button", { name: "$ keyboard-command" });
  fireEvent.keyDown(control, { key: "Enter" });
  expect(control.getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(control, { key: " " });
  expect(control.getAttribute("aria-expanded")).toBe("false");
});

it("updates running duration from the native start, then settles on its completed duration", () => {
  vi.useFakeTimers();
  const visible = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.setSystemTime(10000);
  const props = {
    threadId: "timer-owner",
    commandItemId: "timer",
    command: "timer",
    status: "inProgress",
    startedAtMs: 8000,
  };
  const view = render(<ShellCommand {...props} />);
  expect(
    screen.getByRole("button", { name: /command.runningElapsed.*2s/ }),
  ).toBeTruthy();
  act(() => vi.advanceTimersByTime(1000));
  expect(
    screen.getByRole("button", { name: /command.runningElapsed.*3s/ }),
  ).toBeTruthy();
  visible.mockReturnValue(true);
  act(() => vi.advanceTimersByTime(1000));
  expect(
    screen.getByRole("button", { name: /command.runningElapsed.*3s/ }),
  ).toBeTruthy();
  visible.mockReturnValue(false);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(
    screen.getByRole("button", { name: /command.runningElapsed.*4s/ }),
  ).toBeTruthy();
  view.rerender(
    <ShellCommand
      {...props}
      status="completed"
      durationMs={2500}
      exitCode={0}
    />,
  );
  act(() => vi.advanceTimersByTime(1000));
  expect(
    screen.getByRole("button", { name: /command.ranElapsed.*2s/ }),
  ).toBeTruthy();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  visible.mockRestore();
});

it("distinguishes unloaded command details from real empty output and retains the actual exit status", () => {
  render(
    <ShellCommand
      command="metadata-command"
      commandItemId="metadata"
      status="failed"
      exitCode={7}
      transcriptMetadataOnly
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /metadata-command/ }));
  expect(screen.getAllByText("详情未加载").length).toBeGreaterThan(0);
  expect(screen.queryByText("command.noOutput")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "command.copyOutput" }),
  ).toBeNull();
  expect(screen.getByText("command.exitCode 7")).toBeTruthy();
  expect(screen.queryByText("command.success")).toBeNull();
});
