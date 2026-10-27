import { lazy, Suspense } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { WorkbenchBoundary } from "../components/WorkbenchShell";

it("offers an explicit document reload for a cached rejected lazy module and keeps local data", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const loader = vi
    .fn()
    .mockRejectedValue(
      new TypeError(
        "Failed to fetch dynamically imported module: /session-entry.js",
      ),
    );
  const Broken = lazy(loader);
  const reload = vi.fn();
  const terminal = vi.fn();
  localStorage.setItem("recovery-draft-fixture", "keep this draft");
  render(
    <WorkbenchBoundary
      modeName="会话"
      onTerminal={terminal}
      reloadPage={reload}
    >
      <Suspense fallback={<p>loading</p>}>
        <Broken />
      </Suspense>
    </WorkbenchBoundary>,
  );
  await screen.findByRole("heading", { name: "会话界面加载失败" });
  expect(reload).not.toHaveBeenCalled();
  expect(loader).toHaveBeenCalledTimes(1);
  expect(
    screen.getByText(
      "Failed to fetch dynamically imported module: /session-entry.js",
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "重新加载界面" }));
  expect(reload).toHaveBeenCalledTimes(1);
  expect(loader).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem("recovery-draft-fixture")).toBe(
    "keep this draft",
  );
  fireEvent.click(screen.getByRole("button", { name: "切换到终端模式" }));
  expect(terminal).toHaveBeenCalledTimes(1);
  vi.restoreAllMocks();
});

it("bounds error details and displays error text without interpreting HTML", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const error = new Error("<img src=x onerror=alert(1)>" + "x".repeat(5000));
  function Broken(): never {
    throw error;
  }
  const { container } = render(
    <WorkbenchBoundary modeName="会话" onTerminal={vi.fn()}>
      <Broken />
    </WorkbenchBoundary>,
  );
  await screen.findByRole("heading", { name: "会话界面加载失败" });
  const details = container.querySelector("pre");
  expect(details).not.toBeNull();
  expect(details!.textContent).toContain("<img src=x onerror=alert(1)>");
  expect(details!.textContent!.length).toBeLessThanOrEqual(1000);
  expect(container.querySelector("img")).toBeNull();
  vi.restoreAllMocks();
});
