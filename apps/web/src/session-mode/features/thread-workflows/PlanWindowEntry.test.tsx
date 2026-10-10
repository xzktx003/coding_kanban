import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { PlanWindowEntry } from "./PlanWindowEntry";
import { savePlanWindowSnapshot } from "./planSnapshot";
import { useCodexContentOwner } from "@session/components/codex/presentation/ownerContext";
const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  close: vi.fn(),
  start: vi.fn(),
  resume: vi.fn(),
  fork: vi.fn(),
  rollback: vi.fn(),
}));
vi.mock("@session/services/codexService", () => ({
  codexService: {
    turnStart: mocks.start,
    threadResume: mocks.resume,
    threadFork: mocks.fork,
    threadRollback: mocks.rollback,
  },
}));
vi.mock("./NativeMessageCopy", () => ({
  NativeMessageCopy: () => <button>Copy</button>,
}));
vi.mock("@session/components/codex/presentation/CodexMarkdown", () => ({
  CodexMarkdown: () => {
    const owner = useCodexContentOwner("original");
    return (
      <div data-testid="captured-markdown" data-cwd={owner.cwd}>
        <a href="#codex-file=src%2Fowned.ts%3A42%3A3">Owner file</a>
      </div>
    );
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      onmessage = null;
      postMessage = mocks.post;
      close = mocks.close;
    },
  );
});
it("uses frozen source ownership and sends only an explicit file-location request without initializing or mutating an Agent", () => {
  const id = savePlanWindowSnapshot({
    text: "# Plan",
    threadId: "original",
    turnId: "turn",
    cwd: "/owner",
    language: "zh",
    rootClassName: "session-mode dark",
    cssVariables: { "--vscode-editor-background": "rgb(32, 33, 29)" },
    theme: {
      theme: "dark",
      resolvedTheme: "dark",
      accent: "default",
      starfield: false,
      backgroundImage: null,
    },
  });
  history.replaceState({}, "", `?mode=session&planWindow=${id}`);
  document.body.style.margin = "8px";
  document.body.style.backgroundColor = "rgb(1, 2, 3)";
  document.body.style.colorScheme = "light";
  const view = render(<PlanWindowEntry />);
  expect(document.body.style.margin).toBe("0px");
  expect(document.body.style.backgroundColor).toBe("rgb(32, 33, 29)");
  expect(document.body.style.colorScheme).toBe("dark");
  expect(screen.getByTestId("captured-markdown").getAttribute("data-cwd")).toBe(
    "/owner",
  );
  fireEvent.click(screen.getByRole("link", { name: "Owner file" }));
  expect(mocks.post).toHaveBeenCalledWith(
    expect.objectContaining({
      id,
      type: "openFile",
      reference: "src/owned.ts:42:3",
    }),
  );
  for (const send of [mocks.start, mocks.resume, mocks.fork, mocks.rollback])
    expect(send).not.toHaveBeenCalled();
  view.unmount();
  expect(mocks.close).toHaveBeenCalled();
  expect(document.body.style.margin).toBe("8px");
  expect(document.body.style.backgroundColor).toBe("rgb(1, 2, 3)");
  expect(document.body.style.colorScheme).toBe("light");
  document.body.style.removeProperty("margin");
  document.body.style.removeProperty("background-color");
  document.body.style.removeProperty("color-scheme");
});
it("an invalid snapshot produces an explicit error without rendering a conversation", () => {
  history.replaceState({}, "", "?mode=session&planWindow=invalid");
  render(<PlanWindowEntry />);
  expect(screen.getByRole("alert").textContent).toContain("标识无效");
  expect(screen.queryByTestId("captured-markdown")).toBeNull();
  for (const send of [mocks.start, mocks.resume, mocks.fork, mocks.rollback])
    expect(send).not.toHaveBeenCalled();
});
