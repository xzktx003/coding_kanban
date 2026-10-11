import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CodexMarkdown } from "./CodexMarkdown";

vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));

it("recognizes Han paragraph text inside formatting and beyond the basic CJK block", async () => {
  const { container } = render(
    <CodexMarkdown
      value={
        "**中文** [链接](https://example.com)\n\n**𠀀**\n\nEnglish **only**."
      }
    />,
  );
  await screen.findByText("中文");
  const paragraphs = container.querySelectorAll("p.codex-paragraph");
  expect(paragraphs).toHaveLength(3);
  expect(paragraphs[0].hasAttribute("data-markdown-han-text")).toBe(true);
  expect(paragraphs[1].hasAttribute("data-markdown-han-text")).toBe(true);
  expect(paragraphs[2].hasAttribute("data-markdown-han-text")).toBe(false);
});

it("isolates inline and fenced code direction from surrounding RTL text", async () => {
  const { container } = render(
    <div dir="rtl">
      <CodexMarkdown
        value={"شرح `example.name`\n\n```text\nconst value = 42;\n```"}
      />
    </div>,
  );
  const inline = await screen.findByText("example.name");
  expect(inline.closest("code")?.getAttribute("dir")).toBe("ltr");
  expect(container.querySelector("pre code")?.getAttribute("dir")).toBe("ltr");
});

it("keeps native strong semantics and the safe original link spelling for rich table copy", async () => {
  const { container } = render(
    <CodexMarkdown
      value={
        "| Name | Link |\n|---|---|\n| **one** | [Open](https://example.com) |"
      }
    />,
  );
  const one = await screen.findByText("one");
  expect(one.tagName).toBe("STRONG");
  const link = container.querySelector("td a")!;
  expect(link.getAttribute("href")).toBe("https://example.com");
  expect(link.getAttribute("title")).toBeNull();
  expect(link.querySelector(".codex-native-link-text")?.textContent).toBe(
    "Open",
  );
  expect(
    link.querySelector('[data-markdown-copy="exclude"] svg'),
  ).not.toBeNull();
});

it("keeps URL hardening when original link spelling is retained", async () => {
  const { container } = render(
    <CodexMarkdown
      value={
        "[blocked](javascript:alert%281%29) [safe](https://example.com/path)"
      }
    />,
  );
  await screen.findByText("safe");
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  expect(
    container.querySelector('a[href="https://example.com/path"]'),
  ).not.toBeNull();
});
