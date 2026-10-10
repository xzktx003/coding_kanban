import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, expect, it } from "vitest";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { zh } from "@session/locales/zh";
import { CommandActionItem } from "./CommandActionItem";
import { useCodexStore } from "../stores/useCodexStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useEditorStore } from "@session/stores/useEditorStore";
import { CodexContentOwner } from "../presentation/ownerContext";

beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: "zh", resources: { zh: { thread: zh.thread } } });
});

beforeEach(() => {
  useCodexStore.setState({
    threads: [{ id: "a", cwd: "/current-a" }] as any,
    currentThreadId: "b",
  });
  useWorkspaceStore.setState({ cwd: "/different", projects: ["/different"] });
  useEditorStore.getState().resetFiles();
});
it("opens a literal file path in the captured command owner, without changing the selected conversation or project", () => {
  render(
    <CommandActionItem
      action={{
        type: "read",
        name: "100%done:a.md",
        path: "/old-a/100%done:a.md",
        command: "cat file",
      }}
      threadId="a"
      cwd="/old-a"
      status="completed"
    />,
  );
  fireEvent.click(screen.getByRole("link", { name: "100%done:a.md" }));
  expect(useEditorStore.getState().activeFile).toBe("/old-a/100%done:a.md");
  expect(useEditorStore.getState().roots["/old-a/100%done:a.md"]).toBe(
    "/old-a",
  );
  expect(useWorkspaceStore.getState().cwd).toBe("/different");
  expect(useCodexStore.getState().currentThreadId).toBe("b");
});
it("keeps an actual filename's colon-number suffix rather than interpreting it as a line number", () => {
  render(
    <CommandActionItem
      action={{
        type: "read",
        name: "log:42",
        path: "/old-a/log:42",
        command: "cat log",
      }}
      threadId="a"
      cwd="/old-a"
      status="completed"
    />,
  );
  fireEvent.click(screen.getByRole("link", { name: "log:42" }));
  expect(useEditorStore.getState().activeFile).toBe("/old-a/log:42");
  expect(useEditorStore.getState().revealLocation?.line).toBe(1);
});
it("inherits the content owner for relative paths and does not borrow the active project for an unknown owner", () => {
  const action = {
    type: "read" as const,
    name: "file.ts",
    path: "src/file.ts",
    command: "cat file",
  };
  const view = render(
    <CodexContentOwner.Provider value="a">
      <CommandActionItem action={action} status="completed" />
    </CodexContentOwner.Provider>,
  );
  fireEvent.click(screen.getByRole("link", { name: "file.ts" }));
  expect(useEditorStore.getState().activeFile).toBe("/current-a/src/file.ts");
  view.unmount();
  render(
    <CommandActionItem action={action} threadId="unknown" status="completed" />,
  );
  expect(screen.queryByRole("link")).toBeNull();
});
it("does not claim an unfinished read has finished, and avoids the legacy query badges", () => {
  const action = {
    type: "read" as const,
    name: "file.ts",
    path: "/a/file.ts",
    command: "cat file",
  };
  const view = render(
    <CommandActionItem action={action} status="inProgress" />,
  );
  expect(screen.queryByText("file.ts")).toBeNull();
  view.rerender(
    <CommandActionItem
      action={{
        type: "search",
        command: "rg query",
        query: "foo",
        path: "src",
      }}
      status="completed"
    />,
  );
  expect(view.container.querySelector('[data-slot="badge"]')).toBeNull();
});
it("retains the real output and exit code of a failed exploration instead of hiding it", () => {
  render(
    <CommandActionItem
      action={{
        type: "read",
        name: "missing",
        path: "/a/missing",
        command: "cat missing",
      }}
      threadId="a"
      status="failed"
      aggregatedOutput="No such file"
      exitCode={1}
    />,
  );
  fireEvent.click(screen.getByRole("button", { expanded: false }));
  expect(screen.getByText("No such file")).toBeTruthy();
  expect(screen.getByText("退出码 1")).toBeTruthy();
});
it("renders search expressions and filename markup as literal text", () => {
  const query = "<path>bad</path> & <img>";
  const path = "/a/<tag>not markup &.ts";
  const view = render(
    <CommandActionItem
      action={{ type: "search", query, path: null, command: "rg" }}
      status="completed"
    />,
  );
  expect(view.container.textContent).toContain(query);
  view.rerender(
    <CommandActionItem
      action={{
        type: "read",
        name: "<tag>not markup &.ts",
        path,
        command: "cat",
      }}
      status="completed"
    />,
  );
  expect(
    screen.getByRole("link", { name: "<tag>not markup &.ts" }),
  ).toBeTruthy();
});
