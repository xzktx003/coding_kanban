import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AgentMessageItem } from "./AgentMessageItem";
import { useCodexStore } from "../stores/useCodexStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useEditorStore } from "@session/stores/useEditorStore";
vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));
beforeEach(() => {
  useCodexStore.setState({
    threads: [{ id: "own", cwd: "/original" } as never],
  });
  useWorkspaceStore.setState({ cwd: "/different", projects: ["/different"] });
  useEditorStore.getState().resetFiles();
});
it("renders flat native assistant content with math and inline code", async () => {
  const { container } = render(
    <AgentMessageItem
      threadId="own"
      text={"Use `index` and \\(x^2\\).\n\nAnother paragraph."}
    />,
  );
  const body = container.querySelector(".codex-assistant-content");
  expect(body).not.toBeNull();
  expect(body?.className).not.toMatch(/\bborder\b|\bp-2\b/);
  await waitFor(() => expect(container.querySelector(".katex")).not.toBeNull());
  expect(screen.getByText("index").tagName).toBe("CODE");
});
it("keeps dollar-delimited text literal, as the original plugin renderer does", () => {
  render(
    <AgentMessageItem
      threadId="own"
      text="Prices and expressions: $x^2$ and $$x^2$$."
    />,
  );
  expect(
    screen.getByText("Prices and expressions: $x^2$ and $$x^2$$."),
  ).toBeTruthy();
});
it("opens a file in the message owner's project with exact line and column", async () => {
  render(<AgentMessageItem threadId="own" text="[file](src/file.ts:42:3)" />);
  fireEvent.click(screen.getByRole("link", { name: "file" }));
  await waitFor(() =>
    expect(useEditorStore.getState().activeFile).toBe("/original/src/file.ts"),
  );
  expect(useEditorStore.getState().roots["/original/src/file.ts"]).toBe(
    "/original",
  );
  expect((useEditorStore.getState() as any).revealLocation).toMatchObject({
    path: "/original/src/file.ts",
    line: 42,
    column: 3,
  });
});

for (const streaming of [false, true]) {
  it(`renders completed GFM tables and file references after streaming=${streaming}`, async () => {
    const value =
      "用途与数据：\n\n| 用途 | 实际使用的数据 |\n|---|---|\n| Torch 敏感度对齐 | v02 语料，829 个窗口 |\n| GPTQ 量化校准 | 前 8 个合格段落 |\n\n~~旧结论~~ [校准语料](src/corpus.py:12)";
    const { container, rerender } = render(
      <AgentMessageItem threadId="own" streaming={streaming} text={value} />,
    );
    if (streaming) {
      expect(
        container.querySelector("[data-codex-streaming-text]")?.textContent,
      ).toBe(value);
      expect(container.querySelector("table")).toBeNull();
      expect(container.querySelector(".codex-markdown")).toBeNull();
      rerender(<AgentMessageItem threadId="own" text={value} />);
    }
    await waitFor(() =>
      expect(container.querySelector("table")).not.toBeNull(),
    );
    expect(container.querySelectorAll("thead th")).toHaveLength(2);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container.querySelector("del")?.textContent).toBe("旧结论");
    fireEvent.click(screen.getByRole("link", { name: "校准语料" }));
    await waitFor(() =>
      expect(useEditorStore.getState().activeFile).toBe(
        "/original/src/corpus.py",
      ),
    );
  });
}

it("keeps native action reveal gated by the actual window focus state", () => {
  let focused = true;
  const focus = vi
    .spyOn(document, "hasFocus")
    .mockImplementation(() => focused);
  const { container } = render(
    <AgentMessageItem threadId="own" text="Owned reply" />,
  );
  const actions = container.querySelector(".codex-message-native-actions")!;
  expect(actions.classList.contains("group-hover:visible")).toBe(true);
  expect(actions.classList.contains("group-focus-within:visible")).toBe(true);
  focused = false;
  fireEvent.blur(window);
  expect(actions.classList.contains("invisible")).toBe(true);
  expect(actions.classList.contains("group-hover:visible")).toBe(false);
  expect(actions.classList.contains("group-focus-within:visible")).toBe(false);
  focused = true;
  fireEvent.focus(window);
  expect(actions.classList.contains("group-hover:visible")).toBe(true);
  expect(actions.classList.contains("group-focus-within:visible")).toBe(true);
  focus.mockRestore();
});
