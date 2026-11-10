import { render, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { LiveMarkdownTail } from "./liveMarkdownTail";
import { StreamingCodexMarkdown } from "./StreamingCodexMarkdown";

const DIRECTIVE = ':codex-file-citation{path="/owner/source.ts"}';

it("renders a file citation nested inside **bold** as a pill inside the strong", async () => {
  const value = `**${DIRECTIVE}**`;
  const view = render(<LiveMarkdownTail value={value} threadId="thread" />);
  await waitFor(() =>
    expect(
      view.container.querySelector("strong .native-file-citation"),
    ).not.toBeNull(),
  );
  expect(view.container.querySelector(".native-file-citation")).not.toBeNull();
  expect(view.container.querySelector("strong")).not.toBeNull();
  expect(view.container.querySelector("strong")?.textContent).not.toContain(
    ":codex-file-citation{",
  );
  expect(view.container.textContent).not.toContain(":codex-file-citation{");
});

it("renders a citation inside bold with surrounding text (word boundary)", async () => {
  const value = `**see ${DIRECTIVE} here**`;
  const view = render(<LiveMarkdownTail value={value} threadId="thread" />);
  await waitFor(() =>
    expect(
      view.container.querySelector("strong .native-file-citation"),
    ).not.toBeNull(),
  );
  const strong = view.container.querySelector("strong");
  expect(strong).not.toBeNull();
  // Bold keeps its surrounding words while the directive becomes a pill.
  expect(strong?.textContent).toContain("see");
  expect(strong?.textContent).toContain("here");
  expect(strong?.textContent).not.toContain(":codex-file-citation{");
});

it("renders a complete live GFM table as a table", () => {
  const value = "| Result | Value |\n|---|---|\n| rows | two |";
  const view = render(<LiveMarkdownTail value={value} threadId="thread" />);

  expect(view.container.querySelector("table")).not.toBeNull();
  expect(view.container.querySelector("tbody")?.textContent).toContain("rows");
});

it.each([
  DIRECTIVE,
  "【/owner/source.ts†L8】",
])(
  "renders a citation directive split across a streaming segment boundary inside bold",
  async (directive) => {
    const full = `**${directive}**`;
    const cut = directive.length - 4;
    const segments = [full.slice(0, cut)];
    const current = full.slice(cut);
    const view = render(
      <StreamingCodexMarkdown segments={segments} current={current} threadId="thread" />,
    );
    await waitFor(() =>
      expect(
        view.container.querySelector("strong .native-file-citation"),
      ).not.toBeNull(),
    );
    expect(view.container.textContent).not.toContain(":codex-file-citation{");
  },
);
