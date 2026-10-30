import {
  act,
  fireEvent,
  render,
  screen,
  cleanup,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeferredHistoryProjectsDialog } from "./DeferredHistoryProjectsDialog";
import { useState } from "react";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
beforeEach(() => {
  document.body.innerHTML = '<div class="session-mode"></div>';
});
afterEach(() => cleanup());
const fixture = {
  HistoryProjectsDialog: ({ initialOpen }: { initialOpen?: boolean }) => {
    const [opened] = useState(initialOpen);
    return <p data-testid="history-panel">{String(opened)}</p>;
  },
};
it("does not import a closed history dialog and preserves the first open gesture until its module arrives", async () => {
  const pending = deferred<typeof fixture>(),
    load = vi.fn(() => pending.promise);
  render(<DeferredHistoryProjectsDialog load={load} />);
  expect(load).not.toHaveBeenCalled();
  await act(async () => {
    window.dispatchEvent(new Event("session-project-history"));
  });
  expect(load).toHaveBeenCalledOnce();
  expect(screen.getByRole("status").textContent).toContain("正在加载历史项目");
  await act(async () => {
    pending.resolve(fixture);
    await pending.promise;
  });
  expect(screen.getByTestId("history-panel").textContent).toBe("true");
});
it("cancelling or hiding while loading prevents a late open; another explicit gesture can still open", async () => {
  const pending = deferred<typeof fixture>(),
    load = vi.fn(() => pending.promise);
  render(<DeferredHistoryProjectsDialog load={load} />);
  await act(async () => {
    window.dispatchEvent(new Event("session-project-history"));
  });
  fireEvent.click(screen.getByRole("button", { name: "取消加载历史项目" }));
  await act(async () => {
    pending.resolve(fixture);
    await pending.promise;
  });
  expect(screen.queryByTestId("history-panel")).toBeNull();
  const root = document.querySelector<HTMLElement>(".session-mode")!;
  root.hidden = true;
  await act(async () => {
    window.dispatchEvent(new Event("workbench-mode-changed"));
    window.dispatchEvent(new Event("session-project-history"));
  });
  expect(screen.queryByTestId("history-panel")).toBeNull();
  root.hidden = false;
  await act(async () => {
    window.dispatchEvent(new Event("workbench-mode-changed"));
    window.dispatchEvent(new Event("session-project-history"));
  });
  expect(screen.getByTestId("history-panel")).toBeTruthy();
});
it("an import failure leaves an explicit retry and does not open after a cancelled retry", async () => {
  const pending = deferred<typeof fixture>(),
    load = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary load failure"))
      .mockImplementation(() => pending.promise);
  render(<DeferredHistoryProjectsDialog load={load} />);
  await act(async () => {
    window.dispatchEvent(new Event("session-project-history"));
  });
  expect(screen.getByRole("alert").textContent).toContain(
    "temporary load failure",
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "重试加载历史项目" }));
  });
  fireEvent.click(screen.getByRole("button", { name: "取消加载历史项目" }));
  await act(async () => {
    pending.resolve(fixture);
    await pending.promise;
  });
  expect(screen.queryByTestId("history-panel")).toBeNull();
});
it("an incompatible module remains local and does not impersonate an opened panel", async () => {
  const load = vi.fn().mockResolvedValue({});
  render(<DeferredHistoryProjectsDialog load={load} />);
  await act(async () => {
    window.dispatchEvent(new Event("session-project-history"));
  });
  expect(screen.getByRole("alert").textContent).toContain("模块接口不可用");
  expect(screen.queryByTestId("history-panel")).toBeNull();
});
