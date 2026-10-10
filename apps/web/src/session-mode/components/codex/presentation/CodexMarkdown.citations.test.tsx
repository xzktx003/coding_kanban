import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CodexMarkdown } from "./CodexMarkdown";
import { useCodexStore } from "../stores/useCodexStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useEditorStore } from "@session/stores/useEditorStore";
vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "zh-CN" },
    t: (key: string) => key,
  }),
}));
beforeEach(() => {
  useCodexStore.setState({
    threads: [{ id: "citation-owner", cwd: "/owner" } as never],
  });
  useWorkspaceStore.setState({ cwd: "/other" });
  useEditorStore.getState().resetFiles();
});
it("renders a native directive and a second-paragraph legacy citation as captured-owner range actions", () => {
  render(
    <CodexMarkdown
      threadId="citation-owner"
      value={
        '首段 :codex-file-citation{path="src/file.ts" line_range_start="42" line_range_end="45"}\n\nSecond 【/owner/src/second.py†L8-L9】'
      }
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /file\.ts.*42-45/ }));
  expect(useEditorStore.getState().roots["/owner/src/file.ts"]).toBe("/owner");
  expect(useEditorStore.getState().revealLocation).toMatchObject({
    path: "/owner/src/file.ts",
    line: 42,
    endLine: 45,
  });
  fireEvent.keyDown(screen.getByRole("button", { name: /second\.py.*8-9/ }), {
    key: "Enter",
  });
  expect(useEditorStore.getState().revealLocation).toMatchObject({
    path: "/owner/src/second.py",
    line: 8,
    endLine: 9,
  });
  expect(useWorkspaceStore.getState().cwd).toBe("/other");
});
it.each(["inline code", "fenced code", "escaped", "HTML", "Markdown link"])(
  "preserves %s citation as a literal example",
  (context) => {
    const citation =
      ':codex-file-citation{path="/owner/example.ts" line_range_start="2"}';
    const cases: Record<string, string> = {
      "inline code": "`" + citation + "`",
      "fenced code": "```text\n" + citation + "\n```",
      escaped: "\\" + citation,
      HTML: "<div>" + citation + "</div>",
      "Markdown link": '[link](:codex-file-citation{path="/owner/example.ts"})',
    };
    const { container } = render(
      <CodexMarkdown threadId="citation-owner" value={cases[context]} />,
    );
    expect(
      container.querySelectorAll('[data-file-reference="true"]'),
    ).toHaveLength(0);
    if (context !== "Markdown link")
      expect(container.textContent).toContain(citation);
    expect(useEditorStore.getState().openFiles).toEqual([]);
  },
);
it("renders a supported external directive as an actual safe ordinary link", () => {
  render(
    <CodexMarkdown
      threadId="citation-owner"
      value={
        ':codex-file-citation{path="https://example.invalid/source" label="Source label"}'
      }
    />,
  );
  expect(
    screen.getByRole("link", { name: "Source label" }).getAttribute("href"),
  ).toBe("https://example.invalid/source");
  expect(useEditorStore.getState().openFiles).toEqual([]);
});
it("rejects another project's range and never borrows active cwd for an unresolved owner", () => {
  const view = render(
    <CodexMarkdown
      threadId="citation-owner"
      value=':codex-file-citation{path="/other/secret.ts" line_range_start="2" line_range_end="3"}'
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /secret\.ts/ }));
  expect(useEditorStore.getState().openFiles).toEqual([]);
  view.rerender(
    <CodexMarkdown
      threadId="missing"
      value=':codex-file-citation{path="src/file.ts" line_range_start="2"}'
    />,
  );
  const unavailable = screen.getByRole("button", { name: /file\.ts/ });
  expect(unavailable.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(unavailable);
  expect(useEditorStore.getState().openFiles).toEqual([]);
});

it("keeps explicitly invalid or reversed citation ranges literal instead of opening an invented first line", () => {
  const source =
    ':codex-file-citation{path="/owner/a.ts" line_range_start="oops"} and :codex-file-citation{path="/owner/b.ts" line_range_start="9" line_range_end="3"}';
  const { container } = render(
    <CodexMarkdown threadId="citation-owner" value={source} />,
  );
  expect(
    container.querySelectorAll('[data-file-reference="true"]'),
  ).toHaveLength(0);
  expect(container.textContent).toBe(source);
  expect(useEditorStore.getState().openFiles).toEqual([]);
});
